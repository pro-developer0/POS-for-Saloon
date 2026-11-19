# Implementation status (honest checklist)

Legend: ✅ done & verified · 🟡 partial · ❌ not done

## Verified
- ✅ 108 unit/integration tests (`npm test`) + 30 Playwright browser tests (`npm run test:e2e`) pass: tenant isolation, permissions, booking rules, POS/financials, inventory/purchases, auth, AI failure handling
- ✅ `npm run build` passes (types + lint); 30 authenticated pages smoke-tested against both demo tenants with 0 server errors
- ✅ Cross-tenant checks: spoofed tenant cookie, foreign invoice id (404), foreign customer/product/service/staff ids in forms

## Features
| Area | Status | Notes |
|---|---|---|
| Auth (register, login, logout, lockout, 7-day session) | ✅ | |
| Password reset + email verification | ✅ | One-time hashed tokens (1h / 24h), no account enumeration, resets sign out old sessions. Emails go to .data/outbox.log until SMTP_URL is set; links need APP_URL in production |
| Multi-tenancy, business types, switchable modules | ✅ | Business type chosen once at sign-up and locked; no business switcher for clients; no pricing/billing/trial logic by design (handled manually) |
| Onboarding wizard, branding, locale, tax, hours | ✅ | Logo/favicon upload to local disk |
| RBAC (owner, manager, receptionist, cashier, staff) | ✅ | Per-member override column exists; no UI to edit it yet |
| Dashboard, date filters, charts, alerts | ✅ | Real SQL aggregates |
| Appointments + validation + reschedule + statuses | ✅ | One service per appointment |
| Calendar day/week/month, filters, drag-to-reschedule, click-to-book | ✅ | Drag/drop not tested in a real browser |
| Customers/CRM, profile, tags, loyalty, archive | ✅ | Loyalty *earning* works; no redemption flow |
| Services (categories, reorder, staff eligibility, archive) | ✅ | Service image field exists, no upload UI |
| Staff (schedule, breaks, time off, commission, salary perm) | ✅ | |
| POS (split/partial payments, discounts, tax, stock, commission, receipt) | ✅ | |
| Returns & refunds (credit notes), customer credit (udhaar, limits, receive payment), coupons, thermal 80 mm receipt, day-close cash count | ✅ | Returns are separate negative credit notes (sale never edited; all reports net automatically); refunds need the sales.refund permission (not cashiers); credit sales require a customer; coupons validated server-side. Receipt prints via the browser (no direct ESC/POS printer driver). No store-credit/exchange flow |
| Invoices, payments, void, print | 🟡 | PDF = browser "Print / Save as PDF" (no server-side PDF generator) |
| Inventory, movements, valuation, low-stock notifications | ✅ | Service-linked product usage not implemented |
| Pharmacy pack (batches + expiry, soonest-expiry-first selling, expired stock blocked, expiry alerts + write-off, generic name/strength/form, sell by unit or strip/box, Pharmacist role) | ✅ | 23 unit tests + 6 browser tests. NOT included by request: prescriptions, barcode scanning. Not a regulatory sign-off: have a licensed pharmacist/DRAP-aware advisor review before selling to pharmacies |
| Suppliers, purchase orders, receiving | 🟡 | One product line per PO in the UI (backend supports many); no supplier payments |
| Expenses + receipts + categories | ✅ | |
| Reports + CSV export | ✅ | PDF via print |
| Notifications centre | 🟡 | In-app only; no reminders scheduler, no email/SMS/WhatsApp |
| Platform admin (tenants, suspend/activate, AI config & usage, audit, health) | 🟡 | No plan/trial editing UI, no user management UI |
| Free-only AI foundation (providers, limits, usage, failure handling) | ✅ | Tested with mocked fetch only — **never run against a live Ollama/free provider** |
| AI Advisor, Marketing Studio, retention + inventory insights | 🟡 | Non-streaming; "stop" ignores the reply rather than aborting |
| AI appointment assistant / smart scheduling | 🟡 | Advisor can list verified free slots; **no AI-initiated booking** (by design) and no scheduling recommendations |
| Light/dark/system, animations, reduced motion, responsive shell | 🟡 | Implemented; **not visually verified on real devices**, no automated a11y audit |
| Playwright E2E, phone-overflow check | ✅ | 16 tests; calendar drag-and-drop and dark-mode visual quality not covered |
| Rate limiting | 🟡 | In-memory per instance |
| Multi-language UI | ❌ | `language` field stored; UI is English only |

## Before selling to customers
1. Run through every screen in a browser on desktop + phone; fix visual issues.
2. Set SMTP_URL + APP_URL so reset/verification emails really send (any free-tier SMTP works).
3. Verify free-AI-provider terms (or ship local-only) and test against a live Ollama.
4. Move uploads to object storage; add Redis-backed rate limiting if running >1 instance.
6. Add billing/plan enforcement if you want to charge subscriptions (not built; no paid service was added).
