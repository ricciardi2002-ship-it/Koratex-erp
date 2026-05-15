const { pool } = require('../config/db');

/**
 * Aplica un cobro a las facturas pendientes de un cliente usando FIFO.
 * Toda la operación corre dentro de una transacción atómica.
 */
async function aplicarCobroFIFO(dbOrPool, {
  clienteId, monto, tipoPago, referencia, fechaPago, notas, usuarioId
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Validar saldo pendiente del cliente
    const saldoRes = await client.query(
      `SELECT COALESCE(SUM(monto_total - monto_pagado), 0) AS saldo
       FROM facturas
       WHERE cliente_id = $1 AND estado NOT IN ('pagada')`,
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
    const cobroRes = await client.query(
      `INSERT INTO cobros (cliente_id, usuario_id, monto, tipo_pago, referencia, fecha_pago, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [clienteId, usuarioId, monto, tipoPago, referencia || null, fechaPago, notas || null]
    );
    const cobro = cobroRes.rows[0];

    // 3. Cargar facturas pendientes ordenadas FIFO (más antigua primero)
    const facturasRes = await client.query(
      `SELECT id, numero, monto_total, monto_pagado, fecha_vencimiento
       FROM facturas
       WHERE cliente_id = $1 AND estado NOT IN ('pagada')
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

      await client.query(
        `INSERT INTO cobros_aplicaciones (cobro_id, factura_id, monto_aplicado)
         VALUES ($1,$2,$3)`,
        [cobro.id, f.id, aplicar]
      );

      await client.query(
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

    await client.query('COMMIT');
    return { cobro, aplicaciones };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { aplicarCobroFIFO };
