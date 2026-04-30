const express  = require('express');
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');

const router = express.Router();

// GET /api/inventario  — productos terminados
router.get('/', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.id, p.codigo, p.nombre, tp.nombre as tipo, p.presentacion,
              p.peso_kg, i.stock_total, i.stock_reservado,
              (i.stock_total - i.stock_reservado) as stock_disponible,
              i.updated_at
       FROM inventario_pt i
       JOIN productos p ON p.id = i.producto_id
       JOIN tipos_producto tp ON tp.id = p.tipo_id
       WHERE p.activo = TRUE
       ORDER BY p.codigo`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/inventario/:productoId  — ajuste de stock
router.patch('/:productoId', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { ajuste, motivo } = req.body;
    if (ajuste === undefined) return res.status(400).json({ error: 'Campo ajuste requerido' });

    const result = await query(
      `UPDATE inventario_pt
       SET stock_total = stock_total + $1, updated_at = NOW()
       WHERE producto_id = $2 RETURNING *`,
      [ajuste, req.params.productoId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado en inventario' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/inventario/materias-primas
router.get('/materias-primas', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT mp.*, p.nombre as proveedor_nombre
       FROM materias_primas mp
       LEFT JOIN proveedores p ON p.id = mp.proveedor_id
       WHERE mp.activo = TRUE
       ORDER BY mp.codigo`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/inventario/materias-primas/:id
router.patch('/materias-primas/:id', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const { ajuste } = req.body;
    if (ajuste === undefined) return res.status(400).json({ error: 'Campo ajuste requerido' });

    const result = await query(
      `UPDATE materias_primas
       SET stock_actual = stock_actual + $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [ajuste, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Materia prima no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/inventario/alertas
router.get('/alertas', auth, async (req, res, next) => {
  try {
    const bajoStock = await query(
      `SELECT mp.codigo, mp.nombre, mp.unidad, mp.stock_actual, mp.stock_minimo,
              'materia_prima' as tipo
       FROM materias_primas mp
       WHERE mp.activo = TRUE AND mp.stock_actual <= mp.stock_minimo`
    );
    res.json(bajoStock.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
