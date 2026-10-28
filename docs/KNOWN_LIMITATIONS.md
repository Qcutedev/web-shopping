# Known Limitations

Owner: documentation agent. Updated whenever a capability is simulated, deferred, or found lacking.

Labels: `Implemented` works in the repository. `Simulated` works but fakes an external system. `Planned` is not built. Task status and verification state are in [STATUS.md](STATUS.md) only.

## Current state

As of 2026-10-28 the application exists and runs locally (`pnpm dev` with Docker PostgreSQL). Customer, seller, and admin areas, mock checkout, reviews, uploads, an end-to-end suite, a CI workflow file, and a `Dockerfile` are in the repository. Many items are implemented but not verified (open code review, security re-check, or browser check); see [STATUS.md](STATUS.md). Nothing is deployed: there is no staging or production environment, no hosting provider, and no GitHub remote, so the CI workflow has never run.

## Simulated

| Capability | What the repository does | What a real launch needs |
| --- | --- | --- |
| Payment | `MOCK` provider (`src/modules/payments/provider.ts`); no money moves; `Payment.provider` is `MOCK`, references start with `MOCK-`, responses carry `isSimulated: true`; the checkout request can ask the mock to decline; the mock is refused in a production server | A licensed payment gateway, signed and idempotent webhooks, reconciliation, refunds |
| Shipping fee | One flat fee per seller order, read from settings | Carrier rates by weight, size, and destination |
| Shipping and tracking | Seller types a carrier name and tracking number and moves the status by hand, including "delivered" | Carrier API integration and real status updates |
| File storage | Local disk adapter, directory set by `UPLOAD_DIR` | Object storage with a CDN |
| Catalog content | Seeded sample stores and products, local development only | Real sellers |

## Not built (Planned or absent)

- Password recovery and email verification (no email provider; sign-up sets `requireEmailVerification: false`).
- Notifications of any kind: email, SMS, push.
- Multi-factor authentication.
- Refunds, returns, disputes, and customer-initiated cancellation. Cancellation exists only on the seller and admin side.
- Seller payouts and commission statements; the commission rate is recorded on orders only.
- Product variants (size, colour), bundles, and per-variant stock.
- Vouchers, promotions, flash sales, loyalty points.
- Wishlist, chat between buyer and seller, product questions.
- Tax invoices and VAT handling.
- Nested categories.
- Guest cart and guest checkout.
- Seller staff accounts; one login per store.
- Languages other than Thai; dark theme.
- Review moderation: no admin hide-review action and no review images. Tracked as SEC-092 in [SECURITY.md](SECURITY.md).
- Deployment, backups, log collection, monitoring. See [DEPLOYMENT.md](DEPLOYMENT.md) and [RUNBOOK-STAGING.md](RUNBOOK-STAGING.md).

## Technical limits

| Limit | Consequence | Path forward |
| --- | --- | --- |
| In-process rate limiter (`src/server/rate-limit.ts`) | Only correct on a single instance | Shared store such as Redis |
| Local-disk uploads | Needs a persistent volume; no serverless or multi-instance | S3-compatible adapter behind the existing interface |
| Search by case-insensitive substring match (Prisma `contains`) | Slow on large catalogs; no relevance ranking; no Thai word segmentation; no typo tolerance | Trigram index, then a search service |
| Money in 32-bit satang | A single order is capped at 2,000,000,000 satang (20,000,000 THB, `MAX_ORDER_TOTAL_SATANG`) | Move totals to `BigInt` |
| Stock is taken at order creation | A pending payment holds stock until it resolves. With the synchronous mock this is instant. A timeout sweep fails unpaid orders after `PAYMENT_TIMEOUT_MINUTES` | A real gateway needs a proper reservation expiry design |
| Scheduled work runs inside the web process | Session purge, payment timeout sweep, and upload orphan cleanup start from `src/instrumentation.ts`. They stop when the process stops and run once per instance. There is no queue, no email sending, no separate worker | Add a queue or scheduled worker |
| Forward-only migrations | Rollback means a corrective migration or a restore | Expand-then-contract discipline, rehearsed backups |
| No caching layer | Catalog pages hit the database on each request beyond framework caching | Add caching when measured need appears |
| Security headers use a static CSP with `unsafe-inline` | Weaker script and style protection than a nonce-based policy | Accepted in D-046; revisit in [DECISIONS.md](DECISIONS.md) |
| `pnpm build` and `next dev` share `.next/` | Running both at once corrupts the output. E2E and the build probe use a separate directory through `NEXT_DIST_DIR` | Run them one at a time |
| Two e2e runs cannot overlap | They share database `marketplace_e2e` and port 3100 | Run one suite at a time |

## Compliance gaps before a real launch

- PDPA: privacy notice, consent and lawful basis, data-subject requests, retention schedule, breach process.
- E-commerce and consumer-protection obligations for an online marketplace operating in Thailand, including seller identity verification.
- Terms of service and seller agreement.
- Tax registration and invoicing.

These need legal advice; none are addressed by the software alone.

## Process limits

- Code is produced by AI agents. Reviews and security checks are performed by other AI agents and automated tools. No human code review or professional penetration test is included unless you arrange one.
- Automated scanners passing does not establish that the application is secure.
- No load or performance testing has been done.
- No accessibility audit has run; the axe dependency awaits owner approval. Keyboard-only checks exist for part of the e2e suite (`e2e/keyboard.spec.ts`).
- CI has never run: there is no GitHub remote (blocker B-04 in [STATUS.md](STATUS.md)).
- The container images were built and run locally only (`scripts/container-smoke.ps1`).

## Environment limits

The development machine runs Windows 11 and PowerShell, with PostgreSQL provided through Docker only. Setup and troubleshooting are in the [README](../README.md).
