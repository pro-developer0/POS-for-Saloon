# OmniPOS (placeholder name)

Multi-tenant POS & business-management SaaS for pharmacies, shops, restaurants, clinics, salons and more. One codebase, many independent businesses (tenants), each with its own
branding, users, customers, services, staff, appointments, sales, inventory, expenses, reports and optional AI.

**Stack:** Next.js 15 (App Router, TypeScript) · Tailwind v4 · Drizzle ORM · PostgreSQL (embedded PGlite for local dev) · Zod ·
Recharts · Framer Motion · Vitest.

## Run locally (no database install needed)

```bash
npm install
cp .env.example .env.local      # optional for dev
npm run demo:reset              # creates the dev DB (.data/pglite) + two demo businesses
npm run dev                     # http://localhost:3000
```

Demo logins (password for all: `Demo-Pass-123`) — **demo data only, never ship these to production**:

| Account | Email | Notes |
|---|---|---|
| Royal Hair Studio owner | owner@royal.demo | PKR, Asia/Karachi, rose branding |
| Glow Beauty Lounge owner | owner@glow.demo | USD, America/New_York, 8.25% tax, teal branding |
| Manager (Royal) / Cashier (Glow) | multi@demo.test | one login with a different role in each business; there is no business switcher in the UI, it opens the first business |
| Platform admin | admin@salonpro.local | `/admin` |

`npm run demo:reset` wipes and reseeds the **embedded dev database only** (it refuses to run against `DATABASE_URL`).

## Scripts
`dev` · `build` · `start` · `test` (Vitest, in-memory DB) · `typecheck` · `lint` · `db:generate` (new migration after editing
`src/db/schema.ts`) · `db:seed` · `demo:reset`.

## Environment variables
See `.env.example`. Required in production: `AUTH_SECRET` (≥32 random chars; the app refuses to start sessions without it) and
`DATABASE_URL` (PostgreSQL). Migrations in `./drizzle` are applied automatically on startup.

## Architecture in one page
- **Tenant isolation.** The tenant is never taken from the client. `requireCtx()` (src/server/session.ts) reads the signed session,
  then `buildCtx()` (src/server/ctx.ts) loads an *active membership* for (user, tenant) — a spoofed tenant cookie falls back to a
  tenant the user really belongs to. Every service function in `src/server/services/*` takes that `Ctx` and filters by
  `ctx.tenantId`; every child-id from a form (customer, staff, product…) is re-verified as owned by the tenant.
- **Permissions.** Role defaults + optional per-member override (`src/lib/permissions.ts`), enforced server-side by `need(ctx, perm)`.
  Salary data requires `staff.salary` (owner only by default).
- **Money.** `numeric(12,2)` columns; all arithmetic in integer cents (`src/lib/money.ts`), half-up rounding, tax computed per line.
- **POS.** One DB transaction: validates, locks product rows, decrements stock with a guarded `UPDATE … WHERE quantity >= n`,
  writes sale + items + payments + inventory movements + invoice number (atomic counter) + commissions + loyalty. Idempotency key
  (unique per tenant) prevents duplicate sales, including concurrent double-submits. Paid sales are never edited; unpaid ones can be voided.
- **Booking engine.** `validateSlot()` is the single source of truth (business hours, slot grid, staff schedule, breaks, time off,
  buffers, service eligibility, conflicts) in the tenant's timezone; a per-staff advisory lock serialises concurrent bookings.
- **Audit log** for sensitive actions; **platform admin** sees tenant metadata and aggregates only.

## Free-only AI (always optional)
AI is **off by default**. Core features never depend on it. See `src/server/ai/providers.ts`.
- **Local (no cost):** install [Ollama](https://ollama.com), `ollama pull llama3.2:3b` (pick a model that fits your hardware), then in
  `/admin → AI settings` enable AI, mode *Local only*, provider *Ollama*.
- **Free cloud (optional):** set one of `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` in the server environment only.
  **Verify each provider's current free quota and commercial-use / data terms before enabling for paying customers** — they change, and
  were not verified in this build. Never enable billing on these accounts.
- **Guarantees in code:** provider allowlist (no custom endpoints), host allowlist for cloud calls, OpenRouter limited to `:free`
  models, no fallback to any other provider, quota (HTTP 429) → cooldown + friendly message, per-business and platform daily
  limits, usage log, master switch, cloud-off switch. If AI is unavailable the advisor returns the **verified figures only**, labelled
  as non-AI. Financial numbers come from deterministic SQL tools; the model only explains them.
- The assistant is read-only: it never books, refunds, messages, purchases or changes settings.

## Deployment (free-tier friendly)
1. Provision PostgreSQL (e.g. Neon/Supabase free tiers, or self-hosted). Set `DATABASE_URL`, `AUTH_SECRET`.
2. `npm ci && npm run build && npm start` on any Node 20+ host (Vercel, Railway, Fly, a VPS). Migrations run on boot.
3. **File uploads** are stored on local disk (`UPLOAD_DIR`). Serverless hosts have ephemeral disks — replace `src/server/uploads.ts`
   with S3/R2/Supabase Storage (single module, same signature) before deploying there.
4. Point your domain's DNS at the host, enable HTTPS (HSTS header is already sent).
5. Do **not** run `demo:reset` / seed in production; create the platform admin by setting `is_platform_admin = true` on your own user row.

## Backups & recovery
- PostgreSQL: nightly `pg_dump -Fc $DATABASE_URL > salonpro-$(date +%F).dump`, keep 14+ days off-site; test a restore monthly with
  `pg_restore -d <new_db> file.dump`. Managed hosts' point-in-time recovery is preferable when available.
- Back up `UPLOAD_DIR` (or your object-storage bucket) alongside the database.
- Embedded dev DB: copy the `.data/pglite` directory while the app is stopped.

## Security notes
bcrypt password hashing, account lockout, signed httpOnly/SameSite session cookie, server-side permission checks, Zod validation on
every action, upload type + magic-byte checks with server-generated names, tenant-checked file route, CSV-injection guard, security
headers, in-memory login rate limit (use Redis/edge rate-limiting when running multiple instances). Server Actions carry Next.js'
built-in origin checks (CSRF). See `docs/STATUS.md` for known gaps.
