# Construir el bot — Dashboard BBC paso a paso

Tiempo estimado: **10-15 min**.
Backend: `https://sorbito-de-verdad-backapp.vercel.app`
Cada paso = 1 click + 1 paste.

---

## ⚙️ Setup inicial

1. Abre https://console.builderbot.app
2. Login con tu cuenta (la que generó la API key `bbc-1a982c21-...`)
3. **+ New Project** → nombre: `sorbito-de-verdad-bot` → Save
4. Click en el proyecto → entras al editor de flows

---

## 🤖 FLOW 1 — Welcome AI (catch-all)

### Crear flow

Click **+ New Flow** → llena:

| Campo | Valor |
|---|---|
| Name | `Welcome AI` |
| Label | `welcome` |
| Keywords | `EVENTS.WELCOME` |
| Listen keywords | **OFF** |
| Transcribe audio | OFF |
| Interpret image | OFF |
| Analyze document | OFF |

→ **Save**

### Agregar answer

Dentro del flow → **+ Add answer** → tipo: **add_chatpdf** → message: dejar **vacío** → **Save**

Después click en la answer recién creada → pestaña **Assistant** o **AI Settings**:

| Campo | Valor |
|---|---|
| Model | `gpt-5.4-nano` |
| Scrape URL | `https://sorbitodeverdad.com` |

**Instructions** (copiar tal cual):

```
Eres el asistente de Sorbito de Verdad, marca artesanal ecuatoriana de tazas de cerámica.
Tono: cálido, cercano, sereno, en español neutro.

CATÁLOGO Y COLECCIONES:
- Boscan — tazas blancas con diseño gafas+barba
- La Moni — tazas blancas con pestañas+labios rojos
- Artesanal Rústica — cerámica crema con relieve
- Sets — colecciones completas
Sólo nombra productos que conozcas del scrape de https://sorbitodeverdad.com.

OBJETIVO: cerrar venta vía WhatsApp.

FLUJO DE CONVERSACIÓN:
1. Saluda y pregunta qué busca.
2. Sugiere 2-3 opciones con precio + stock.
3. Captura uno a uno: items (productId Mongo + cantidad), email, nombre completo, cédula/RUC, dirección (calle, ciudad, provincia, país=Ecuador), teléfono (número WA del cliente).
4. Resume: "¿Confirmas X tazas de [nombre] por $Y, envío a [ciudad]?"
5. Cuando el cliente confirme con "sí/confirmo/quiero pagar/dame el link", responde TEXTUAL la palabra clave "CONFIRMAR_COMPRA" al inicio del mensaje, junto con el resumen final. Esto activa el flujo de checkout.

REGLAS:
- NUNCA inventes product._id — si no lo tienes del scrape, di "déjame confirmar disponibilidad".
- Si stock=0 → sugiere alternativa similar.
- Si pide humano: di "te conecto con una persona".
- No prometas tiempos de envío.
- Si pide efectivo/transferencia: "Por WhatsApp gestionamos sólo Payphone (tarjeta). Para transferencia te conecto con asesor."
```

→ **Save**

✅ **Verifica**: el flow debe tener **1 answer** (add_chatpdf) — NO mezclar con add_text.

---

## 💳 FLOW 2 — Checkout Payphone (3 answers encadenadas)

### Crear flow

| Campo | Valor |
|---|---|
| Name | `Checkout Payphone` |
| Label | `checkout` |
| Keywords | `CONFIRMAR_COMPRA, confirmo el pedido, quiero pagar ahora, dame el link de pago` |
| Listen keywords | **OFF** |

→ **Save**

### Answer 2.1 — `add_http` Crear orden guest

**+ Add answer** → tipo: **add_http** → message vacío → **Save**

Click en la answer → pestaña **HTTP Plugin**:

| Campo | Valor |
|---|---|
| URL | `https://sorbito-de-verdad-backapp.vercel.app/api/orders/guest` |
| Method | `POST` |

**Headers** (1 línea):
```
Content-Type: application/json
```

**Body** (paste):
```json
{
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
}
```

**Rules** (3 reglas — agregar uno por uno):
| Path | Var |
|---|---|
| `data._id` | `order_id` |
| `data.orderNumber` | `order_number` |
| `data.total` | `order_total` |

→ **Save**

### Answer 2.2 — `add_http` Crear Payphone Link

**+ Add answer** → tipo: **add_http** → message vacío → **Save**

| Campo | Valor |
|---|---|
| URL | `https://sorbito-de-verdad-backapp.vercel.app/api/orders/{{order_id}}/payphone-link` |
| Method | `POST` |

**Headers**:
```
Content-Type: application/json
```

**Body**: vacío (no hace falta)

**Rules** (2 reglas):
| Path | Var |
|---|---|
| `data.paymentLink` | `pay_url` |
| `data.expiresAt` | `pay_expires` |

→ **Save**

### Answer 2.3 — `add_text` Enviar link al cliente

**+ Add answer** → tipo: **add_text** → message:

