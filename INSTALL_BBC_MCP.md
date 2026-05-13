# Instalar BBC MCP server (Claude Code)

El skill `bbc-skill-tool` que tienes en `~/.claude/skills/bbc-skill-tool/` es
**solo documentación** (markdown). Las herramientas `builderbot_*` vienen de un
**MCP server separado** que NO está instalado. Por eso no puedo invocarlas
desde aquí.

## Paso 1 — Localizar el MCP server BBC

El MCP correcto debería venir del equipo de **BuilderBot Cloud / BuilderBot.app**.
Mira en orden:

1. **Tu cuenta BBC**: entra a https://console.builderbot.app → busca "MCP",
   "Claude", "Integraciones para AI". Si lo provee BBC, te da el comando o el
   plugin marketplace.
2. **Búsqueda directa**: pregunta a soporte BBC (`@leifermendez` en GitHub o
   chat del console) por "MCP Claude Code para gestionar flows".
3. **Plugin marketplace de Claude Code**: corre `claude /plugin marketplace`
   y busca "builderbot" o "bbc".

## Paso 2 — Registrar el MCP

Cuando tengas el comando o paquete del MCP server, hay 3 formas de
registrarlo en Claude Code:

### Opción A — CLI (más simple)
```bash
claude mcp add bbc-skill-tool \
  --command "<command-from-vendor>" \
  --env BBC_API_KEY=bbc-1a982c21-ecbe-4d40-a541-4a27aeaf58af
```

Ejemplo si fuera npm:
```bash
claude mcp add bbc-skill-tool \
  --command "npx -y @builderbot/mcp" \
  --env BBC_API_KEY=bbc-1a982c21-ecbe-4d40-a541-4a27aeaf58af
```

### Opción B — Editar `~/.claude/settings.json`
```json
{
  "mcpServers": {
    "bbc-skill-tool": {
      "command": "npx",
      "args": ["-y", "@builderbot/mcp"],
      "env": {
        "BBC_API_KEY": "bbc-1a982c21-ecbe-4d40-a541-4a27aeaf58af"
      }
    }
  }
}
```

### Opción C — Plugin marketplace (si BBC publica uno)
Dentro de Claude Code:
```
/plugin install bbc-skill-tool
```

## Paso 3 — Reiniciar Claude Code

```bash
# Cierra esta sesión completamente
# Re-abre Claude Code en este directorio
```

## Paso 4 — Verificar que las herramientas estén activas

En la nueva sesión:
```
¿Qué tools tienes disponibles que empiecen con builderbot_?
```

Espera ver: `builderbot_list_projects`, `builderbot_create_project`,
`builderbot_create_flow`, etc.

## Paso 5 — Ejecutar la creación del bot

Una vez verificado, dile a Claude:
```
Lee /Users/diegoreyes/projects/work/bakano/clients/andersson-boscan/sorbitodeverdad/sorbito-de-verdad-backapp/WHATSAPP_BOT_BBC_CALLS.md
y ejecuta cada llamada secuencialmente. NO hagas deploy ni QR — solo crear
proyecto, flows, answers, instructions y validar.
```

Ese archivo ya tiene todas las llamadas con la URL prod del backend
(`https://sorbito-de-verdad-backapp.vercel.app`) y los instructions del AI.

## Paso 6 — Configurar BBC_PROJECT_BASE_URL

Tras `builderbot_deploy(action="status")` BBC devuelve la URL pública del
proyecto desplegado. Pégala en `.env` del backend:
```
BBC_PROJECT_BASE_URL=https://<host-del-proyecto>
```

Sin esto, el webhook Payphone no podrá notificar al cliente cuando confirme
el pago.

---

## Si no encuentras el MCP

Plan B: construir los flows manualmente en https://console.builderbot.app
usando `WHATSAPP_BOT_BBC_CALLS.md` como guía visual (cada `builderbot_create_flow`
= "New Flow" en el dashboard, cada `builderbot_create_answer` = "Add answer",
etc). Toma ~20 minutos.
