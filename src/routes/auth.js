const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { query } = require('../config/db');
const { auth }  = require('../middleware/auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'koratex_secret_dev_only';

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  const ip = clientIp(req);
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const result = await query(
      `SELECT u.id, u.nombre, u.email, u.password_hash, u.activo, r.nombre as rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE LOWER(u.email) = LOWER($1)`,
      [email]
    );

    const user = result.rows[0];

    if (!user || !user.activo) {
      // Registrar intento fallido
      await query(
        `INSERT INTO audit_log (accion, detalle, ip) VALUES ('login_fallido', $1, $2)`,
        [email.toLowerCase(), ip]
      ).catch(() => {});
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await query(
        `INSERT INTO audit_log (accion, detalle, ip) VALUES ('login_fallido', $1, $2)`,
        [email.toLowerCase(), ip]
      ).catch(() => {});
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Registrar login exitoso
    await query(
      `INSERT INTO audit_log (usuario_id, accion, detalle, ip) VALUES ($1, 'login_ok', $2, $3)`,
      [user.id, user.email, ip]
    ).catch(() => {});

    // Actualizar último acceso
    await query(
      `UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1`,
      [user.id]
    ).catch(() => {});

    const token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.nombre, u.email, u.activo, r.nombre as rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res) => {
  await query(
    `INSERT INTO audit_log (usuario_id, accion, detalle, ip) VALUES ($1, 'logout', $2, $3)`,
    [req.user.id, req.user.email, clientIp(req)]
  ).catch(() => {});
  res.json({ message: 'Sesión cerrada' });
});

// GET /api/auth/audit — historial de accesos (solo admin)
router.get('/audit', auth, async (req, res, next) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  try {
    const result = await query(
      `SELECT al.id, al.accion, al.detalle, al.ip, al.created_at,
              u.nombre as usuario_nombre
       FROM audit_log al
       LEFT JOIN usuarios u ON u.id = al.usuario_id
       ORDER BY al.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