```
✅ Pedido {{order_number}} por ${{order_total}}. Paga aquí: {{pay_url}} — el link expira en 24h. Te aviso cuando confirmemos pago ☕
```

→ **Save**

✅ **Verifica**: flow tiene **3 answers** en orden: add_http → add_http → add_text.

> ⚠️ Cada `add_http` requiere `rules` definido (aunque sea vacío). El backend
> BBC rechaza si falta.

---

## 🆘 FLOW 3 — Escalación humano

### Crear flow

| Campo | Valor |
|---|---|
| Name | `Escalación humano` |
| Label | `human` |
| Keywords | `agente, humano, asesor, persona, quiero hablar con alguien` |
| Listen keywords | **OFF** |

→ **Save**

### Answer 3.1 — `add_text`

```
👋 Te conecto con una persona. Pausamos el bot 1 hora — pronto te responde el equipo.
```

→ **Save**

### Answer 3.2 — `add_mute`

**+ Add answer** → tipo: **add_mute** → message vacío

Plugin Mute:
| Campo | Valor |
|---|---|
| status | `true` (ON) |
| gapTime | `60` |

→ **Save**

✅ Flow con **2 answers**.

---

## 🎤 FLOW 4 — Voice (notas de voz)

### Crear flow

| Campo | Valor |
|---|---|
| Name | `Voice` |
| Label | `voice` |
| Keywords | `EVENTS.VOICE_NOTE` |
| Listen keywords | **ON** ⚠️ (único flow con ON) |
| Transcribe audio | **ON** |

→ **Save**

### Answer 4.1 — `add_chatpdf`

**+ Add answer** → tipo: **add_chatpdf** → message vacío → **Save**

Click answer → AI Settings:
- Model: `gpt-5.4-nano`
- Scrape URL: `https://sorbitodeverdad.com`
- Instructions:
```
Eres el asistente de Sorbito de Verdad. El usuario envió una nota de voz; responde por escrito con el mismo flujo del welcome (saludar, sugerir, capturar datos, confirmar, palabra clave CONFIRMAR_COMPRA al cerrar).
```

→ **Save**

---

## ✅ Validar bot

En el dashboard busca botón **Validate** o **Health Check**.

Esperado: `criticalCount = 0`. Si aparece algún rojo:
- "Empty flow" → añadir answer
- "Message too long" → acortar a ≤160 chars
- "Capture on last answer" → quitar capture
- "Multi-type flow" → si add_chatpdf y add_text en mismo flow → eliminar uno

---

## 📤 Deploy + QR

1. Click **Deploy** (o Connect WhatsApp / Activate)
2. Espera estado `READY_TO_SCAN`
3. Click **Show QR**
4. Escanea con WhatsApp del número que opera el bot

---

## 🔧 Tras el deploy — pegar URL al backend

El dashboard te dará una URL pública del proyecto desplegado, algo como:
```
https://abc123.bbc.builderbot.cloud
```

Pégala en `.env` del backend:
```
BBC_PROJECT_BASE_URL=https://abc123.bbc.builderbot.cloud
```

Sin esto, el webhook Payphone no podrá notificar al cliente cuando confirme
pago. Después redeploy del backapp en Vercel para que tome el nuevo env var.

---

## 🧪 Smoke test final

1. Manda "hola" al WhatsApp del bot → debe responder con AI welcome
2. Pide una taza Boscan, completa datos, confirma con "quiero pagar"
3. Recibe link `https://payp.page.link/...`
4. Verifica admin: `https://sorbitodeverdad.com/admin/orders` muestra orden
   con badge **WhatsApp Bot**
5. Abre el link, paga test
6. Webhook Payphone fires → backend → BBC API → te llega WA "✅ Pago confirmado"
7. (Opcional) crea otra orden y NO pagues — espera 15 min → recordatorio
   automático

---

## 📞 Configurar Notificación Externa Payphone

Una sola vez:
1. Login panel Developer Payphone
2. Sección **Notificación Externa**
3. URL: `https://sorbito-de-verdad-backapp.vercel.app/api/webhook/payphone-link`
4. Método: **POST**
5. Trigger: pago aprobado
6. Save

Sin esto el backend no se entera de pagos.

---

## 📋 Checklist final

- [ ] 4 flows creados (Welcome AI, Checkout, Escalación, Voice)
- [ ] Welcome AI: 1 answer (add_chatpdf con instructions)
- [ ] Checkout: 3 answers (add_http × 2 + add_text)
- [ ] Escalación: 2 answers (add_text + add_mute)
- [ ] Voice: 1 answer (add_chatpdf con instructions)
- [ ] Validate → criticalCount=0
- [ ] Deploy → QR escaneado
- [ ] BBC_PROJECT_BASE_URL pegada en backend .env
- [ ] Backend redeployado en Vercel con nuevo env
- [ ] Notificación Externa Payphone apuntando al webhook backend
- [ ] Smoke test e2e: orden + pago test + WA confirmación

🎉 Bot live.
