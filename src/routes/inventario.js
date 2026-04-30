// src/routes/inventario.js
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');
const { audit } = require('../middleware/errorHandler');

// ─── MATERIA PRIMA ───

// GET /api/inventario/mp
router.get('/mp', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT mp.*,
        p.nombre AS proveedor_nombre,
        CASE
          WHEN mp.stock_actual <= mp.stock_minimo             THEN 'critico'
          WHEN mp.stock_actual <= mp.stock_minimo * 1.5       THEN 'advertencia'
          ELSE 'ok'
        END AS estado_stock,
        CASE
          WHEN mp.consumo_mensual > 0
          THEN ROUND((mp.stock_actual / mp.consumo_mensual * 30)::numeric, 0)
          ELSE NULL
        END AS dias_cobertura
      FROM materias_primas mp
      LEFT JOIN proveedores p ON p.id = mp.proveedor_id
      WHERE mp.activo = true
      ORDER BY (mp.stock_actual / NULLIF(mp.stock_minimo,0)) ASC`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// PATCH /api/inventario/mp/:id
router.patch('/mp/:id', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { stock_minimo, stock_maximo, consumo_mensual } = req.body;
    const result = await query(`
      UPDATE materias_primas SET
        stock_minimo     = COALESCE($1, stock_minimo),
        stock_maximo     = COALESCE($2, stock_maximo),
        consumo_mensual  = COALESCE($3, consumo_mensual),
        updated_at       = NOW()
      WHERE id = $4 RETURNING *`,
      [stock_minimo, stock_maximo, consumo_mensual, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Material no encontrado' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── PRODUCTO TERMINADO ───

// GET /api/inventario/pt
router.get('/pt', auth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT ipt.*,
        pr.codigo, pr.nombre, pr.presentacion, pr.precio_lista_a,
        pr.costo_produccion,
        tp.nombre AS tipo_nombre,
        (ipt.stock_total - ipt.stock_reservado) AS stock_disponible,
        CASE
          WHEN (ipt.stock_total - ipt.stock_reservado) <= 50  THEN 'critico'
          WHEN (ipt.stock_total - ipt.stock_reservado) <= 100 THEN 'advertencia'
          ELSE 'ok'
        END AS estado_stock
      FROM inventario_pt ipt
      JOIN productos pr ON pr.id = ipt.producto_id
      JOIN tipos_producto tp ON tp.id = pr.tipo_id
      WHERE pr.activo = true
      ORDER BY pr.codigo`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/inventario/pt/ajuste  (entrada de producción o corrección)
router.post('/pt/ajuste', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { producto_id, tipo, cantidad, referencia, motivo } = req.body;
    if (!producto_id || !tipo || !cantidad || cantidad <= 0) {
      return res.status(400).json({ error: 'producto_id, tipo y cantidad son requeridos' });
    }

    let sql;
    if (tipo === 'entrada') {
      sql = `UPDATE inventario_pt
             SET stock_total = stock_total + $1, updated_at = NOW()
             WHERE producto_id = $2 RETURNING *`;
    } else if (tipo === 'salida') {
      sql = `UPDATE inventario_pt
             SET stock_total = GREATEST(0, stock_total - $1), updated_at = NOW()
             WHERE producto_id = $2 RETURNING *`;
    } else {
      return res.status(400).json({ error: 'tipo debe ser entrada o salida' });
    }

    const result = await query(sql, [cantidad, producto_id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado en inventario' });

    await audit(req.user.id, 'logistica', `AJUSTE_PT_${tipo.toUpperCase()}`,
      'inventario_pt', producto_id, { cantidad, referencia, motivo });

    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── ÓRDENES DE COMPRA ───

// GET /api/inventario/compras
router.get('/compras', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT oc.*, p.nombre AS proveedor_nombre, mp.nombre AS material_nombre,
             mp.unidad
      FROM ordenes_compra oc
      JOIN proveedores p ON p.id = oc.proveedor_id
      JOIN materias_primas mp ON mp.id = oc.materia_prima_id
      ORDER BY oc.created_at DESC`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/inventario/compras  (crear OC)
router.post('/compras', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { proveedor_id, materia_prima_id, cantidad, precio_unitario, fecha_entrega, notas } = req.body;
    if (!proveedor_id || !materia_prima_id || !cantidad || !precio_unitario) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const seqRes = await query(`SELECT COUNT(*)+1 AS n FROM ordenes_compra`);
    const numero = 'OC-' + new Date().getFullYear() + '-' +
      String(parseInt(seqRes.rows[0].n)).padStart(4, '0');

    const total = Math.round(cantidad * precio_unitario * 100) / 100;

    const result = await query(`
      INSERT INTO ordenes_compra
        (numero, proveedor_id, materia_prima_id, cantidad, precio_unitario, total, fecha_entrega, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [numero, proveedor_id, materia_prima_id, cantidad, precio_unitario, total, fecha_entrega || null, notas || null]
    );

    await audit(req.user.id, 'logistica', 'CREAR_ORDEN_COMPRA',
      'ordenes_compra', result.rows[0].id, { numero, total });

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/inventario/compras/:id/recibir  (⚡ actualiza stock MP automáticamente)
router.patch('/compras/:id/recibir', auth, roles('admin', 'logistica'), async (req, res, next) => {
  const client = await require('../config/db').pool.connect();
  try {
    await client.query('BEGIN');

    const oc = await client.query(
      `SELECT * FROM ordenes_compra WHERE id = $1`, [req.params.id]
    );
    if (!oc.rows.length) return res.status(404).json({ error: 'Orden no encontrada' });
    if (oc.rows[0].estado === 'recibido') {
      return res.status(400).json({ error: 'Esta orden ya fue recibida' });
    }

    // Actualizar OC
    await client.query(
      `UPDATE ordenes_compra SET estado = 'recibido' WHERE id = $1`,
      [req.params.id]
    );

    // ⚡ Actualizar stock MP automáticamente
    const mpRes = await client.query(
      `UPDATE materias_primas
       SET stock_actual = LEAST(stock_actual + $1, stock_maximo),
           updated_at   = NOW()
       WHERE id = $2 RETURNING *`,
      [oc.rows[0].cantidad, oc.rows[0].materia_prima_id]
    );

    await client.query('COMMIT');

    await audit(req.user.id, 'logistica', 'RECIBIR_COMPRA_MP',
      'materias_primas', oc.rows[0].materia_prima_id,
      { oc_numero: oc.rows[0].numero, cantidad_recibida: oc.rows[0].cantidad,
        nuevo_stock: mpRes.rows[0].stock_actual });

    res.json({ orden: oc.rows[0], stock_actualizado: mpRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/inventario/proveedores
router.get('/proveedores', auth, async (req, res, next) => {
  try {
    const result = await query(`SELECT * FROM proveedores WHERE activo=true ORDER BY nombre`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
