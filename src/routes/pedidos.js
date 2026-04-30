const express  = require('express');
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');

const router = express.Router();

// GET /api/pedidos
router.get('/', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo,
              u.nombre as vendedor_nombre
       FROM pedidos p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.vendedor_id
       ORDER BY p.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/pedidos/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const pedido = await query(
      `SELECT p.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo,
              c.direccion as cliente_direccion, u.nombre as vendedor_nombre
       FROM pedidos p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.vendedor_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!pedido.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = await query(
      `SELECT pi.*, pr.nombre as producto_nombre, pr.codigo as producto_codigo
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
       WHERE pi.pedido_id = $1
       ORDER BY pi.linea`,
      [req.params.id]
    );

    res.json({ ...pedido.rows[0], items: items.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/pedidos
router.post('/', auth, roles('admin', 'comercial'), async (req, res, next) => {
  try {
    const { cliente_id, lista_precios, fecha_entrega, observaciones, items } = req.body;

    const numResult = await query(`SELECT nextval('pedido_seq') as n`);
    const numero = `PED-${String(numResult.rows[0].n).padStart(5, '0')}`;

    let subtotal = 0;
    const processedItems = (items || []).map((item, idx) => {
      const sub = item.cantidad * item.precio_unitario * (1 - (item.descuento_pct || 0) / 100);
      subtotal += sub;
      return { ...item, linea: idx + 1, subtotal: sub };
    });

    const igv = subtotal * 0.18;
    const total = subtotal + igv;

    const pedResult = await query(
      `INSERT INTO pedidos (numero, cliente_id, vendedor_id, lista_precios, subtotal,
        igv, total, fecha_entrega, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [numero, cliente_id, req.user.id, lista_precios, subtotal, igv, total,
       fecha_entrega, observaciones]
    );
    const pedido = pedResult.rows[0];

    for (const item of processedItems) {
      await query(
        `INSERT INTO pedido_items (pedido_id, producto_id, linea, cantidad,
          precio_unitario, descuento_pct, subtotal, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pedido.id, item.producto_id, item.linea, item.cantidad,
         item.precio_unitario, item.descuento_pct || 0, item.subtotal, item.notas]
      );
      // Reserve stock
      await query(
        `UPDATE inventario_pt SET stock_reservado = stock_reservado + $1
         WHERE producto_id = $2`,
        [item.cantidad, item.producto_id]
      );
    }

    res.status(201).json(pedido);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/pedidos/:id/estado
router.patch('/:id/estado', auth, roles('admin', 'logistica', 'finanzas'), async (req, res, next) => {
  try {
    const { estado_pago, estado_despacho } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;
    if (estado_pago !== undefined)     { fields.push(`estado_pago=$${idx++}`);     values.push(estado_pago); }
    if (estado_despacho !== undefined) { fields.push(`estado_despacho=$${idx++}`); values.push(estado_despacho); }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    values.push(req.params.id);
    const result = await query(
      `UPDATE pedidos SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${idx} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
