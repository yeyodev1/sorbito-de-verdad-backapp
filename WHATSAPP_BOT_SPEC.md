# WhatsApp Bot — Sorbito de Verdad

Spec completo del bot **BuilderBot Cloud (BBC)** que conversa con clientes,
guía hacia compra, genera Payphone Link de Pago y hace seguimiento autónomo.

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
         GET  /api/cron/payment-reminders   (Vercel Cron)
                │
                │ axios → BBC `/v1/messages`
                ▼
         Mensajes salientes WhatsApp
         (confirmación pago + recordatorios)
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
    "instructions": "<INSERTAR INSTRUCTIONS DEL BLOQUE DE ABAJO>"
  }
)
builderbot_list_answers(projectId, flowId)   # VERIFY
```

#### Instructions del assistant (welcome)

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

REGLAS:
- NUNCA inventes un product._id — si no lo tienes del scrape, di "déjame confirmar disponibilidad" y pregunta "qué taza específica quieres".
- Si stock=0 → sugerir alternativa similar de otra colección.
- Si pide hablar con humano: responde "te conecto con una persona" y deja que el flujo de escalación se active.
- No prometas tiempos de envío; di "te confirmamos al pagar".
- Si el cliente intenta pagar con efectivo / transferencia, responde:
  "Por WhatsApp gestionamos sólo Payphone (tarjeta). Si prefieres transferencia, te conecto con un asesor."
- Cualquier mensaje fuera del flujo (ej: "qué horario tienen") → responde con info útil sin romper el flujo.

NUNCA:
- Mostrar el bloque [CHECKOUT]...[/CHECKOUT] como ejemplo o explicación al usuario.
- Inventar precios — sólo los del scrape del sitio.
```

### Paso 3 — Flow 2: Checkout (HTTP encadenado)

Disparado cuando llega un mensaje del usuario que el bot interpreta como
confirmación. **Recomendado**: usar `add_intent` antes que keywords para
detectar la confirmación semánticamente, y dentro del flow extraer el bloque
`[CHECKOUT]{...}[/CHECKOUT]` que el assistant ya colocó en el contexto.

> NOTA OPERATIVA: BBC `add_http` interpola variables `{{var}}` desde respuestas
> previas y del estado del intent. Si la versión de BBC en uso no soporta
> parsing de JSON-en-texto del último mensaje del bot, alternativa: el flow 1
> puede capturar paso a paso (capture: true por respuesta) cada campo en
> variables individuales (`{{email}}`, `{{name}}`, etc.) y el flow 2 simplemente
> compone el body. Validar este detalle al construir.

```
builderbot_create_flow(
  projectId,
  name="Checkout",
  label="checkout",
  keywords=["confirmo","quiero pagar","dame el link","pagar ahora"],
  listenKeywords=false
)
```

#### Answer 2.1 — `add_http`: crear orden guest

```
builderbot_create_answer(
  projectId,
  flowId,
  type="add_http",
  message="",
  plugins={
    "http": {
      "url": "https://sorbito-de-verdad-backapp.vercel.app/api/orders/guest",
      "method": "POST",
      "headers": { "Content-Type": "application/json" },
      "body": {
        "customerEmail": "{{email}}",
        "items": "{{items}}",
        "shippingAddress": {
          "name": "{{name}}",
          "phone": "{{wa_phone}}",
          "street": "{{street}}",
          "city": "{{city}}",
          "state": "{{state}}",
          "country": "{{country}}"
        },
        "identificationNumber": "{{cedula}}",
        "paymentMethod": "payphone",
        "source": "whatsapp_bot"
      },
      "rules": [
        { "path": "data._id",         "var": "order_id" },
        { "path": "data.orderNumber", "var": "order_number" },
        { "path": "data.total",       "var": "order_total" }
      ]
    }
  }
)
```

#### Answer 2.2 — `add_http`: crear Link Payphone

```
builderbot_create_answer(
  projectId,
  flowId,
  type="add_http",
  message="",
  plugins={
    "http": {
      "url": "https://sorbito-de-verdad-backapp.vercel.app/api/orders/{{order_id}}/payphone-link",
      "method": "POST",
      "headers": { "Content-Type": "application/json" },
      "rules": [
        { "path": "data.paymentLink", "var": "pay_url" },
        { "path": "data.expiresAt",   "var": "pay_expires" }
      ]
    }
  }
)
```

#### Answer 2.3 — `add_text`: enviar link

```
builderbot_create_answer(
  projectId,
  flowId,
  type="add_text",
  message="✅ Pedido {{order_number}} creado por ${{order_total}}.\n\nPaga aquí: {{pay_url}}\n\nEl link expira en 24h. Te aviso por aquí cuando se confirme tu pago ☕"
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

Producción (hardcodeado en este spec):
```
https://sorbito-de-verdad-backapp.vercel.app
```

---

## Backend env vars que el bot toca

(setear en `.env` del backapp — ver `.env.example`)

```
PAYPHONE_TOKEN=...
PAYPHONE_STORE_ID=...
BBC_PROJECT_BASE_URL=https://<your-bbc-project-host>
BBC_API_KEY=...
CRON_SECRET=<long random>
WEBHOOK_PUBLIC_BASE=https://api.sorbitodeverdad.com
```

`BBC_PROJECT_BASE_URL` se obtiene de `builderbot_deploy(action="status")` —
respuesta incluye URL pública del proyecto.

`CRON_SECRET` lo configuras tú; Vercel Cron lo manda automáticamente como
`Authorization: Bearer <CRON_SECRET>` si lo declaras como env var del
proyecto Vercel.

---

## Configurar Notificación Externa Payphone

1. Login en panel Developer Payphone.
2. Sección "Notificación Externa".
3. URL: `${WEBHOOK_PUBLIC_BASE}/api/webhook/payphone-link`
4. Método: POST
5. Trigger: pago aprobado.
6. Guardar.

---

## Verificación end-to-end

1. **Backend up**: `npm run dev` en backapp; logs muestran
   `[local-cron] payment-reminders interval started`.
2. **ngrok**: `ngrok http 8100` → copiar URL HTTPS a `WEBHOOK_PUBLIC_BASE` y
   al panel Payphone.
3. **Bot**: escanear QR; saludar al bot.
4. **Conversar**: pedir "una taza Boscan", dar email/cédula/dirección, confirmar.
5. **Recibir link**: bot envía URL `https://payp.page.link/...`.
6. **Verificar admin**: `/admin/orders` muestra orden con badge "WhatsApp Bot",
   sección Pago Payphone con `clientTransactionId` + link.
7. **Pagar**: abrir link en navegador, completar pago test.
8. **Confirmación**: webhook `/api/webhook/payphone-link` recibe POST →
   `paymentStatus=paid`, `status=confirmed` → bot envía WhatsApp confirmando.
9. **Recordatorios**: crear segunda orden y NO pagar; esperar 15 min →
   bot envía recordatorio. Verificar `remindersSent.r15min` en admin.

---

## Mantenimiento

- **Actualizar instructions**: re-llamar `builderbot_update_answer` con nueva
  `assistant.instructions`.
- **Ver logs**: `builderbot_deploy(action="status")` muestra estado runtime.
- **Reiniciar**: `builderbot_deploy(action="reboot")`.
- **Borrar**: `builderbot_deploy(action="delete")` ← GATE confirmación.
