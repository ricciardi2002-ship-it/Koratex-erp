const Anthropic = require('@anthropic-ai/sdk');
const { query } = require('../config/db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres un extractor de pedidos para Koratex ERP (fábrica textil en Venezuela).
Recibes un mensaje de WhatsApp escrito por un vendedor en lenguaje natural y debes devolver
ÚNICAMENTE un objeto JSON válido con esta estructura exacta:

{
  "cliente_match": "<nombre o código del cliente que mencionó el vendedor>",
  "items": [
    { "producto_match": "<nombre/código del producto>", "cantidad": <número entero> }
  ],
  "observaciones": "<notas adicionales si las hay, o cadena vacía>",
  "fecha_entrega": "<YYYY-MM-DD si la mencionó, o null>"
}

Reglas:
- Si el mensaje no parece un pedido, devuelve {"error": "no_es_pedido", "razon": "<explicación corta>"}
- Si falta información crítica (cliente o productos), devuelve {"error": "falta_info", "razon": "<qué falta>"}
- Las cantidades son números enteros. Si el vendedor dice "50 metros de tela beige", cantidad=50.
- Sé tolerante a errores de tipeo y abreviaturas comunes.
- Devuelve SOLO el JSON, sin texto explicativo, sin bloques de código markdown.`;

async function parsePedido(rawText, { clientes, productos }) {
  // Construir contexto compacto: solo nombres y códigos
  const clienteList = clientes.map(c => `${c.codigo}:${c.nombre}`).join('\n');
  const productoList = productos.map(p => `${p.codigo}:${p.nombre}`).join('\n');

  const userMessage = `MENSAJE DEL VENDEDOR:
"""
${rawText}
"""

CLIENTES DISPONIBLES (codigo:nombre):
${clienteList}

PRODUCTOS DISPONIBLES (codigo:nombre):
${productoList}

Extrae el pedido como JSON.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
    ],
    messages: [{ role: 'user', content: userMessage }]
  });

  const text = response.content[0].text.trim();
  // Limpieza defensiva por si Claude envuelve en code fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// Resuelve nombres/códigos parciales contra la BD
async function resolveCliente(matchStr) {
  const q = `%${matchStr.toLowerCase()}%`;
  const r = await query(
    `SELECT c.id, c.codigo, c.nombre, tc.lista_precios
     FROM clientes c JOIN tipos_cliente tc ON tc.id = c.tipo_id
     WHERE c.activo = TRUE
       AND (LOWER(c.nombre) LIKE $1 OR LOWER(c.codigo) LIKE $1)
     ORDER BY LENGTH(c.nombre) ASC LIMIT 1`,
    [q]
  );
  return r.rows[0] || null;
}

async function resolveProducto(matchStr, listaPrecios) {
  const q = `%${matchStr.toLowerCase()}%`;
  const priceCol = `precio_lista_${(listaPrecios || 'A').toLowerCase()}`;
  const r = await query(
    `SELECT id, codigo, nombre, ${priceCol} AS precio
     FROM productos WHERE activo = TRUE
       AND (LOWER(nombre) LIKE $1 OR LOWER(codigo) LIKE $1)
     ORDER BY LENGTH(nombre) ASC LIMIT 1`,
    [q]
  );
  return r.rows[0] || null;
}

module.exports = { parsePedido, resolveCliente, resolveProducto };
