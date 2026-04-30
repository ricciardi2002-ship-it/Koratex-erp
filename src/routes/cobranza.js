// src/routes/cobranza.js
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');
const { audit } = require('../middleware/errorHandler');

// GET /api/cobranza/facturas
router.get('/facturas', auth, roles('admin', 'comercial', 'finanzas'), async (req, res, next) => {
  try {
    const { estado, cliente_id } = req.query;
    let conditions = [];
    let params = [];
    let i = 1;
    if (estado)     { conditions.push(`f.estado = $${i++}`);      params.push(estado); }
    if (cliente_id) { conditions.push(`f.cliente_id = $${i++}`);  params.push(cliente_id); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await query(`
      SELECT f.*,
        c.nombre  AS cliente_nombre,
        tc.nombre AS cliente_tipo,
        p.numero  AS pedido_numero,
        GREATEST(0, CURRENT_DATE - f.fecha_vencimiento) AS dias_mora
      FROM facturas f
      JOIN clientes c ON c.id = f.cliente_id
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN pedidos p ON p.id = f.pedido_id
      ${where}
      ORDER BY f.fecha_vencimiento ASC`, params);

    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/cobranza/pagos
router.post('/pagos', auth, roles('admin', 'comercial', 'finanzas'), async (req, res, next) => {
  const client = await require('../config/db').pool.connect();
  try {
    await client.query('BEGIN');

    const { factura_id, monto, tipo_pago, referencia, fecha_pago, notas } = req.body;
    if (!factura_id || !monto || monto <= 0) {
      return res.status(400).json({ error: 'factura_id y monto son requeridos' });
    }

    const facRes = await client.query(
      `SELECT *, (monto_total - monto_pagado) AS saldo FROM facturas WHERE id = $1`,
      [factura_id]
    );
    if (!facRes.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    const fac = facRes.rows[0];

    if (parseFloat(monto) > parseFloat(fac.saldo)) {
      return res.status(400).json({
        error: 'El monto supera el saldo pendiente',
        saldo_pendiente: fac.saldo
      });
    }

    // Registrar pago
    const pagoRes = await client.query(`
      INSERT INTO pagos (factura_id, cliente_id, usuario_id, monto, tipo_pago, referencia, fecha_pago, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [factura_id, fac.cliente_id, req.user.id, monto, tipo_pago || 'efectivo',
       referencia || null, fecha_pago || new Date().toISOString().split('T')[0], notas || null]
    );

    // Actualizar factura
    const nuevoMontoPagado = parseFloat(fac.monto_pagado) + parseFloat(monto);
    const nuevoEstado = nuevoMontoPagado >= parseFloat(fac.monto_total) ? 'pagada' : 'vigente';
    await client.query(
      `UPDATE facturas SET monto_pagado = $1, estado = $2 WHERE id = $3`,
      [nuevoMontoPagado, nuevoEstado, factura_id]
    );

    await client.query('COMMIT');

    await audit(req.user.id, 'comercial', 'REGISTRAR_PAGO', 'pagos',
      pagoRes.rows[0].id, { factura_id, monto, tipo_pago });

    res.status(201).json(pagoRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;


// ─────────────────────────────────────────────────────────────
// src/routes/despacho.js
// ─────────────────────────────────────────────────────────────
const router2 = express.Router();

// GET /api/despacho/rutas
router2.get('/rutas', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT rd.*, v.placa, v.nombre AS vehiculo_nombre, v.conductor,
             z.nombre AS zona_nombre
      FROM rutas_despacho rd
      JOIN vehiculos v ON v.id = rd.vehiculo_id
      LEFT JOIN zonas z ON z.id = rd.zona_id
      ORDER BY rd.fecha DESC, rd.created_at DESC`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/despacho/pendientes  (pedidos sin ruta asignada)
router2.get('/pendientes', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT p.id, p.numero, p.fecha_entrega, p.total,
             c.nombre AS cliente, c.direccion, c.lat, c.lng,
             z.nombre AS zona
      FROM pedidos p
      JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN zonas z ON z.id = c.zona_id
      WHERE p.estado_despacho IN ('pendiente','preparacion')
        AND p.estado_pago != 'anulado'
      ORDER BY p.fecha_entrega ASC NULLS LAST`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/despacho/rutas  (crear ruta + optimizar)
router2.post('/rutas', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { vehiculo_id, zona_id, fecha, hora_salida, pedido_ids, notas } = req.body;
    if (!vehiculo_id || !pedido_ids || !pedido_ids.length) {
      return res.status(400).json({ error: 'vehiculo_id y pedido_ids son requeridos' });
    }

    const rutaRes = await query(`
      INSERT INTO rutas_despacho (vehiculo_id, zona_id, fecha, hora_salida, optimizada, notas)
      VALUES ($1,$2,$3,$4,true,$5) RETURNING *`,
      [vehiculo_id, zona_id || null, fecha || new Date().toISOString().split('T')[0],
       hora_salida || null, notas || null]
    );
    const ruta = rutaRes.rows[0];

    // Obtener coords de cada pedido y aplicar Nearest Neighbor
    const pedidosData = [];
    for (const pid of pedido_ids) {
      const r = await query(
        `SELECT p.id, c.lat, c.lng, c.nombre AS cliente
         FROM pedidos p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = $1`, [pid]
      );
      if (r.rows.length) pedidosData.push(r.rows[0]);
    }

    // Nearest Neighbor desde depósito (Lima centro: -12.05, -77.04)
    const origen = { lat: -12.05, lng: -77.04 };
    const ordenado = nearestNeighbor(pedidosData, origen);

    for (let i = 0; i < ordenado.length; i++) {
      await query(
        `INSERT INTO rutas_despacho_paradas (ruta_id, pedido_id, orden)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [ruta.id, ordenado[i].id, i + 1]
      );
      await query(
        `UPDATE pedidos SET estado_despacho = 'preparacion', updated_at = NOW() WHERE id = $1`,
        [ordenado[i].id]
      );
    }

    await audit(req.user.id, 'logistica', 'CREAR_RUTA_DESPACHO',
      'rutas_despacho', ruta.id, { pedidos: pedido_ids.length });

    res.status(201).json({ ruta, orden: ordenado });
  } catch (err) { next(err); }
});

// Algoritmo Nearest Neighbor
function nearestNeighbor(puntos, origen) {
  const dist = (a, b) =>
    Math.sqrt(Math.pow((a.lat||0)-(b.lat||0),2) + Math.pow((a.lng||0)-(b.lng||0),2));

  let restantes = [...puntos];
  let actual = origen;
  const ruta = [];

  while (restantes.length > 0) {
    let minDist = Infinity, masProximo = null, idx = 0;
    restantes.forEach((p, i) => {
      const d = dist(actual, p);
      if (d < minDist) { minDist = d; masProximo = p; idx = i; }
    });
    ruta.push(masProximo);
    actual = masProximo;
    restantes.splice(idx, 1);
  }
  return ruta;
}

// PATCH /api/despacho/rutas/:id/estado
router2.patch('/rutas/:id/estado', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { estado } = req.body;
    const result = await query(
      `UPDATE rutas_despacho SET estado = $1 WHERE id = $2 RETURNING *`,
      [estado, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/despacho/vehiculos
router2.get('/vehiculos', auth, async (req, res, next) => {
  try {
    const result = await query(`SELECT * FROM vehiculos WHERE activo=true ORDER BY nombre`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = { cobranzaRouter: router, despachoRouter: router2 };
