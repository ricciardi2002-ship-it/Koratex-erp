# Integración WhatsApp → Koratex ERP

Los vendedores envían pedidos por WhatsApp en lenguaje natural y el ERP los registra automáticamente usando Claude API para interpretar el mensaje.

## Arquitectura

```
Vendedor (WhatsApp)
       ↓
Twilio (recibe el mensaje)
       ↓ POST webhook
/api/whatsapp/webhook  ← Express
       ↓
Claude API (extrae cliente + productos + cantidades)
       ↓
Lookup en BD (matching fuzzy de cliente y productos)
       ↓
INSERT en pedidos + pedido_items
       ↓
Twilio responde al vendedor con confirmación
```

## Setup paso a paso

### 1. Cuenta Twilio

1. Crear cuenta en https://www.twilio.com (tier gratuito permite probar)
2. Ir a **Console → Messaging → Try it out → Send a WhatsApp message**
3. Activar WhatsApp en tu número Business o usar el Sandbox para pruebas

### 2. Variables de entorno

Copia `.env.example` a `.env` y completa:

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+58XXXXXXXXX   # Tu número Business
ANTHROPIC_API_KEY=sk-ant-...                 # https://console.anthropic.com
```

### 3. Configurar webhook en Twilio

En Twilio Console → **Messaging → Settings → WhatsApp Sandbox Settings** (o el número de producción):

- **When a message comes in** → `https://tu-dominio.com/api/whatsapp/webhook`
- Method: `POST`

> Si estás desarrollando local, usa [ngrok](https://ngrok.com): `ngrok http 3000`

### 4. Registrar el teléfono de cada vendedor

En el ERP, módulo **Usuarios**, edita cada vendedor y completa el campo "Teléfono" con el número en formato internacional **sin** el prefijo `whatsapp:`:

```
+584141234567
```

El número debe coincidir EXACTAMENTE con el que usa el vendedor en WhatsApp (Twilio lo envía con el prefijo `whatsapp:` que el backend remueve).

### 5. Probar

El vendedor envía a tu número Business:

```
Pedido para Telares Carabobo:
50m de tela beige
30m de tela azul
Entrega viernes
```

El ERP responde:

```
✅ Pedido PED-00457 registrado
Cliente: Telares Carabobo
  • 50 u. — 12.50 c/u
  • 30 u. — 14.00 c/u
Subtotal: 1045.00
IGV: 188.10
Total: 1233.10
```

## Auditoría

Cada mensaje queda registrado en la tabla `whatsapp_log` con:
- Texto crudo recibido
- JSON parseado por Claude
- Estado (`recibido`, `creado`, `cliente_no_encontrado`, `productos_no_encontrados`, `incompleto`, `ignorado`, `error`)
- ID del pedido creado (si aplica)

Disponible en `GET /api/whatsapp/log` (solo admin).

## Costos aproximados

- **Twilio WhatsApp**: ~$0.005/mensaje + $0.02/conversación de 24h (Venezuela)
- **Claude Haiku 4.5** para parsing: ~$0.001 por pedido (con prompt caching)

## Seguridad

- En producción (`NODE_ENV=production`) se valida la firma `X-Twilio-Signature` para rechazar webhooks falsos.
- Solo usuarios con rol `comercial` o `admin` pueden crear pedidos por WhatsApp.
- Si el teléfono no está registrado en `usuarios.telefono`, el mensaje es rechazado.

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| "Tu número no está registrado" | Falta el `telefono` del vendedor en Usuarios |
| "No encontré al cliente X" | El cliente no existe en BD o el matching fuzzy no lo encuentra. Verifica el nombre/código |
| "No encontré estos productos" | Mismo: revisa nombre exacto o código del producto |
| Webhook no llega | Verifica que la URL pública del servidor sea accesible y que esté configurada en Twilio Console |
| Firma inválida (403) | El `TWILIO_AUTH_TOKEN` no coincide con el de la consola Twilio |
