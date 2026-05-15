const express  = require('express');
const { pool }  = require('../config/db');
const { auth, roles } = require('../middleware/auth');

const router = express.Router();

// GET /api/pedidos
router.get('/', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo,
              c.zona_id, z.nombre as zona_nombre,
              u.nombre as vendedor_nombre,
              COUNT(pi.id) as item_count
       FROM pedidos p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN zonas z ON z.id = c.zona_id
       LEFT JOIN usuarios u ON u.id = p.vendedor_id
       LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
       GROUP BY p.id, c.nombre, c.codigo, c.zona_id, z.nombre, u.nombre
       ORDER BY p.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/pedidos/ventas-anuales
router.get('/ventas-anuales', auth, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.numero, p.fecha_pedido,
             p.subtotal, p.igv, p.total,
             p.estado_pago, p.estado_despacho, p.lista_precios,
             c.nombre  AS cliente_nombre,
             c.codigo  AS cliente_codigo,
             tc.nombre AS tipo_cliente,
             z.nombre  AS zona_nombre,
             u.nombre  AS vendedor_nombre,
             COUNT(pi.id)         AS item_count,
             TO_CHAR(p.fecha_pedido, 'YYYY-MM') AS mes
      FROM pedidos p
      JOIN clientes c      ON c.id  = p.cliente_id
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN zonas z    ON z.id  = c.zona_id
      LEFT JOIN usuarios u ON u.id  = p.vendedor_id
      LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
      WHERE p.estado_despacho IN ('despachado','entregado')
        AND p.fecha_pedido >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY p.id, p.numero, p.fecha_pedido, p.subtotal, p.igv, p.total,
               p.estado_pago, p.estado_despacho, p.lista_precios,
               c.nombre, c.codigo, tc.nombre, z.nombre, u.nombre
      ORDER BY p.fecha_pedido DESC
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/pedidos/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const pedido = await pool.query(
      `SELECT p.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo,
              c.direccion as cliente_direccion, u.nombre as vendedor_nombre
       FROM pedidos p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.vendedor_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!pedido.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = await pool.query(
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

// POST /api/pedidos — wrapped in transaction
router.post('/', auth, roles('admin', 'comercial'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { cliente_id, lista_precios, fecha_entrega, observaciones, items } = req.body;

    const numResult = await client.query(`SELECT nextval('pedido_seq') as n`);
    const numero = `PED-${String(numResult.rows[0].n).padStart(5, '0')}`;

    let subtotal = 0;
    const processedItems = (items || []).map((item, idx) => {
      const sub = item.cantidad * item.precio_unitario * (1 - (item.descuento_pct || 0) / 100);
      subtotal += sub;
      return { ...item, linea: idx + 1, subtotal: sub };
    });

    const igv = subtotal * 0.18;
    const total = subtotal + igv;

    const pedResult = await client.query(
      `INSERT INTO pedidos (numero, cliente_id, vendedor_id, lista_precios, subtotal,
        igv, total, fecha_entrega, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [numero, cliente_id, req.user.id, lista_precios, subtotal, igv, total,
       fecha_entrega, observaciones]
    );
    const pedido = pedResult.rows[0];

    for (const item of processedItems) {
      await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, linea, cantidad,
          precio_unitario, descuento_pct, subtotal, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pedido.id, item.producto_id, item.linea, item.cantidad,
         item.precio_unitario, item.descuento_pct || 0, item.subtotal, item.notas]
      );
      await client.query(
        `UPDATE inventario_pt SET stock_reservado = stock_reservado + $1
         WHERE producto_id = $2`,
        [item.cantidad, item.producto_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(pedido);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PATCH /api/pedidos/:id/estado
router.patch('/:id/estado', auth, roles('admin', 'logistica', 'finanzas', 'comercial'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { estado_pago, estado_despacho } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;
    if (estado_pago !== undefined)     { fields.push(`estado_pago=$${idx++}`);     values.push(estado_pago); }
    if (estado_despacho !== undefined) { fields.push(`estado_despacho=$${idx++}`); values.push(estado_despacho); }
    if (!fields.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Nada que actualizar' }); }

    values.push(req.params.id);
    const result = await client.query(
      `UPDATE pedidos SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${idx} RETURNING *`,
      values
    );
    if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado' }); }

    const pedido = result.rows[0];

    // Al entregar: descontar stock_total y liberar stock_reservado
    if (estado_despacho === 'entregado') {
      const items = await client.query(
        `SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = $1`,
        [pedido.id]
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE inventario_pt
           SET stock_total     = GREATEST(0, stock_total - $1),
               stock_reservado = GREATEST(0, stock_reservado - $1),
               updated_at      = NOW()
           WHERE producto_id = $2`,
          [item.cantidad, item.producto_id]
        );
      }
    }

    await client.query('COMMIT');
    res.json(pedido);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
