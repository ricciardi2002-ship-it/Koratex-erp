// src/routes/pedidos.js
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');
const { audit } = require('../middleware/errorHandler');

// GET /api/pedidos
router.get('/', auth, async (req, res, next) => {
  try {
    const { estado_pago, estado_despacho, cliente_id, limit = 50, offset = 0 } = req.query;

    let conditions = [];
    let params = [];
    let i = 1;

    // Vendedores solo ven sus propios pedidos
    if (req.user.rol === 'comercial') {
      conditions.push(`p.vendedor_id = $${i++}`);
      params.push(req.user.id);
    }
    if (estado_pago)    { conditions.push(`p.estado_pago = $${i++}`);    params.push(estado_pago); }
    if (estado_despacho){ conditions.push(`p.estado_despacho = $${i++}`);params.push(estado_despacho); }
    if (cliente_id)     { conditions.push(`p.cliente_id = $${i++}`);     params.push(cliente_id); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await query(`
      SELECT
        p.id, p.numero, p.fecha_pedido, p.fecha_entrega,
        p.subtotal, p.igv, p.total, p.descuento,
        p.estado_pago, p.estado_despacho, p.lista_precios,
        p.observaciones, p.created_at,
        c.nombre   AS cliente_nombre,
        c.codigo   AS cliente_codigo,
        tc.nombre  AS cliente_tipo,
        u.nombre   AS vendedor_nombre,
        COUNT(pi.id) AS num_items
      FROM pedidos p
      JOIN clientes c    ON c.id = p.cliente_id
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN usuarios u  ON u.id = p.vendedor_id
      LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
      ${where}
      GROUP BY p.id, c.nombre, c.codigo, tc.nombre, u.nombre
      ORDER BY p.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, [...params, limit, offset]);

    const total = await query(
      `SELECT COUNT(*) FROM pedidos p ${where}`,
      params
    );

    res.json({
      data: result.rows,
      total: parseInt(total.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) { next(err); }
});

// GET /api/pedidos/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const pedido = await query(`
      SELECT p.*, c.nombre AS cliente_nombre, c.codigo AS cliente_codigo,
             tc.nombre AS cliente_tipo, u.nombre AS vendedor_nombre,
             z.nombre AS zona_nombre
      FROM pedidos p
      JOIN clientes c ON c.id = p.cliente_id
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN usuarios u ON u.id = p.vendedor_id
      LEFT JOIN zonas z ON z.id = c.zona_id
      WHERE p.id = $1`, [req.params.id]);

    if (!pedido.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = await query(`
      SELECT pi.*, pr.nombre AS producto_nombre, pr.codigo AS producto_codigo,
             pr.presentacion
      FROM pedido_items pi
      JOIN productos pr ON pr.id = pi.producto_id
      WHERE pi.pedido_id = $1
      ORDER BY pi.linea`, [req.params.id]);

    res.json({ ...pedido.rows[0], items: items.rows });
  } catch (err) { next(err); }
});

// POST /api/pedidos
router.post('/', auth, roles('admin', 'comercial'), async (req, res, next) => {
  const client = await require('../config/db').pool.connect();
  try {
    await client.query('BEGIN');

    const { cliente_id, fecha_entrega, observaciones, items } = req.body;

    if (!cliente_id || !items || !items.length) {
      return res.status(400).json({ error: 'cliente_id e items son requeridos' });
    }
    if (items.length > 15) {
      return res.status(400).json({ error: 'Máximo 15 líneas por pedido' });
    }

    // Obtener tipo de cliente para lista de precios
    const cliRes = await client.query(
      `SELECT c.*, tc.lista_precios FROM clientes c
       JOIN tipos_cliente tc ON tc.id = c.tipo_id
       WHERE c.id = $1`, [cliente_id]
    );
    if (!cliRes.rows.length) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    const cliente = cliRes.rows[0];
    const lista = cliente.lista_precios; // A, B o C

    // Número correlativo
    const seqRes = await client.query(`SELECT nextval('pedido_seq') AS seq`);
    const numero = 'PED-' + String(seqRes.rows[0].seq).padStart(4, '0');

    // Calcular subtotales por línea
    let subtotal = 0;
    const lineasProcesadas = [];

    for (const item of items) {
      if (!item.producto_id || !item.cantidad || item.cantidad <= 0) continue;

      // Obtener precio según lista
      const prodRes = await client.query(
        `SELECT *, precio_lista_${lista.toLowerCase()} AS precio_lista
         FROM productos WHERE id = $1 AND activo = true`, [item.producto_id]
      );
      if (!prodRes.rows.length) {
        throw { status: 400, message: `Producto ${item.producto_id} no encontrado` };
      }
      const prod = prodRes.rows[0];

      // Verificar stock disponible
      const stockRes = await client.query(
        `SELECT stock_total - stock_reservado AS disponible
         FROM inventario_pt WHERE producto_id = $1`, [item.producto_id]
      );
      const disponible = stockRes.rows.length ? parseInt(stockRes.rows[0].disponible) : 0;
      if (disponible < item.cantidad) {
        throw {
          status: 400,
          message: `Stock insuficiente para ${prod.nombre}. Disponible: ${disponible}, solicitado: ${item.cantidad}`
        };
      }

      const precioUnit = item.precio_unitario || prod.precio_lista;
      const descPct = item.descuento_pct || 0;
      const lineSub = Math.round(item.cantidad * precioUnit * (1 - descPct / 100) * 100) / 100;

      lineasProcesadas.push({ ...item, precio_unitario: precioUnit, descuento_pct: descPct, subtotal: lineSub });
      subtotal += lineSub;
    }

    const igv = Math.round(subtotal * 0.18 * 100) / 100;
    const total = Math.round((subtotal + igv) * 100) / 100;

    // Insertar pedido
    const pedidoRes = await client.query(`
      INSERT INTO pedidos
        (numero, cliente_id, vendedor_id, lista_precios, subtotal, igv, total,
         fecha_entrega, observaciones)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [numero, cliente_id, req.user.id, lista, subtotal, igv, total, fecha_entrega || null, observaciones || null]
    );
    const pedido = pedidoRes.rows[0];

    // Insertar items y reservar stock
    for (let i = 0; i < lineasProcesadas.length; i++) {
      const item = lineasProcesadas[i];
      await client.query(`
        INSERT INTO pedido_items
          (pedido_id, producto_id, linea, cantidad, precio_unitario, descuento_pct, subtotal, notas)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pedido.id, item.producto_id, i + 1, item.cantidad,
         item.precio_unitario, item.descuento_pct, item.subtotal, item.notas || null]
      );

      // Reservar stock PT
      await client.query(
        `UPDATE inventario_pt SET stock_reservado = stock_reservado + $1, updated_at = NOW()
         WHERE producto_id = $2`,
        [item.cantidad, item.producto_id]
      );
    }

    // Crear factura automáticamente
    const diasCredito = cliente.dias_credito || 30;
    const vencimiento = new Date();
    vencimiento.setDate(vencimiento.getDate() + diasCredito);
    const numFac = 'F001-' + String(seqRes.rows[0].seq).padStart(5, '0');

    await client.query(`
      INSERT INTO facturas (numero, pedido_id, cliente_id, monto_total, fecha_vencimiento)
      VALUES ($1,$2,$3,$4,$5)`,
      [numFac, pedido.id, cliente_id, total, vencimiento.toISOString().split('T')[0]]
    );

    await client.query('COMMIT');

    // Auditoría
    await audit(req.user.id, 'comercial', 'CREAR_PEDIDO', 'pedidos', pedido.id, {
      numero, cliente: cliente.nombre, total, items: lineasProcesadas.length
    });

    res.status(201).json({ ...pedido, items: lineasProcesadas, factura: numFac });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PATCH /api/pedidos/:id/estado
router.patch('/:id/estado', auth, roles('admin', 'comercial', 'logistica'), async (req, res, next) => {
  try {
    const { estado_pago, estado_despacho } = req.body;
    const updates = [];
    const params = [];
    let i = 1;

    if (estado_pago)     { updates.push(`estado_pago = $${i++}`);     params.push(estado_pago); }
    if (estado_despacho) { updates.push(`estado_despacho = $${i++}`); params.push(estado_despacho); }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await query(
      `UPDATE pedidos SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Si se entrega, liberar stock reservado
    if (estado_despacho === 'entregado') {
      const items = await query(
        `SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = $1`,
        [req.params.id]
      );
      for (const item of items.rows) {
        await query(
          `UPDATE inventario_pt
           SET stock_total     = GREATEST(0, stock_total - $1),
               stock_reservado = GREATEST(0, stock_reservado - $1),
               updated_at      = NOW()
           WHERE producto_id = $2`,
          [item.cantidad, item.producto_id]
        );
      }
    }

    await audit(req.user.id, 'comercial', 'ACTUALIZAR_ESTADO_PEDIDO', 'pedidos',
      req.params.id, { estado_pago, estado_despacho });

    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
