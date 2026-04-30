const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query(
      `SELECT u.id, u.nombre, u.email, u.activo, r.nombre as rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.id = $1`,
      [decoded.id]
    );
    if (!result.rows.length || !result.rows[0].activo) {
      return res.status(401).json({ error: 'Usuario no autorizado' });
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const roles = (...rolesPermitidos) => (req, res, next) => {
  if (!rolesPermitidos.includes(req.user.rol)) {
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  }
  next();
};

module.exports = { auth, roles };
