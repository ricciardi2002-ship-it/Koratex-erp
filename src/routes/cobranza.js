const express  = require('express');
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');

// ── Cobranza (Facturas y Pagos) ───────────────────────────────────────────────
const cobranzaRouter = express.Router();

// GET /api/cobranza  — facturas
cobranzaRouter.get('/', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT f.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo
       FROM facturas f
       JOIN clientes c ON c.id = f.cliente_id
       ORDER BY f.fecha_emision DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/cobranza/:id
cobranzaRouter.get('/:id', auth, async (req, res, next) => {
  try {
    const factura = await query(
      `SELECT f.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo
       FROM facturas f
       JOIN clientes c ON c.id = f.cliente_id
       WHERE f.id = $1`,
      [req.params.id]
    );
    if (!factura.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });

    const pagos = await query(
      `SELECT p.*, u.nombre as usuario_nombre
       FROM pagos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.factura_id = $1
       ORDER BY p.fecha_pago DESC`,
      [req.params.id]
    );

    res.json({ ...factura.rows[0], pagos: pagos.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/cobranza  — crear factura
cobranzaRouter.post('/', auth, roles('admin', 'finanzas'), async (req, res, next) => {
  try {
    const { numero, pedido_id, cliente_id, monto_total, fecha_vencimiento } = req.body;
    const result = await query(
      `INSERT INTO facturas (numero, pedido_id, cliente_id, monto_total, fecha_vencimiento)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [numero, pedido_id, cliente_id, monto_total, fecha_vencimiento]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/cobranza/:id/pagos  — registrar pago
cobranzaRouter.post('/:id/pagos', auth, roles('admin', 'finanzas'), async (req, res, next) => {
  try {
    const { monto, tipo_pago, referencia, fecha_pago, notas } = req.body;

    const factResult = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!factResult.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    const factura = factResult.rows[0];

    const pago = await query(
      `INSERT INTO pagos (factura_id, cliente_id, usuario_id, monto, tipo_pago,
        referencia, fecha_pago, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [factura.id, factura.cliente_id, req.user.id, monto, tipo_pago,
       referencia, fecha_pago, notas]
    );

    const nuevoPagado = parseFloat(factura.monto_pagado) + parseFloat(monto);
    const estado = nuevoPagado >= parseFloat(factura.monto_total) ? 'pagada' : 'vigente';
    await query(
      `UPDATE facturas SET monto_pagado = $1, estado = $2 WHERE id = $3`,
      [nuevoPagado, estado, factura.id]
    );

    res.status(201).json(pago.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/cobranza/resumen/vencidas
cobranzaRouter.get('/resumen/vencidas', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT f.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo,
              (f.monto_total - f.monto_pagado) as saldo_pendiente,
              (CURRENT_DATE - f.fecha_vencimiento) as dias_vencida
       FROM facturas f
       JOIN clientes c ON c.id = f.cliente_id
       WHERE f.estado = 'vigente' AND f.fecha_vencimiento < CURRENT_DATE
       ORDER BY dias_vencida DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ── Despacho (Rutas de despacho) ──────────────────────────────────────────────
const despachoRouter = express.Router();

// GET /api/despacho
despachoRouter.get('/', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT rd.*, v.placa, v.nombre as vehiculo_nombre, v.conductor,
              z.nombre as zona_nombre
       FROM rutas_despacho rd
       JOIN vehiculos v ON v.id = rd.vehiculo_id
       LEFT JOIN zonas z ON z.id = rd.zona_id
       ORDER BY rd.fecha DESC, rd.created_at DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/despacho/vehiculos/lista  — must be before /:id
despachoRouter.get('/vehiculos/lista', auth, async (req, res, next) => {
  try {
    const result = await query(`SELECT * FROM vehiculos WHERE activo = TRUE ORDER BY placa`);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/despacho/:id
despachoRouter.get('/:id', auth, async (req, res, next) => {
  try {
    const ruta = await query(
      `SELECT rd.*, v.placa, v.nombre as vehiculo_nombre, v.conductor,
              z.nombre as zona_nombre
       FROM rutas_despacho rd
       JOIN vehiculos v ON v.id = rd.vehiculo_id
       LEFT JOIN zonas z ON z.id = rd.zona_id
       WHERE rd.id = $1`,
      [req.params.id]
    );
    if (!ruta.rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });

    const paradas = await query(
      `SELECT rdp.*, p.numero as pedido_numero, c.nombre as cliente_nombre,
              c.direccion, c.lat, c.lng
       FROM rutas_despacho_paradas rdp
       JOIN pedidos p ON p.id = rdp.pedido_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE rdp.ruta_id = $1
       ORDER BY rdp.orden`,
      [req.params.id]
    );

    res.json({ ...ruta.rows[0], paradas: paradas.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/despacho
despachoRouter.post('/', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { vehiculo_id, zona_id, fecha, hora_salida, notas, pedidos } = req.body;
    const ruta = await query(
      `INSERT INTO rutas_despacho (vehiculo_id, zona_id, fecha, hora_salida, notas)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [vehiculo_id, zona_id, fecha, hora_salida, notas]
    );
    const rutaId = ruta.rows[0].id;

    for (let i = 0; i < (pedidos || []).length; i++) {
      await query(
        `INSERT INTO rutas_despacho_paradas (ruta_id, pedido_id, orden)
         VALUES ($1,$2,$3)`,
        [rutaId, pedidos[i], i + 1]
      );
    }

    res.status(201).json(ruta.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/despacho/:id/estado
despachoRouter.patch('/:id/estado', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { estado } = req.body;
    const result = await query(
      `UPDATE rutas_despacho SET estado = $1 WHERE id = $2 RETURNING *`,
      [estado, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = { cobranzaRouter, despachoRouter };
