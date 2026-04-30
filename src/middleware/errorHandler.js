const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.message);

  if (err.code === '23505') {
    return res.status(409).json({ error: 'Registro duplicado' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referencia inválida' });
  }

  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Error interno del servidor' });
};

const audit = async (usuarioId, modulo, accion, tabla, registroId, detalle) => {
  try {
    const { query } = require('../config/db');
    await query(
      `INSERT INTO audit_log (usuario_id, modulo, accion, tabla, registro_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuarioId, modulo, accion, tabla, registroId, JSON.stringify(detalle)]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
};

module.exports = { errorHandler, audit };
