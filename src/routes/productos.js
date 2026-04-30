// src/routes/productos.js
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');

// GET /api/productos
router.get('/', auth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT p.*, tp.nombre AS tipo_nombre,
             ipt.stock_total, ipt.stock_reservado,
             (ipt.stock_total - ipt.stock_reservado) AS stock_disponible
      FROM productos p
      JOIN tipos_producto tp ON tp.id = p.tipo_id
      LEFT JOIN inventario_pt ipt ON ipt.producto_id = p.id
      WHERE p.activo = true
      ORDER BY p.codigo`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/productos
router.post('/', auth, roles('admin'), async (req, res, next) => {
  try {
    const { codigo, nombre, tipo_id, presentacion, precio_lista_a,
            precio_lista_b, precio_lista_c, costo_produccion, peso_kg } = req.body;

    const result = await query(`
      INSERT INTO productos (codigo, nombre, tipo_id, presentacion,
        precio_lista_a, precio_lista_b, precio_lista_c, costo_produccion, peso_kg)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [codigo, nombre, tipo_id, presentacion,
       precio_lista_a, precio_lista_b, precio_lista_c, costo_produccion || 0, peso_kg || 0]
    );

    // Crear registro en inventario PT
    await query(
      `INSERT INTO inventario_pt (producto_id, stock_total, stock_reservado) VALUES ($1,0,0)`,
      [result.rows[0].id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/productos/:id
router.patch('/:id', auth, roles('admin'), async (req, res, next) => {
  try {
    const { nombre, presentacion, precio_lista_a, precio_lista_b,
            precio_lista_c, costo_produccion, activo } = req.body;
    const result = await query(`
      UPDATE productos SET
        nombre = COALESCE($1, nombre),
        presentacion = COALESCE($2, presentacion),
        precio_lista_a = COALESCE($3, precio_lista_a),
        precio_lista_b = COALESCE($4, precio_lista_b),
        precio_lista_c = COALESCE($5, precio_lista_c),
        costo_produccion = COALESCE($6, costo_produccion),
        activo = COALESCE($7, activo)
      WHERE id = $8 RETURNING *`,
      [nombre, presentacion, precio_lista_a, precio_lista_b,
       precio_lista_c, costo_produccion, activo, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;


// ─────────────────────────────────────────────
// src/routes/clientes.js
// ─────────────────────────────────────────────
const router2 = express.Router();

router2.get('/', auth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.*, tc.nombre AS tipo_nombre, tc.lista_precios, tc.dias_credito,
             z.nombre AS zona_nombre
      FROM clientes c
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN zonas z ON z.id = c.zona_id
      WHERE c.activo = true
      ORDER BY c.nombre`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router2.post('/', auth, roles('admin', 'comercial'), async (req, res, next) => {
  try {
    const { codigo, nombre, ruc, tipo_id, zona_id, direccion,
            telefono, email, lat, lng, limite_credito } = req.body;
    const result = await query(`
      INSERT INTO clientes
        (codigo, nombre, ruc, tipo_id, zona_id, direccion, telefono, email, lat, lng, limite_credito)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [codigo, nombre, ruc, tipo_id, zona_id, direccion, telefono, email, lat, lng, limite_credito || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router2.patch('/:id', auth, roles('admin', 'comercial'), async (req, res, next) => {
  try {
    const { nombre, ruc, tipo_id, zona_id, direccion,
            telefono, email, limite_credito, activo } = req.body;
    const result = await query(`
      UPDATE clientes SET
        nombre = COALESCE($1, nombre), ruc = COALESCE($2, ruc),
        tipo_id = COALESCE($3, tipo_id), zona_id = COALESCE($4, zona_id),
        direccion = COALESCE($5, direccion), telefono = COALESCE($6, telefono),
        email = COALESCE($7, email), limite_credito = COALESCE($8, limite_credito),
        activo = COALESCE($9, activo)
      WHERE id = $10 RETURNING *`,
      [nombre, ruc, tipo_id, zona_id, direccion, telefono, email, limite_credito, activo, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = { productosRouter: router, clientesRouter: router2 };
