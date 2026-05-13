# BBC MCP — Llamadas listas para ejecutar

Archivo para pegar en una sesión Claude Code donde el MCP **bbc-skill-tool**
esté conectado (mostrando los tools `builderbot_*`).

> Backend prod: `https://sorbito-de-verdad-backapp.vercel.app`
> No hace falta deploy/QR — solo crear la config completa.

## Reemplazos antes de ejecutar

Donde dice `<PROJECT_ID>` o `<FLOW_X_ID>` → guardar el UUID que devuelve la
llamada anterior y pegarlo abajo.

---

## 0. Listar proyectos existentes

```
builderbot_list_projects()
```

Si ya existe un proyecto **sorbito-de-verdad-bot**, saltar el paso 1.

---

## 1. Crear proyecto

```
builderbot_create_project(name="sorbito-de-verdad-bot")
builderbot_list_projects()    # VERIFY → guardar projectId como <PROJECT_ID>
```

---

## 2. Flow Welcome (AI core)

```
builderbot_create_flow(
  projectId="<PROJECT_ID>",
  name="Welcome AI",
  label="welcome",
  keywords=["EVENTS.WELCOME"],
  listenKeywords=false,
  transcribeAudio=false,
  interpretImage=false,
  analyzeDocument=false
)
builderbot_list_flows(projectId="<PROJECT_ID>")
# VERIFY → guardar flowId como <WELCOME_FLOW_ID>
```

```
builderbot_create_answer(
  projectId="<PROJECT_ID>",
  flowId="<WELCOME_FLOW_ID>",
  type="add_chatpdf",
  message=""
)
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<WELCOME_FLOW_ID>")
# VERIFY → guardar answerId como <WELCOME_ANSWER_ID>
```

```
builderbot_update_answer(
  projectId="<PROJECT_ID>",
  flowId="<WELCOME_FLOW_ID>",
  answerId="<WELCOME_ANSWER_ID>",
  assistant={
    "model": "gpt-5.4-nano",
    "scrapeUrl": "https://sorbitodeverdad.com",
    "instructions": "Eres el asistente de Sorbito de Verdad, marca artesanal ecuatoriana de tazas de cerámica. Tono: cálido, cercano, sereno, en español neutro.\n\nCATÁLOGO Y COLECCIONES:\n- Boscan — tazas blancas con diseño gafas+barba\n- La Moni — tazas blancas con pestañas+labios rojos\n- Artesanal Rústica — cerámica crema con relieve\n- Sets — colecciones completas\nSólo nombra productos que conozcas del scrape de https://sorbitodeverdad.com.\n\nOBJETIVO: cerrar venta vía WhatsApp.\n\nFLUJO:\n1. Saluda y pregunta qué busca.\n2. Sugiere 2-3 opciones con precio + stock.\n3. Captura uno a uno: items (productId Mongo + cantidad), email, nombre completo, cédula/RUC, dirección (calle, ciudad, provincia, país=Ecuador), teléfono (número WA del cliente).\n4. Resume: '¿Confirmas X tazas de [nombre] por $Y, envío a [ciudad]?'\n5. Cuando el cliente confirme con 'sí/confirmo/quiero pagar/dame el link', responde TEXTUAL la palabra clave 'CONFIRMAR_COMPRA' al inicio del mensaje, junto con el resumen final. Esto activa el flujo de checkout.\n\nREGLAS:\n- NUNCA inventes product._id — si no lo tienes del scrape, di 'déjame confirmar disponibilidad'.\n- Si stock=0 → sugiere alternativa similar.\n- Si pide humano: di 'te conecto con una persona'.\n- No prometas tiempos de envío.\n- Si pide efectivo/transferencia: 'Por WhatsApp gestionamos sólo Payphone (tarjeta). Para transferencia te conecto con asesor.'"
  }
)
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<WELCOME_FLOW_ID>")
# VERIFY: assistant.instructions guardado
```

---

## 3. Flow Checkout (HTTP encadenado)

```
builderbot_create_flow(
  projectId="<PROJECT_ID>",
  name="Checkout Payphone",
  label="checkout",
  keywords=["CONFIRMAR_COMPRA","confirmo el pedido","quiero pagar ahora","dame el link de pago"],
  listenKeywords=false
)
builderbot_list_flows(projectId="<PROJECT_ID>")
# VERIFY → guardar flowId como <CHECKOUT_FLOW_ID>
```

### 3.1 Crear orden guest

