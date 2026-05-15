const express = require('express');
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');
const { aplicarCobroFIFO } = require('../services/fifo');

const router = express.Router();

// GET /api/cobros/cliente/:id — cuenta por cobrar (facturas + saldo)
router.get('/cliente/:id', auth, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.rol === 'comercial') {
      const own = await query(`SELECT id FROM clientes WHERE id=$1 AND vendedor_id=$2`, [id, req.user.id]);
      if (!own.rows.length) return res.status(403).json({ error: 'Acceso denegado' });
    }

    const [cliRes, facRes] = await Promise.all([
      query(`SELECT id, nombre, codigo FROM clientes WHERE id = $1`, [id]),
      query(
        `SELECT id, numero, pedido_id,
                monto_total, monto_pagado,
                (monto_total - monto_pagado) AS saldo,
                fecha_emision, fecha_vencimiento, estado,
                (CURRENT_DATE - fecha_vencimiento) AS dias_vencida
         FROM facturas
         WHERE cliente_id = $1
         ORDER BY fecha_emision ASC, created_at ASC`,
        [id]
      ),
    ]);

    if (!cliRes.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const facturas = facRes.rows.map(f => ({
      ...f,
      monto_total:  parseFloat(f.monto_total),
      monto_pagado: parseFloat(f.monto_pagado),
      saldo:        parseFloat(f.saldo),
      dias_vencida: parseInt(f.dias_vencida, 10),
    }));

    const saldo_total = facturas
      .filter(f => f.estado !== 'pagada')
      .reduce((s, f) => s + f.saldo, 0);

    res.json({ cliente: cliRes.rows[0], facturas, saldo_total });
  } catch (err) { next(err); }
});

// GET /api/cobros/cliente/:id/historial — pagos registrados con desglose
router.get('/cliente/:id/historial', auth, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.rol === 'comercial') {
      const own = await query(`SELECT id FROM clientes WHERE id=$1 AND vendedor_id=$2`, [id, req.user.id]);
      if (!own.rows.length) return res.status(403).json({ error: 'Acceso denegado' });
    }

    const cobrosRes = await query(
      `SELECT c.*, u.nombre AS usuario_nombre
       FROM cobros c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.cliente_id = $1
       ORDER BY c.fecha_pago DESC, c.created_at DESC`,
      [id]
    );

    // Para cada cobro, cargar su desglose de aplicaciones
    const cobros = await Promise.all(cobrosRes.rows.map(async cobro => {
      const appsRes = await query(
        `SELECT ca.monto_aplicado, f.numero AS factura_numero,
                f.monto_total, f.estado AS factura_estado
         FROM cobros_aplicaciones ca
         JOIN facturas f ON f.id = ca.factura_id
         WHERE ca.cobro_id = $1
         ORDER BY f.fecha_emision ASC`,
        [cobro.id]
      );
      return {
        ...cobro,
        monto: parseFloat(cobro.monto),
        aplicaciones: appsRes.rows.map(a => ({
          ...a,
          monto_aplicado: parseFloat(a.monto_aplicado),
          monto_total:    parseFloat(a.monto_total),
        })),
      };
    }));

    res.json(cobros);
  } catch (err) { next(err); }
});

// POST /api/cobros — registrar cobro con FIFO
router.post('/', auth, roles('admin', 'finanzas', 'comercial'), async (req, res, next) => {
  try {
    const { cliente_id, monto, tipo_pago, referencia, fecha_pago, notas } = req.body;

    if (!cliente_id || !monto || !fecha_pago) {
      return res.status(400).json({ error: 'cliente_id, monto y fecha_pago son requeridos' });
    }

    if (req.user.rol === 'comercial') {
      const own = await query(`SELECT id FROM clientes WHERE id=$1 AND vendedor_id=$2`, [cliente_id, req.user.id]);
      if (!own.rows.length) return res.status(403).json({ error: 'Acceso denegado' });
    }

    const result = await aplicarCobroFIFO(query, {
      clienteId:  cliente_id,
      monto:      parseFloat(monto),
      tipoPago:   tipo_pago || 'efectivo',
      referencia: referencia || null,
      fechaPago:  fecha_pago,
      notas:      notas || null,
      usuarioId:  req.user.id,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
