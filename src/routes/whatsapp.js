const express = require('express');
const twilio = require('twilio');
const { query } = require('../config/db');
const { parsePedido, resolveCliente, resolveProducto } = require('../services/parsePedido');

const router = express.Router();

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM       = process.env.TWILIO_WHATSAPP_FROM; // ej: 'whatsapp:+14155238886'

// Middleware de validación de firma Twilio (en producción)
function validateTwilio(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const signature = req.header('X-Twilio-Signature');
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const valid = twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body);
  if (!valid) return res.status(403).send('Firma Twilio inválida');
  next();
}

function twiml(message) {
  const r = new twilio.twiml.MessagingResponse();
  r.message(message);
  return r.toString();
}

// POST /api/whatsapp/webhook — Twilio envía cada mensaje aquí
router.post('/webhook', validateTwilio, async (req, res) => {
  res.type('text/xml');
  const fromRaw = req.body.From || '';            // 'whatsapp:+5841412345678'
  const phone   = fromRaw.replace('whatsapp:', '').trim();
  const body    = (req.body.Body || '').trim();

  if (!phone || !body) {
    return res.send(twiml('No recibí ningún mensaje. Intenta de nuevo.'));
  }

  let logId, vendedor;
  try {
    // 1. Identificar vendedor por teléfono
    const userQ = await query(
      `SELECT u.id, u.nombre, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.activo = TRUE AND u.telefono = $1`,
      [phone]
    );
    vendedor = userQ.rows[0];

    if (!vendedor) {
      return res.send(twiml(
        '⚠️ Tu número no está registrado en Koratex ERP. Contacta al administrador.'
      ));
    }
    if (!['comercial', 'admin'].includes(vendedor.rol)) {
      return res.send(twiml('⚠️ No tienes permiso para crear pedidos.'));
    }

    // 2. Registrar log inicial
    const logQ = await query(
      `INSERT INTO whatsapp_log (from_phone, vendedor_id, raw_text, estado)
       VALUES ($1,$2,$3,'recibido') RETURNING id`,
      [phone, vendedor.id, body]
    );
    logId = logQ.rows[0].id;

    // 3. Cargar contexto de la BD para el parser
    const [clientes, productos] = await Promise.all([
      query(`SELECT codigo, nombre FROM clientes WHERE activo=TRUE ORDER BY nombre`),
      query(`SELECT codigo, nombre FROM productos WHERE activo=TRUE ORDER BY nombre`)
    ]);

    // 4. Parsear con Claude
    const parsed = await parsePedido(body, {
      clientes: clientes.rows,
      productos: productos.rows
    });

    await query(`UPDATE whatsapp_log SET parsed_json=$1 WHERE id=$2`, [parsed, logId]);

    if (parsed.error === 'no_es_pedido') {
      await query(`UPDATE whatsapp_log SET estado='ignorado' WHERE id=$1`, [logId]);
      return res.send(twiml(
        `Hola ${vendedor.nombre} 👋\nNo detecté un pedido en tu mensaje.\n\n` +
        `Ejemplo válido:\n"Pedido para Telares Carabobo: 50m de tela beige y 30m azul, entrega viernes"`
      ));
    }
    if (parsed.error === 'falta_info') {
      await query(`UPDATE whatsapp_log SET estado='incompleto', error=$1 WHERE id=$2`,
        [parsed.razon, logId]);
      return res.send(twiml(`⚠️ Falta información: ${parsed.razon}`));
    }

    // 5. Resolver cliente
    const cliente = await resolveCliente(parsed.cliente_match);
    if (!cliente) {
      await query(`UPDATE whatsapp_log SET estado='cliente_no_encontrado' WHERE id=$1`, [logId]);
      return res.send(twiml(
        `❌ No encontré al cliente "${parsed.cliente_match}".\n` +
        `Verifica el nombre o registralo primero en el ERP.`
      ));
    }

    // 6. Resolver productos
    const items = [];
    const noEncontrados = [];
    for (const it of (parsed.items || [])) {
      const prod = await resolveProducto(it.producto_match, cliente.lista_precios);
      if (!prod) { noEncontrados.push(it.producto_match); continue; }
      items.push({
        producto_id: prod.id,
        cantidad: parseInt(it.cantidad, 10),
        precio_unitario: parseFloat(prod.precio),
        descuento_pct: 0
      });
    }
    if (noEncontrados.length) {
      await query(`UPDATE whatsapp_log SET estado='productos_no_encontrados', error=$1 WHERE id=$2`,
        [noEncontrados.join(', '), logId]);
      return res.send(twiml(
        `❌ No encontré estos productos: ${noEncontrados.join(', ')}.\n` +
        `Verifica los nombres y reenvía el pedido.`
      ));
    }
    if (!items.length) {
      return res.send(twiml('❌ El pedido no tiene productos válidos.'));
    }

    // 7. Crear pedido (replica lógica de POST /api/pedidos)
    const numResult = await query(`SELECT nextval('pedido_seq') AS n`);
    const numero = `PED-${String(numResult.rows[0].n).padStart(5, '0')}`;

    let subtotal = 0;
    const processed = items.map((it, idx) => {
      const sub = it.cantidad * it.precio_unitario;
      subtotal += sub;
      return { ...it, linea: idx + 1, subtotal: sub };
    });
    const igv = subtotal * 0.18;
    const total = subtotal + igv;

    const pedRes = await query(
      `INSERT INTO pedidos (numero, cliente_id, vendedor_id, lista_precios, subtotal,
        igv, total, fecha_entrega, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, numero`,
      [numero, cliente.id, vendedor.id, cliente.lista_precios, subtotal,
       igv, total, parsed.fecha_entrega || null,
       `[WhatsApp] ${parsed.observaciones || ''}`.trim()]
    );
    const pedido = pedRes.rows[0];

    for (const it of processed) {
      await query(
        `INSERT INTO pedido_items (pedido_id, producto_id, linea, cantidad,
          precio_unitario, descuento_pct, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pedido.id, it.producto_id, it.linea, it.cantidad,
         it.precio_unitario, it.descuento_pct, it.subtotal]
      );
      await query(
        `UPDATE inventario_pt SET stock_reservado = stock_reservado + $1
         WHERE producto_id = $2`,
        [it.cantidad, it.producto_id]
      );
    }

    await query(
      `UPDATE whatsapp_log SET pedido_id=$1, estado='creado' WHERE id=$2`,
      [pedido.id, logId]
    );

    const resumen = processed.map(it =>
      `  • ${it.cantidad} u. — ${it.precio_unitario.toFixed(2)} c/u`
    ).join('\n');

    return res.send(twiml(
      `✅ Pedido ${pedido.numero} registrado\n` +
      `Cliente: ${cliente.nombre}\n` +
      `${resumen}\n` +
      `Subtotal: ${subtotal.toFixed(2)}\n` +
      `IGV: ${igv.toFixed(2)}\n` +
      `Total: ${total.toFixed(2)}`
    ));

  } catch (err) {
    console.error('[whatsapp/webhook]', err);
    if (logId) {
      await query(`UPDATE whatsapp_log SET estado='error', error=$1 WHERE id=$2`,
        [err.message, logId]).catch(() => {});
    }
    return res.send(twiml(
      '⚠️ Error procesando el pedido. Un administrador fue notificado.'
    ));
  }
});

// GET /api/whatsapp/log — historial (para admin desde el ERP)
const { auth, roles } = require('../middleware/auth');
router.get('/log', auth, roles('admin'), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT wl.*, u.nombre AS vendedor_nombre, p.numero AS pedido_numero
       FROM whatsapp_log wl
       LEFT JOIN usuarios u ON u.id = wl.vendedor_id
       LEFT JOIN pedidos p  ON p.id = wl.pedido_id
       ORDER BY wl.created_at DESC LIMIT 100`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

module.exports = router;