```
builderbot_create_answer(
  projectId="<PROJECT_ID>",
  flowId="<CHECKOUT_FLOW_ID>",
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
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<CHECKOUT_FLOW_ID>")
# VERIFY
```

### 3.2 Crear Payphone Link

```
builderbot_create_answer(
  projectId="<PROJECT_ID>",
  flowId="<CHECKOUT_FLOW_ID>",
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
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<CHECKOUT_FLOW_ID>")
# VERIFY
```

### 3.3 Mensaje al usuario con el link

```
builderbot_create_answer(
  projectId="<PROJECT_ID>",
  flowId="<CHECKOUT_FLOW_ID>",
  type="add_text",
  message="✅ Pedido {{order_number}} por ${{order_total}}. Paga aquí: {{pay_url}} — el link expira en 24h. Te aviso cuando confirmemos pago ☕"
)
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<CHECKOUT_FLOW_ID>")
# VERIFY: 3 answers en orden
```

---

## 4. Flow Escalación humano

```
builderbot_create_flow(
  projectId="<PROJECT_ID>",
  name="Escalación humano",
  label="human",
  keywords=["agente","humano","asesor","persona","quiero hablar con alguien"],
  listenKeywords=false
)
builderbot_list_flows(projectId="<PROJECT_ID>")
# VERIFY → guardar como <HUMAN_FLOW_ID>
```

```
builderbot_create_answer(
  projectId="<PROJECT_ID>",
  flowId="<HUMAN_FLOW_ID>",
  type="add_text",
  message="👋 Te conecto con una persona. Pausamos el bot 1 hora — pronto te responde el equipo."
)

builderbot_create_answer(
  projectId="<PROJECT_ID>",
  flowId="<HUMAN_FLOW_ID>",
  type="add_mute",
  message="",
  plugins={ "mute": { "status": true, "gapTime": 60 } }
)
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<HUMAN_FLOW_ID>")
# VERIFY
```

---

## 5. Flow Voice (transcribe audio)

```
builderbot_create_flow(
  projectId="<PROJECT_ID>",
  name="Voice",
  label="voice",
  keywords=["EVENTS.VOICE_NOTE"],
  listenKeywords=true,
  transcribeAudio=true
)
builderbot_list_flows(projectId="<PROJECT_ID>")
# VERIFY → guardar como <VOICE_FLOW_ID>
```

```
builderbot_create_answer(
  projectId="<PROJECT_ID>",
  flowId="<VOICE_FLOW_ID>",
  type="add_chatpdf",
  message=""
)
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<VOICE_FLOW_ID>")
# VERIFY → guardar como <VOICE_ANSWER_ID>
```

```
builderbot_update_answer(
  projectId="<PROJECT_ID>",
  flowId="<VOICE_FLOW_ID>",
  answerId="<VOICE_ANSWER_ID>",
  assistant={
    "model": "gpt-5.4-nano",
    "scrapeUrl": "https://sorbitodeverdad.com",
    "instructions": "Eres el asistente de Sorbito de Verdad. El usuario envió una nota de voz; responde por escrito con el mismo flujo del welcome (saludar, sugerir, capturar datos, confirmar, palabra clave CONFIRMAR_COMPRA al cerrar)."
  }
)
builderbot_list_answers(projectId="<PROJECT_ID>", flowId="<VOICE_FLOW_ID>")
# VERIFY
```

---

## 6. Validar

```
builderbot_validate_bot(projectId="<PROJECT_ID>")
```

Esperado: `criticalCount = 0`. Si hay críticos, fixear según mensaje (mensaje
>160 chars → acortar; flow vacío → añadir answer; capture en última answer →
quitar).

---

## 7. (Opcional) Deploy + QR

> Usuario pidió NO prender. Saltar este paso.
> Cuando esté listo:
>
> ```
> builderbot_deploy(projectId="<PROJECT_ID>", action="create")
> builderbot_deploy(projectId="<PROJECT_ID>", action="status")
> # cuando status=READY_TO_SCAN
> builderbot_deploy(projectId="<PROJECT_ID>", action="qr")
> ```

---

## Reporte final esperado

```
📊 BOT REPORT: sorbito-de-verdad-bot
Project ID: <uuid>

✅ Flows:
  1. Welcome AI       (1 answer  — add_chatpdf)
  2. Checkout Payphone (3 answers — add_http × 2 + add_text)
  3. Escalación humano (2 answers — add_text + add_mute)
  4. Voice            (1 answer  — add_chatpdf)

🔍 Validation: PASS · Criticals: 0
📤 Deploy: NOT YET (por petición del usuario)
```
