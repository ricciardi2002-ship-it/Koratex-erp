const { query } = require('../config/db');

/**
 * Aplica un cobro a las facturas pendientes de un cliente usando FIFO.
 * Devuelve el cobro creado + el detalle de aplicación por factura.
 *
 * @param {object} db         - función query (para poder inyectar en tests)
 * @param {object} params
 * @param {string} params.clienteId
 * @param {number} params.monto        - total recibido (> 0)
 * @param {string} params.tipoPago     - efectivo | transferencia | cheque
 * @param {string} params.referencia   - opcional
 * @param {string} params.fechaPago    - YYYY-MM-DD
 * @param {string} params.notas        - opcional
 * @param {string} params.usuarioId
 */
async function aplicarCobroFIFO(db, {
  clienteId, monto, tipoPago, referencia, fechaPago, notas, usuarioId
}) {
  // 1. Validar saldo pendiente del cliente
  const saldoRes = await db(
    `SELECT COALESCE(SUM(monto_total - monto_pagado), 0) AS saldo
     FROM facturas
     WHERE cliente_id = $1 AND estado != 'pagada'`,
    [clienteId]
  );
  const saldoTotal = parseFloat(saldoRes.rows[0].saldo);
  if (monto <= 0) throw Object.assign(new Error('El monto debe ser mayor a 0'), { status: 400 });
  if (monto > saldoTotal + 0.001) {
    throw Object.assign(
      new Error(`El monto $${monto.toFixed(2)} supera el saldo pendiente $${saldoTotal.toFixed(2)}`),
      { status: 400 }
    );
  }

  // 2. Insertar registro de cobro
  const cobroRes = await db(
    `INSERT INTO cobros (cliente_id, usuario_id, monto, tipo_pago, referencia, fecha_pago, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [clienteId, usuarioId, monto, tipoPago, referencia || null, fechaPago, notas || null]
  );
  const cobro = cobroRes.rows[0];

  // 3. Cargar facturas pendientes ordenadas por fecha_emision ASC (FIFO)
  const facturasRes = await db(
    `SELECT id, numero, monto_total, monto_pagado, fecha_vencimiento
     FROM facturas
     WHERE cliente_id = $1 AND estado != 'pagada'
     ORDER BY fecha_emision ASC, created_at ASC`,
    [clienteId]
  );

  // 4. Distribuir monto FIFO
  let restante = parseFloat(monto);
  const aplicaciones = [];

  for (const f of facturasRes.rows) {
    if (restante <= 0) break;

    const saldoFact = parseFloat(f.monto_total) - parseFloat(f.monto_pagado);
    const aplicar   = Math.min(restante, saldoFact);
    const nuevoPagado = parseFloat(f.monto_pagado) + aplicar;
    const nuevoEstado = nuevoPagado >= parseFloat(f.monto_total) - 0.001 ? 'pagada' : 'abonado';

    // Registrar aplicación
    await db(
      `INSERT INTO cobros_aplicaciones (cobro_id, factura_id, monto_aplicado)
       VALUES ($1,$2,$3)`,
      [cobro.id, f.id, aplicar]
    );

    // Actualizar factura
    await db(
      `UPDATE facturas SET monto_pagado = $1, estado = $2 WHERE id = $3`,
      [nuevoPagado, nuevoEstado, f.id]
    );

    aplicaciones.push({
      factura_id:     f.id,
      factura_numero: f.numero,
      monto_aplicado: aplicar,
      estado_nuevo:   nuevoEstado,
    });

    restante = Math.round((restante - aplicar) * 100) / 100;
  }

  return { cobro, aplicaciones };
}

module.exports = { aplicarCobroFIFO };
