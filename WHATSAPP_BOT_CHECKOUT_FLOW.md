# WhatsApp Bot — Checkout sin escalación humana

Bot: https://app.builderbot.cloud/project/83457ab6-a0df-4b07-b91f-e0fa8d19d45f/

## Problema actual

Cuando bot termina de captar pedido (email, items, dirección) escala a humano:
> "Te conecto con un asesor humano. En un momento te escribirán..."

## Solución

Bot llama backend → backend crea orden + link PayPhone → bot envía link → webhook recibe pago → backend manda confirmación WhatsApp via BBC API.

Backend nuevo: ya construido.

---

## Backend: endpoints listos

### 1) Checkout one-shot (lo llama el bot)

```
POST https://sorbito-de-verdad-backapp.vercel.app/api/orders/whatsapp-bot/checkout
Content-Type: application/json

{
  "customerEmail": "diego@example.com",
  "customerName": "Diego Reyes",
  "phone": "593987654321",
  "address": "Av. Amazonas N12-34",
  "city": "Quito",
  "items": [
    { "name": "Taza Boscan blanca", "price": 12.50, "quantity": 2 }
  ],
  "notes": "Envolver para regalo"
}
```

Respuesta:
```json
{
  "success": true,
  "paymentLink": "https://pay.payphonetodoesposible.com/...",
  "orderNumber": "SDV-...",
  "orderId": "...",
  "total": 30.00,
  "expiresAt": "2026-05-13T..."
}
```

Items soportan dos modos:
- Catálogo: `{ "product": "<mongo-id>", "quantity": 2 }` (valida stock)
- Custom (lo que AI captura libre): `{ "name": "...", "price": 12.5, "quantity": 2 }`

### 2) Webhook PayPhone (ya configurado en PayPhone)

```
POST https://sorbito-de-verdad-backapp.vercel.app/api/webhook/payphone-link
```

Cuando recibe `paid`/approved:
- Marca orden `paymentStatus=paid`
- Llama `bbcNotificationService.sendPaidConfirmation(order)` → envía vía `BBC_PROJECT_BASE_URL/v1/messages` con tu `BBC_API_KEY`
- Mensaje: `"✅ ¡Pago confirmado! Pedido SDV-... por $XX. Pronto te enviamos detalles de envío..."`

### 3) Recordatorios automáticos

Cron `*/5 * * * *` envía a órdenes `paymentStatus=pending` + `source=whatsapp_bot`:
- 15min: recordatorio suave
- 1h: recordatorio
- 24h: último aviso
- 48h: cancela orden

---

## BuilderBot dashboard: cambios necesarios

### A) Variables de entorno (Vercel, ya configurar)

```
BBC_PROJECT_BASE_URL=https://app.builderbot.cloud/api/<tu-project-id>
BBC_API_KEY=<tu-api-key>
```

Verificar formato exacto del base URL — debe responder a `POST {BBC_PROJECT_BASE_URL}/v1/messages` con body `{ number, message }`.

### B) Modificar AI assistant (flow welcome)

En las **instrucciones del `add_chatpdf`** del flow welcome, agregar al final:

```
Cuando el cliente confirme que quiere pagar y tengas: email, teléfono, dirección, ciudad y la lista completa de items con precios → responde EXACTAMENTE con la palabra clave "PROCESAR_PAGO" y nada más. NO escales a humano. NO ofrezcas hablar con asesor.
```

### C) Reemplazar el flow de escalación

**Flow actual (a borrar o reescribir):** el que tiene `add_mute` + texto "te conecto con asesor humano".

**Flow nuevo: "checkout"**

Keyword: `PROCESAR_PAGO` (texto exacto). `listenKeywords: false`.

Answers en orden:

**1. `add_text` (captura datos)**
```
Confirmando tu pedido. Escribe en un solo mensaje:
EMAIL | TELÉFONO | DIRECCIÓN | CIUDAD | ITEMS (ej: 2 tazas Boscan a 12.50)
```
- `options.capture = true`

**2. `add_http`**
```json
{
  "url": "https://sorbito-de-verdad-backapp.vercel.app/api/orders/whatsapp-bot/checkout",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": {
    "customerEmail": "{{email}}",
    "customerName": "{{name}}",
    "phone": "{{from}}",
    "address": "{{address}}",
    "city": "{{city}}",
    "items": [{ "name": "{{itemName}}", "price": {{itemPrice}}, "quantity": {{itemQty}} }]
  },
  "rules": [
    { "field": "paymentLink", "saveAs": "paymentLink" },
    { "field": "orderNumber", "saveAs": "orderNumber" },
    { "field": "total", "saveAs": "total" }
  ]
}
```

**3. `add_text`**
```
✅ Pedido {{orderNumber}} creado por ${{total}}.

Paga aquí: {{paymentLink}}

Link válido 24h. En cuanto se confirme te aviso por aquí ☕
```

### D) Opción mejor (recomendada): AI captura todo y llama HTTP

Si el `add_chatpdf` soporta tool-calling/function_call en tu plan BBC, configurar tool en el assistant:

```json
{
  "name": "create_payment_link",
  "description": "Crea orden y link de pago PayPhone cuando cliente confirme pedido",
  "url": "https://sorbito-de-verdad-backapp.vercel.app/api/orders/whatsapp-bot/checkout",
  "method": "POST",
  "parameters": ["customerEmail","customerName","phone","address","city","items","notes"]
}
```

Si no, usar pattern (B+C) arriba.

---

## Flujo completo

```
Cliente → "quiero comprar 2 tazas Boscan"
Bot (AI) → conversa, captura email/dirección/teléfono
Bot (AI) → "PROCESAR_PAGO"
[redirect a flow checkout]
Bot → POST /api/orders/whatsapp-bot/checkout
Backend → crea orden + PayPhone link
Bot → "Paga aquí: <link>"
Cliente paga en PayPhone
PayPhone → webhook → backend
Backend → marca paid + POST /v1/messages a BBC
Bot → "✅ Pago confirmado..."
```

NO humano. NO mute. Todo automático.

---

## Validación pre-deploy

```bash
# 1. compile
cd sorbito-de-verdad-backapp && npx tsc --noEmit

# 2. probar endpoint local
curl -X POST http://localhost:8100/api/orders/whatsapp-bot/checkout \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"test@test.com","customerName":"Test","phone":"593999999999","address":"Calle X","city":"Quito","items":[{"name":"Taza test","price":10,"quantity":1}]}'

# 3. verificar BBC outbound (con BBC_PROJECT_BASE_URL configurado)
curl -X POST $BBC_PROJECT_BASE_URL/v1/messages \
  -H "Authorization: Bearer $BBC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"number":"593999999999","message":"test"}'
```
