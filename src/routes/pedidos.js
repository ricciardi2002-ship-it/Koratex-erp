const express  = require('express');
const { pool }  = require('../config/db');
const { auth, roles } = require('../middleware/auth');

const router = express.Router();

// GET /api/pedidos
router.get('/', auth, async (req, res, next) => {
  try {
    const isComercial = req.user.rol === 'comercial';
    const result = await pool.query(
      `SELECT p.*, c.nombre as cliente_nombre, c.codigo as cliente_codigo,
              c.zona_id, z.nombre as zona_nombre,
              u.nombre as vendedor_nombre,
              COUNT(pi.id) as item_count,
              COALESCE(f.estado, 'pendiente') AS estado_pago
       FROM pedidos p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN zonas z ON z.id = c.zona_id
       LEFT JOIN usuarios u ON u.id = p.vendedor_id
       LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
       LEFT JOIN facturas f ON f.pedido_id = p.id
       ${isComercial ? 'WHERE p.vendedor_id = $1' : ''}
       GROUP BY p.id, c.nombre, c.codigo, c.zona_id, z.nombre, u.nombre, f.estado
       ORDER BY p.created_at DESC
       LIMIT 200`,
      isComercial ? [req.user.id] : []
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/pedidos/ventas-anuales
router.get('/ventas-anuales', auth, async (req, res, next) => {
  try {
    const isComercial = req.user.rol === 'comercial';
    const result = await pool.query(
      `SELECT p.id, p.numero, p.fecha_pedido,
             p.subtotal, p.igv, p.total,
             p.estado_despacho, p.lista_precios,
             COALESCE(f.estado, 'pendiente') AS estado_pago,
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
      LEFT JOIN facturas f ON f.pedido_id = p.id
      WHERE p.estado_despacho IN ('despachado','entregado')
        AND p.fecha_pedido >= CURRENT_DATE - INTERVAL '12 months'
        ${isComercial ? 'AND p.vendedor_id = $1' : ''}
      GROUP BY p.id, p.numero, p.fecha_pedido, p.subtotal, p.igv, p.total,
               p.estado_despacho, p.lista_precios, f.estado,
               c.nombre, c.codigo, tc.nombre, z.nombre, u.nombre
      ORDER BY p.fecha_pedido DESC`,
      isComercial ? [req.user.id] : []
    );
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

    const { estado_despacho } = req.body;
    if (estado_despacho !== 'entregado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se acepta estado_despacho: entregado' });
    }

    const result = await client.query(
      `UPDATE pedidos SET estado_despacho='entregado', updated_at=NOW()
       WHERE id=$1 AND estado_despacho != 'entregado' RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      const existing = await pool.query(`SELECT * FROM pedidos WHERE id=$1`, [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
      const factCheck = await pool.query(`SELECT * FROM facturas WHERE pedido_id=$1`, [req.params.id]);
      return res.json({ pedido: existing.rows[0], factura: factCheck.rows[0] || null });
    }

    const pedido = result.rows[0];

    // Descontar stock al entregar
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

    // Generar factura automáticamente (si no existe ya)
    let factura = null;
    const dupCheck = await client.query(
      `SELECT * FROM facturas WHERE pedido_id = $1`, [pedido.id]
    );
    if (!dupCheck.rows.length) {
      const seqRes = await client.query(`SELECT nextval('factura_seq') as n`);
      const factNumero = `F001-${String(seqRes.rows[0].n).padStart(5, '0')}`;

      const cliRes = await client.query(
        `SELECT tc.dias_credito FROM clientes c
         JOIN tipos_cliente tc ON tc.id = c.tipo_id
         WHERE c.id = $1`,
        [pedido.cliente_id]
      );
      const diasCredito = cliRes.rows[0]?.dias_credito || 30;
      const fechaVenc = new Date();
      fechaVenc.setDate(fechaVenc.getDate() + diasCredito);
      const fechaVencStr = fechaVenc.toISOString().split('T')[0];

      const factResult = await client.query(
        `INSERT INTO facturas (numero, pedido_id, cliente_id, monto_total, fecha_vencimiento, estado)
         VALUES ($1,$2,$3,$4,$5,'pendiente') RETURNING *`,
        [factNumero, pedido.id, pedido.cliente_id, pedido.total, fechaVencStr]
      );
      factura = factResult.rows[0];
    } else {
      factura = dupCheck.rows[0];
    }

    await client.query('COMMIT');
    res.json({ pedido, factura });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/pedidos/:id — editar pedido pendiente (recalcula totales y ajusta stock reservado)
router.put('/:id', auth, roles('admin', 'comercial', 'logistica'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pRes = await client.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
    if (!pRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const pedido = pRes.rows[0];

    if (pedido.estado_despacho === 'entregado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se puede editar un pedido ya entregado' });
    }

    if (req.user.rol === 'comercial') {
      const own = await client.query(
        'SELECT id FROM clientes WHERE id=$1 AND vendedor_id=$2',
        [pedido.cliente_id, req.user.id]
      );
      if (!own.rows.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Acceso denegado' });
      }
    }

    const { cliente_id, lista_precios, fecha_entrega, observaciones, items } = req.body;
    if (!items || !items.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Debe incluir al menos un item' });
    }

    // Revertir stock_reservado de los items actuales
    const oldItems = await client.query(
      'SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = $1',
      [pedido.id]
    );
    for (const it of oldItems.rows) {
      await client.query(
        `UPDATE inventario_pt SET stock_reservado = GREATEST(0, stock_reservado - $1)
         WHERE producto_id = $2`,
        [it.cantidad, it.producto_id]
      );
    }

    // Borrar items viejos
    await client.query('DELETE FROM pedido_items WHERE pedido_id = $1', [pedido.id]);

    // Recalcular y reinsertar items
    let subtotal = 0;
    const processed = items.map((it, idx) => {
      const sub = it.cantidad * it.precio_unitario * (1 - (it.descuento_pct || 0) / 100);
      subtotal += sub;
      return { ...it, linea: idx + 1, subtotal: sub };
    });
    const igv = subtotal * 0.18;
    const total = subtotal + igv;

    for (const it of processed) {
      await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, linea, cantidad,
          precio_unitario, descuento_pct, subtotal, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pedido.id, it.producto_id, it.linea, it.cantidad,
         it.precio_unitario, it.descuento_pct || 0, it.subtotal, it.notas || null]
      );
      await client.query(
        `UPDATE inventario_pt SET stock_reservado = stock_reservado + $1
         WHERE producto_id = $2`,
        [it.cantidad, it.producto_id]
      );
    }

    const updRes = await client.query(
      `UPDATE pedidos SET
         cliente_id    = COALESCE($1, cliente_id),
         lista_precios = COALESCE($2, lista_precios),
         fecha_entrega = $3,
         observaciones = $4,
         subtotal      = $5,
         igv           = $6,
         total         = $7,
         updated_at    = NOW()
       WHERE id = $8 RETURNING *`,
      [cliente_id || null, lista_precios || null, fecha_entrega || null,
       observaciones || null, subtotal, igv, total, pedido.id]
    );

    await client.query('COMMIT');
    res.json(updRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
