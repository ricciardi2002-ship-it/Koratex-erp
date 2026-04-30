// src/middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.message);

  // Error de PostgreSQL
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Registro duplicado', detalle: err.detail });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referencia inválida', detalle: err.detail });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Valor fuera de rango permitido' });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = { errorHandler };


// src/utils/audit.js
const { query } = require('../config/db');

const audit = async (usuarioId, modulo, accion, tabla, registroId, detalle) => {
  try {
    await query(
      `INSERT INTO audit_log (usuario_id, modulo, accion, tabla, registro_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuarioId, modulo, accion, tabla, registroId, JSON.stringify(detalle)]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
};

module.exports = { audit };
