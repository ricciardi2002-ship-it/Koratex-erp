const express  = require('express');
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');

// ── Productos ────────────────────────────────────────────────────────────────
const productosRouter = express.Router();

// GET /api/productos
productosRouter.get('/', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, tp.nombre as tipo, i.stock_total, i.stock_reservado,
              (i.stock_total - i.stock_reservado) as stock_disponible
       FROM productos p
       JOIN tipos_producto tp ON tp.id = p.tipo_id
       LEFT JOIN inventario_pt i ON i.producto_id = p.id
       WHERE p.activo = TRUE
       ORDER BY p.codigo`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/productos/tipos/lista — debe ir ANTES de /:id para evitar shadowing
productosRouter.get('/tipos/lista', auth, async (req, res, next) => {
  try {
    const result = await query(`SELECT * FROM tipos_producto ORDER BY nombre`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/productos/:id
productosRouter.get('/:id', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, tp.nombre as tipo, i.stock_total, i.stock_reservado,
              (i.stock_total - i.stock_reservado) as stock_disponible
       FROM productos p
       JOIN tipos_producto tp ON tp.id = p.tipo_id
       LEFT JOIN inventario_pt i ON i.producto_id = p.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/productos
productosRouter.post('/', auth, roles('admin'), async (req, res, next) => {
  try {
    const { codigo, nombre, tipo_id, presentacion, precio_lista_a, precio_lista_b,
            precio_lista_c, costo_produccion, peso_kg } = req.body;
    const result = await query(
      `INSERT INTO productos (codigo, nombre, tipo_id, presentacion, precio_lista_a,
        precio_lista_b, precio_lista_c, costo_produccion, peso_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [codigo, nombre, tipo_id, presentacion, precio_lista_a,
       precio_lista_b, precio_lista_c, costo_produccion, peso_kg]
    );
    const prod = result.rows[0];
    await query(
      `INSERT INTO inventario_pt (producto_id, stock_total, stock_reservado) VALUES ($1, 0, 0)`,
      [prod.id]
    );
    res.status(201).json(prod);
  } catch (err) {
    next(err);
  }
});

// PUT /api/productos/:id
productosRouter.put('/:id', auth, roles('admin'), async (req, res, next) => {
  try {
    const { nombre, tipo_id, presentacion, precio_lista_a, precio_lista_b,
            precio_lista_c, costo_produccion, peso_kg, activo } = req.body;
    const result = await query(
      `UPDATE productos SET nombre=$1, tipo_id=$2, presentacion=$3, precio_lista_a=$4,
        precio_lista_b=$5, precio_lista_c=$6, costo_produccion=$7, peso_kg=$8, activo=$9
       WHERE id=$10 RETURNING *`,
      [nombre, tipo_id, presentacion, precio_lista_a, precio_lista_b,
       precio_lista_c, costo_produccion, peso_kg, activo, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});


// ── Clientes ─────────────────────────────────────────────────────────────────
const clientesRouter = express.Router();

// GET /api/clientes
clientesRouter.get('/', auth, async (req, res, next) => {
  try {
    const isComercial = req.user.rol === 'comercial';
    const result = await query(
      `SELECT c.*, tc.nombre as tipo_nombre, tc.lista_precios, tc.dias_credito,
              z.nombre as zona_nombre
       FROM clientes c
       JOIN tipos_cliente tc ON tc.id = c.tipo_id
       LEFT JOIN zonas z ON z.id = c.zona_id
       ${isComercial ? 'WHERE c.vendedor_id = $1' : ''}
       ORDER BY c.activo DESC, c.codigo`,
      isComercial ? [req.user.id] : []
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/clientes/zonas/lista — lista de zonas activas (debe ir antes de /:id)
clientesRouter.get('/zonas/lista', auth, async (req, res, next) => {
  try {
    const result = await query(`SELECT id, nombre FROM zonas WHERE activa = TRUE ORDER BY nombre`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/clientes/:id
clientesRouter.get('/:id', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*, tc.nombre as tipo_nombre, tc.lista_precios, tc.dias_credito,
              z.nombre as zona_nombre
       FROM clientes c
       JOIN tipos_cliente tc ON tc.id = c.tipo_id
       LEFT JOIN zonas z ON z.id = c.zona_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/clientes
clientesRouter.post('/', auth, roles('admin', 'comercial'), async (req, res, next) => {
  try {
    const { codigo, nombre, ruc, tipo_id, zona_id, direccion, telefono,
            email, lat, lng, limite_credito } = req.body;
    const vendedor_id = req.user.id;
    const result = await query(
      `INSERT INTO clientes (codigo, nombre, ruc, tipo_id, zona_id, direccion,
        telefono, email, lat, lng, limite_credito, vendedor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [codigo, nombre, ruc, tipo_id, zona_id, direccion,
       telefono, email, lat, lng, limite_credito, vendedor_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/clientes/:id
clientesRouter.put('/:id', auth, roles('admin', 'comercial'), async (req, res, next) => {
  try {
    if (req.user.rol === 'comercial') {
      const own = await query(`SELECT id FROM clientes WHERE id=$1 AND vendedor_id=$2`, [req.params.id, req.user.id]);
      if (!own.rows.length) return res.status(403).json({ error: 'Acceso denegado' });
    }
    const { nombre, ruc, tipo_id, zona_id, direccion, telefono,
            email, lat, lng, limite_credito, activo } = req.body;
    const result = await query(
      `UPDATE clientes SET nombre=$1, ruc=$2, tipo_id=$3, zona_id=$4, direccion=$5,
        telefono=$6, email=$7, lat=$8, lng=$9, limite_credito=$10, activo=$11
       WHERE id=$12 RETURNING *`,
      [nombre, ruc, tipo_id, zona_id, direccion, telefono,
       email, lat, lng, limite_credito, activo, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = { productosRouter, clientesRouter };
