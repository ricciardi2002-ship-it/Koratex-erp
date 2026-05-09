const express = require('express');
const bcrypt  = require('bcryptjs');
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');

const router = express.Router();

// GET /api/usuarios — lista todos (admin)
router.get('/', auth, roles('admin'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT u.id, u.nombre, u.email, u.telefono, u.activo, u.created_at,
             r.id as rol_id, r.nombre as rol, r.descripcion as rol_desc
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
      ORDER BY r.id, u.nombre
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/usuarios/roles — roles disponibles (admin)
router.get('/roles', auth, roles('admin'), async (req, res, next) => {
  try {
    const result = await query(`SELECT id, nombre, descripcion FROM roles ORDER BY id`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/usuarios — crear usuario (admin)
router.post('/', auth, roles('admin'), async (req, res, next) => {
  try {
    const { nombre, email, password, rol_id, telefono } = req.body;
    if (!nombre || !email || !password || !rol_id) {
      return res.status(400).json({ error: 'Nombre, email, contraseña y rol son requeridos' });
    }
    const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol_id, telefono)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, email, telefono, activo, created_at`,
      [nombre, email, hash, rol_id, telefono || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/usuarios/:id — editar nombre / rol / contraseña (admin)
router.patch('/:id', auth, roles('admin'), async (req, res, next) => {
  try {
    const { nombre, email, password, rol_id, telefono } = req.body;
    const fields = []; const values = []; let idx = 1;

    if (nombre)   { fields.push(`nombre=$${idx++}`);       values.push(nombre); }
    if (email)    { fields.push(`email=$${idx++}`);        values.push(email); }
    if (rol_id)   { fields.push(`rol_id=$${idx++}`);       values.push(rol_id); }
    if (telefono !== undefined) { fields.push(`telefono=$${idx++}`); values.push(telefono || null); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash=$${idx++}`); values.push(hash);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });

    values.push(req.params.id);
    const result = await query(
      `UPDATE usuarios SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${idx} RETURNING id, nombre, email, activo`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/usuarios/:id/toggle — activar / desactivar (admin, no puede desactivarse a sí mismo)
router.patch('/:id/toggle', auth, roles('admin'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }
    const result = await query(
      `UPDATE usuarios SET activo = NOT activo, updated_at=NOW() WHERE id=$1 RETURNING id, nombre, activo`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
