# WhatsApp Bot — Sorbito de Verdad

Spec completo del bot **BuilderBot Cloud (BBC)** que conversa con clientes,
guía hacia compra, genera Payphone Link de Pago.

**Importante**: El backend NO envía notificaciones proactivas por WhatsApp
(prohibido por políticas de WhatsApp). Solo el bot responde dentro de la
ventana de 24h desde el último mensaje del cliente.

---

## Arquitectura runtime

```
WhatsApp ⇄ BuilderBot Cloud (este bot)
                │
                │ HTTP nodes (add_http)
                ▼
         Sorbito Backend (Express)
         POST /api/orders/guest
         POST /api/orders/:id/payphone-link
         POST /api/webhook/payphone-link    (recibe de Payphone)
         POST /api/orders/whatsapp-bot/*    (brain, checkout, transfer, etc.)
```

---

## Backend endpoints del bot

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/api/orders/whatsapp-bot/brain` | POST | Router principal: decide intent (catalog/shipping/checkout/transfer/search_order/chat) |
| `/api/orders/whatsapp-bot/assistant` | POST | Respuesta conversacional usando Gemini |
| `/api/orders/whatsapp-bot/catalog` | GET/POST | Devuelve catálogo de productos activos |
| `/api/orders/whatsapp-bot/shipping-info` | GET/POST | Devuelve tabla de envíos o cotización específica |
| `/api/orders/whatsapp-bot/checkout` | POST | Crea orden + genera link PayPhone (one-shot) |
| `/api/orders/whatsapp-bot/transfer` | POST | Crea orden con método transferencia bancaria |
| `/api/orders/whatsapp-bot/transfer-receipt` | GET/POST | Recibe comprobante de transferencia |
| `/api/orders/whatsapp-bot/search-order` | GET/POST | Busca pedidos por teléfono o email |
| `/api/orders/whatsapp-bot/complaint` | GET/POST | Registra reclamo y notifica al equipo por email |
| `/api/orders/whatsapp-bot/cart-update` | POST | Actualiza carrito temporal (TempCart) |

Todos los endpoints `/api/orders/whatsapp-bot/*` son públicos (sin auth).

---

## Assistant Instructions (BBC Welcome flow)

```
Eres el asistente de Sorbito de Verdad, marca artesanal ecuatoriana de tazas de cerámica.
Tono: cálido, cercano, sereno, en español neutro. Habla como un amigo experto en café.

CATÁLOGO Y COLECCIONES:
- Boscan — tazas blancas con diseño gafas+barba
- La Moni — tazas blancas con pestañas+labios rojos
- Artesanal Rústica — cerámica crema con relieve
- Sets — colecciones completas
Antes de recomendar precios o stock concretos, pide al cliente que te diga qué busca y solo nombra productos que conoces del scrape del sitio.

OBJETIVO: cerrar venta vía WhatsApp.

FLUJO DE CONVERSACIÓN:
1. Saluda y pregunta qué busca.
2. Sugiere 2-3 opciones acordes y muestra precio + stock disponible.
3. Captura, una a la vez si hace falta:
   - items: array {productId, name, quantity}  ← productId ES OBLIGATORIO (Mongo _id)
   - email: válido (ej: ana@gmail.com)
   - nombre completo
   - cédula / RUC (10 o 13 dígitos Ecuador)
   - dirección de envío: calle, ciudad, provincia, país (default Ecuador)
   - teléfono: usar el número de WhatsApp del cliente
4. Resume el pedido: "¿Confirmas X tazas de [nombre] por $Y, envío a [ciudad]?"
5. Cuando el cliente confirme con "sí / confirmo / quiero pagar / dame el link",
   responde EXACTAMENTE en este formato (una sola línea, sin texto extra antes ni después):

[CHECKOUT]{"customerEmail":"...","items":[{"product":"<MongoId>","quantity":N}],"shippingAddress":{"name":"...","phone":"<número WA>","street":"...","city":"...","state":"...","country":"Ecuador"},"identificationNumber":"...","source":"whatsapp_bot"}[/CHECKOUT]

REGLAS DE INTENTOS:
- El intent "transferencia" SOLO se activa si el cliente dice EXPLÍCITAMENTE "transferencia", "depósito", "banco", "produbanco".
- NO uses "transferencia" como fallback. Ante un mensaje genérico ("cuánto vale", "holi", "buenos días", un emoji, o contenido multimedia), responde de forma conversacional, NO con error de transferencia.
- Si el cliente no ha elegido método de pago, pregúntale: "¿Cómo prefieres pagar? ¿Con tarjeta (PayPhone) o transferencia bancaria?"

REGLAS DE CIUDAD Y ENVÍO:
- Cuando el cliente diga su ciudad DESPUÉS de ver la tabla de envíos, confirma: "Perfecto, para [ciudad] el envío es [gratis o $X]. ¿Continuamos?" — NO repitas la tabla.
- La tabla de envíos se muestra solo UNA VEZ por conversación.

REGLAS DE CÉDULA/RUC:
- Primera vez que da un número inválido: pídelo de nuevo amablemente.
- Segunda vez: ofrece "No tengo cédula ecuatoriana. ¿Tienes pasaporte o ID de tu país?"
- Para clientes internacionales (prefijo +1, +34, +39, etc.): acepta cualquier documento.

REGLAS DE SESIÓN:
- Revisa el historial completo antes de responder.
- Si la conversación ya avanzó (3+ intercambios), NO te vuelvas a presentar. Continúa natural.
- No reinicies el flujo aunque el cliente vuelva después de horas.

REGLAS:
- NUNCA inventes un product._id — si no lo tienes del scrape, di "déjame confirmar disponibilidad" y pregunta "qué taza específica quieres".
- Si stock=0 → sugerir alternativa similar de otra colección.
- Si pide hablar con humano: responde "te conecto con una persona" y deja que el flujo de escalación se active.
- No prometas tiempos de envío; di "te confirmamos al pagar".
- Si el cliente tiene un reclamo (producto incorrecto, cambio, devolución, demora): responde "Lamento el inconveniente. Te registro un caso y un asesor te escribe en máximo 24 horas."
- Cualquier mensaje fuera del flujo (ej: "qué horario tienen") → responde con info útil sin romper el flujo.

NUNCA:
- Mostrar el bloque [CHECKOUT]...[/CHECKOUT] como ejemplo o explicación al usuario.
- Inventar precios — sólo los del scrape del sitio.
- Enviar mensajes proactivos fuera de la ventana de 24h.
- Prometer "un asesor te contactará" sin registrar realmente el caso.
```

---

## Crear bot vía MCP

Usar el plugin `bbc-skill-tool` (BBC MCP v2.0). Pattern 2 (AI-powered).

### Paso 1 — Proyecto

```
builderbot_list_projects
builderbot_create_project(name="sorbito-de-verdad-bot")
builderbot_list_projects   # VERIFY
```

Guardar `projectId`.

### Paso 2 — Flow 1: Welcome (AI core)

```
builderbot_create_flow(
  projectId,
  name="Welcome AI",
  label="welcome",
  keywords=["EVENTS.WELCOME"],
  listenKeywords=false,
  transcribeAudio=false,
  interpretImage=false,
  analyzeDocument=false
)
builderbot_list_flows(projectId)   # VERIFY → guardar flowId
```

```
builderbot_create_answer(
  projectId,
  flowId,
  type="add_chatpdf",
  message=""
)
builderbot_list_answers(projectId, flowId)   # VERIFY → guardar answerId
```

```
builderbot_update_answer(
  projectId,
  flowId,
  answerId,
  assistant={
    "model": "gpt-5.4-nano",
    "scrapeUrl": "https://sorbitodeverdad.com",
    "instructions": "<INSERTAR INSTRUCTIONS DEL BLOQUE DE ARRIBA>"
  }
)
builderbot_list_answers(projectId, flowId)   # VERIFY
```

### Paso 3 — Flow 2: Checkout (HTTP encadenado)

Disparado cuando llega un mensaje del usuario que el bot interpreta como
confirmación. **Recomendado**: usar `add_intent` antes que keywords para
detectar la confirmación semánticamente.

```
builderbot_create_flow(
  projectId,
  name="Checkout",
  label="checkout",
  keywords=["confirmo","quiero pagar","dame el link","pagar ahora"],
  listenKeywords=false
)
```

#### Answer 2.1 — `add_http`: crear orden guest (one-shot checkout)

```
builderbot_create_answer(
  projectId,
  flowId,
  type="add_http",
  message="",
  plugins={
    "http": {
      "url": "https://sorbito-de-verdad-backapp.vercel.app/api/orders/whatsapp-bot/checkout",
      "method": "POST",
      "headers": { "Content-Type": "application/json" },
      "body": {
        "customerEmail": "{{email}}",
        "customerName": "{{name}}",
        "phone": "{{wa_phone}}",
        "identificationNumber": "{{cedula}}",
        "address": "{{street}}",
        "city": "{{city}}",
        "country": "{{country}}",
        "items": [{"name": "{{product}}", "price": "{{total}}", "quantity": 1}]
      },
      "rules": [
        { "path": "message", "var": "response_message" },
        { "path": "paymentLink", "var": "pay_url" },
        { "path": "orderNumber", "var": "order_number" },
        { "path": "total", "var": "order_total" }
      ]
    }
  }
)
```

#### Answer 2.2 — `add_text`: enviar link al cliente

```
builderbot_create_answer(
  projectId,
  flowId,
  type="add_text",
  message="{{response_message}}"
)
```

> CRÍTICO: TODO `add_http` requiere `plugins.http.rules` (aunque sea `[]`) o
> backend BBC rechaza con error.

### Paso 4 — Flow 3: Escalación humano

```
builderbot_create_flow(
  projectId,
  name="Escalación humano",
  label="human",
  keywords=["agente","humano","ayuda","persona","asesor"],
  listenKeywords=false
)
builderbot_create_answer(
  projectId, flowId,
  type="add_text",
  message="👋 Te conecto con una persona. Pausamos el bot 1 hora — pronto te responde alguien del equipo."
)
builderbot_create_answer(
  projectId, flowId,
  type="add_mute",
  message="",
  plugins={ "mute": { "status": true, "gapTime": 60 } }
)
```

### Paso 5 — Flow 4: Voice handler

```
builderbot_create_flow(
  projectId,
  name="Voice",
  label="voice",
  keywords=["EVENTS.VOICE_NOTE"],
  listenKeywords=true,
  transcribeAudio=true
)
builderbot_create_answer(
  projectId, flowId,
  type="add_chatpdf",
  message=""
)
builderbot_update_answer(
  projectId, flowId, answerId,
  assistant={
    "model": "gpt-5.4-nano",
    "scrapeUrl": "https://sorbitodeverdad.com",
    "instructions": "<MISMAS instructions del welcome>"
  }
)
```

### Paso 6 — Validación + Deploy

```
builderbot_validate_bot(projectId)
# Esperar criticalCount = 0. Fixear si no.

# GATE: mostrar resumen al usuario antes de desplegar.

builderbot_deploy(projectId, action="create")
builderbot_deploy(projectId, action="status")
# Cuando status=READY_TO_SCAN
builderbot_deploy(projectId, action="qr")
# Escanear con WhatsApp del número que opera el bot
```

---

## Backend URL

Producción:
```
https://sorbito-de-verdad-backapp.vercel.app
```

---

## Backend env vars

(setear en `.env` del backapp — ver `.env.example`)

```
PAYPHONE_TOKEN=...
PAYPHONE_STORE_ID=...
BBC_PROJECT_BASE_URL=https://<your-bbc-project-host>
BBC_API_KEY=...
CRON_SECRET=<long random>
WEBHOOK_PUBLIC_BASE=https://api.sorbitodeverdad.com
ADMIN_EMAIL=admin@sorbitodeverdad.com
```

`BBC_PROJECT_BASE_URL` se obtiene de `builderbot_deploy(action="status")`.

---

## Configurar Notificación Externa Payphone

1. Login en panel Developer Payphone.
2. Sección "Notificación Externa".
3. URL: `${WEBHOOK_PUBLIC_BASE}/api/webhook/payphone-link`
4. Método: POST
5. Trigger: pago aprobado.
6. Guardar.

---

## Verificación end-to-end (reducida)

1. **Backend up**: `npm run dev`
2. **ngrok**: `ngrok http 8100` → copiar URL HTTPS a `WEBHOOK_PUBLIC_BASE` y panel Payphone.
3. **Bot**: escanear QR; saludar al bot.
4. **Conversar**: pedir "una taza Boscan", dar email/cédula/dirección, confirmar.
5. **Recibir link**: bot envía URL `https://payp.page.link/...`.
6. **Pagar**: abrir link en navegador, completar pago test.
7. **Webhook confirma**: Payphone llama `POST /api/webhook/payphone-link` → orden se marca `paid`.

---

## Arquitectura de fixes aplicados (2026-06)

| Bug | Fix | Dónde |
|-----|-----|-------|
| BUG 1 — Transfer trigger falso | Transfer solo en keywords explícitas, nunca fallback | Gemini prompt + assistant instructions |
| BUG 2 — Mensajes duplicados | Dedup por hash (phone + mensaje) en 5s | `whatsappBotBrain` en controller |
| BUG 4 — Loop tabla envíos | Instrucción: mostrar tabla 1 vez, luego confirmar ciudad | Gemini prompt + assistant instructions |
| BUG 5 — No confirma ciudad | Instrucción: confirmar precio específico tras la tabla | Gemini prompt + assistant instructions |
| BUG 6 — Reinicio de flujo | Instrucción: no reintroducirse si hay historial | Gemini prompt + assistant instructions |
| BUG 7 — Loop cédula | Fallback a pasaporte/ID tras 2 intentos fallidos | Gemini prompt + assistant instructions |
| BUG 9 — Quejas sin escalación | Nuevo endpoint `/complaint` + notificación email | Controller + routes |
| BUG 12 — Doble link de pago | Verificar orden pendiente antes de crear nueva | `whatsappBotCheckout` en controller |
| Notificaciones proactivas | Eliminado servicio BBC (viola políticas WhatsApp) | `bbc-notification.service.ts` eliminado |

---

## Mantenimiento

- **Actualizar instructions**: re-llamar `builderbot_update_answer` con nueva
  `assistant.instructions` (usar las del bloque de arriba).
- **Ver logs**: `builderbot_deploy(action="status")` muestra estado runtime.
- **Reiniciar**: `builderbot_deploy(action="reboot")`.
- **Borrar**: `builderbot_deploy(action="delete")` ← GATE confirmación.
