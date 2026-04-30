// src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const result = await query(
      `SELECT u.*, r.nombre as rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.email = $1 AND u.activo = true`,
      [email.toLowerCase().trim()]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Generar tokens
    const token = jwt.sign(
      { id: user.id, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_EXPIRES_IN || '7d' }
    );

    // Guardar refresh token
    await query(
      `INSERT INTO sesiones (usuario_id, refresh_token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
    );

    // Actualizar último acceso
    await query(
      `UPDATE usuarios SET updated_at = NOW() WHERE id = $1`,
      [user.id]
    );

    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token requerido' });

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    const session = await query(
      `SELECT * FROM sesiones WHERE refresh_token = $1 AND expires_at > NOW()`,
      [refreshToken]
    );
    if (!session.rows.length) {
      return res.status(401).json({ error: 'Sesión expirada, inicia sesión nuevamente' });
    }

    const userRes = await query(
      `SELECT u.*, r.nombre as rol FROM usuarios u
       JOIN roles r ON r.id = u.rol_id WHERE u.id = $1`,
      [decoded.id]
    );
    const user = userRes.rows[0];
    const newToken = jwt.sign(
      { id: user.id, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token: newToken });
  } catch (err) {
    return res.status(401).json({ error: 'Refresh token inválido' });
  }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query(`DELETE FROM sesiones WHERE refresh_token = $1`, [refreshToken]);
    }
    res.json({ ok: true, mensaje: 'Sesión cerrada' });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
