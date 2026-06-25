# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |

# sorbito-de-verdad-backapp — repo guide

Express 5 + TypeScript + Mongoose backend for the Sorbito de Verdad e-commerce site.

## Stack

- **Runtime**: Node + TypeScript (ES2024, CommonJS, strict mode)
- **Framework**: Express 5 + Mongoose 8 + MongoDB
- **Entrypoint**: `src/index.ts` → `createApp()` from `src/app.ts`
- **Default port**: 8100
- **External services**: Payphone (payment gateway), Cloudinary (images), Resend (email), BuilderBot Cloud (WhatsApp bot)

## Commands

| Command | What |
|---------|------|
| `npm run dev` | Hot-reload dev server via ts-node-dev |
| `npm run build` | TypeScript compile → `dist/` |
| `npm run start` | Run compiled `dist/index.js` |
| `npm run format` | Prettier on `src/**/*.{ts,json,css,md}` |
| `npm run seed` | Run `src/seeds/seed.ts` |
| `npm run create-owner` | Create admin user via seed |
| `npm run upload-images` | Upload images to Cloudinary via seed |
| `npm run seed-zones` | Seed shipping zones |
| `npm run seed-test` | Seed test data |

No test suite exists. No linter config — only Prettier formatting.

## Architecture

```
src/
  index.ts          — Vercel entrypoint + local dev server
  app.ts            — Express app factory (CORS, JSON, routes, error handler)
  config/mongo.ts   — Mongoose connection
  routes/           — Router modules → controllers
  controllers/      — Request handlers (order.controller.ts is ~3k lines)
  models/           — Mongoose schemas (Order, User, Product, Category, etc.)
  services/         — External integrations (payphone, email, cloudinary, BBC)
  middlewares/      — auth, admin, globalErrorHandler
  jobs/             — payment-reminders.job.ts
  seeds/            — DB seed scripts
```

## Vercel deployment

`vercel.json` rewrites all routes to `src/index.ts`. Deploy with `vercel --prod`.
Vercel Cron runs `GET /api/cron/payment-reminders` every 5 minutes.
Set `PAYMENT_REMINDERS_LOCAL_CRON=off` to disable the in-process cron loop (Vercel Cron handles it in prod).

## CORS

Whitelist-based; any `*.vercel.app` origin is automatically allowed (preview deploys).
Configurable via `FRONTEND_URL` env var (comma-separated).

## Auth

JWT-based (`JWT_SECRET` env var). Three middleware tiers:
- `authMiddleware` — blocks unauthenticated; skips auth for paths containing `/whatsapp-bot/`
- `optionalAuthMiddleware` — decodes token if present, continues as guest otherwise
- `adminMiddleware` — checks user role after auth

## Key constraints

- `clientTransactionId` (Payphone) must be ≤15 characters (`src/services/payphone-links.service.ts:54`)
- Payphone amounts must satisfy: `amountWithoutTax + tax = amount` (capped at $10k USD)
- `BBC_PROJECT_ID` and `BBC_API_KEY` have hardcoded defaults in `bbc-notification.service.ts` — set env vars to override
- WhatsApp bot endpoints under `/api/orders/whatsapp-bot/*` are ALL public (no auth)
- Guest order (`POST /api/orders/guest`) auto-creates a user account if email is new
- `webhook/payphone-link` uses `router.all()` — accepts any HTTP method

## Instruction files

Existing supplementary docs in the repo root — index them when relevant:
- `WHATSAPP_BOT_SPEC.md` — BBC bot spec (flows, assistant instructions, deploy steps)
- `WHATSAPP_BOT_API.md` — Guest order API reference for the bot
- `WHATSAPP_BOT_BBC_CALLS.md` — Executable BBC MCP calls
- `WHATSAPP_BOT_CHECKOUT_FLOW.md` — Checkout without human escalation
- `BUILD_BOT_DASHBOARD.md` — BBC dashboard setup wizard
- `INSTALL_BBC_MCP.md` — BBC MCP tool setup
- `scripts/sales-report.md` — Sales report generation
