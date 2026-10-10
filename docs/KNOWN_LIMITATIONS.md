# Known Limitations

Owner: documentation agent. Updated whenever a capability is simulated, deferred, or found lacking.

## Current state

As of 2026-10-10 the repository contains planning documents and agent definitions only. **There is no application.** Everything below describes the limits of the planned MVP so they are understood before work starts.

## Simulated in the MVP

| Capability | What the MVP does | What a real launch needs |
| --- | --- | --- |
| Payment | `MOCK` provider; no money moves; a test-only switch simulates failure | A licensed payment gateway, signed and idempotent webhooks, reconciliation, refunds |
| Shipping fee | One flat fee per seller order from settings | Carrier rates by weight, size, and destination |
| Shipping and tracking | Seller types a tracking number; "delivered" is set manually | Carrier API integration and real status updates |
| File storage | Local disk | Object storage with a CDN |
| Catalog content | Seeded sample stores and products, labelled as samples | Real sellers |

## Not built in the MVP

- Password recovery and email verification (no email provider).
- Notifications of any kind: email, SMS, push.
- Multi-factor authentication.
- Refunds, returns, disputes, and customer-initiated cancellation.
- Seller payouts and commission statements; the commission rate is recorded only.
- Product variants (size, colour), bundles, and per-variant stock.
- Vouchers, promotions, flash sales, loyalty points.
- Wishlist, chat between buyer and seller, product questions.
- Tax invoices and VAT handling.
- Nested categories.
- Guest cart and guest checkout.
- Seller staff accounts; one login per store.
- Languages other than Thai; dark theme.
- Review moderation tools and review images.

## Technical limits

| Limit | Consequence | Path forward |
| --- | --- | --- |
| In-process rate limiter | Only correct on a single instance | Shared store such as Redis |
| Local-disk uploads | Needs a persistent volume; no serverless or multi-instance | S3-compatible adapter behind the existing interface |
| Search by `ILIKE` substring | Slow on large catalogs; no relevance ranking; no Thai word segmentation; no typo tolerance | Trigram index, then a search service |
| Money in 32-bit satang | Single order capped at 20,000,000 THB | Move totals to `BigInt` |
| Stock reserved at order creation | A pending payment holds stock until it resolves; with the synchronous mock this is instantaneous, with a real gateway it needs an expiry job | Reservation timeout worker |
| No background job runner | Nothing runs on a schedule (no expiry, no cleanup, no emails) | Add a queue or scheduled worker |
| Forward-only migrations | Rollback means a corrective migration or a restore | Expand-then-contract discipline, rehearsed backups |
| No caching layer | Catalog pages hit the database on each request beyond framework caching | Add caching when measured need appears |

## Compliance gaps before a real launch

- PDPA: privacy notice, consent and lawful basis, data-subject requests, retention schedule, breach process.
- E-commerce and consumer-protection obligations for an online marketplace operating in Thailand, including seller identity verification.
- Terms of service and seller agreement.
- Tax registration and invoicing.

These need legal advice; none are addressed by the software alone.

## Process limits

- Code is produced by AI agents. Reviews and security checks are performed by other AI agents and automated tools. No human code review or professional penetration test is included unless you arrange one.
- Automated scanners passing does not establish that the application is secure.
- No load or performance testing is planned for the MVP.
- CI cannot be proven until a GitHub repository exists and a workflow actually runs.

## Environment limits on the current machine

See blockers in [STATUS.md](STATUS.md): Node.js, a package manager, PostgreSQL, and Docker are not installed, and the project folder is inside OneDrive.
