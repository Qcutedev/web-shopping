# Security

Owner: security agent. Threat model, planned controls, findings register, and residual risks.

**State on 2026-10-10: no code exists, so no control below is implemented and no security review or scan has been run.** The "Status" columns are updated only with evidence.

This document never claims the application is secure. It records what was checked, how, and what remains.

## Assets

| Asset | Why it matters |
| --- | --- |
| User credentials and sessions | Account takeover |
| Personal data: names, phones, addresses, order history | Privacy, PDPA obligations |
| Order, payment, and stock records | Financial and operational integrity |
| Seller private data: orders, sales, inventory | Tenant confidentiality |
| Admin capability | Full platform control |
| Secrets: database URL, auth secret, future payment keys | Total compromise |

## Actors and trust boundaries

Anonymous visitor, customer, seller (pending, approved, suspended), admin, and an external attacker who may hold any non-admin account. Trust boundaries: browser to server (everything from the browser is untrusted), server to database, server to file storage, and later server to payment and shipping providers (inbound webhooks are untrusted until signature-verified).

## Threats and planned controls

| Id | Threat | Control | Verified by | Status |
| --- | --- | --- | --- | --- |
| TM-01 | Credential stuffing, brute force | Rate limit per IP and account; generic errors; strong hash from the auth library | Auth tests, rate-limit test | NOT STARTED |
| TM-02 | Session theft or fixation | `HttpOnly`, `Secure`, `SameSite=Lax` cookie; rotation on login; server-side invalidation | Cookie attribute test | NOT STARTED |
| TM-03 | Account enumeration | Identical responses for existing and unknown emails | Auth tests | NOT STARTED |
| TM-04 | Self-assigned role | Registration and profile schemas reject unknown keys; role written only by admin service and bootstrap script | Escalation tests | NOT STARTED |
| TM-05 | IDOR on addresses and orders | Queries scoped by `actor.userId`; foreign ids return 404 | Cross-user tests | NOT STARTED |
| TM-06 | Cross-seller access | Queries scoped by `actor.storeId` from the session; foreign ids return 404 | Seller isolation suite (T-045) | NOT STARTED |
| TM-07 | Non-admin reaching admin functions | `requireRole(ADMIN)` in every admin service; middleware is not relied on | Admin permission suite (T-052) | NOT STARTED |
| TM-08 | Price or total tampering | Client amounts ignored; totals computed from database values in the transaction | Tampering tests | NOT STARTED |
| TM-09 | Quantity abuse (zero, negative, fractional, huge) | Zod integer bounds; database `CHECK`; order cap | Validation tests | NOT STARTED |
| TM-10 | Overselling by race | Conditional atomic decrement; `CHECK (stock >= 0)` | Concurrency test (T-033) | NOT STARTED |
| TM-11 | Duplicate orders | Idempotency key with unique constraint | Duplicate-submission test | NOT STARTED |
| TM-12 | Forcing an order to paid | No client-callable "mark paid" endpoint; payment status changes only inside the checkout service through the provider interface | Review, API tests | NOT STARTED |
| TM-13 | Skipping fulfilment states | Central transition table | Transition tests | NOT STARTED |
| TM-14 | SQL injection | Prisma operations and parameterised queries only; `sort` and filter values from allow-lists | Review, lint, tests | NOT STARTED |
| TM-15 | Stored XSS via product, store, review text | React escaping; no `dangerouslySetInnerHTML` on user content; plain text only | Review, XSS payload tests | NOT STARTED |
| TM-16 | CSRF | `SameSite=Lax` plus `Origin` check on mutations; JSON bodies only | CSRF test | NOT STARTED |
| TM-17 | Malicious upload | Size limit, extension and MIME allow-list, magic-byte check, generated name, no SVG or HTML, served with fixed image type and `nosniff` | Upload tests | NOT STARTED |
| TM-18 | Path traversal in file serving | Keys are generated ids matched against a strict pattern; never joined from raw input | Traversal test | NOT STARTED |
| TM-19 | Open redirect after login | Only same-origin relative paths accepted | Redirect test | NOT STARTED |
| TM-20 | SSRF | No server-side fetch of user-supplied URLs in the MVP | Review | NOT STARTED |
| TM-21 | Secret exposure | Env-only secrets; validated at startup; `.env*` git-ignored; secret scan in CI; no secrets in logs | Secret scan | NOT STARTED |
| TM-22 | Vulnerable dependencies | Lockfile; `pnpm audit` in CI; Dependabot | Audit output | NOT STARTED |
| TM-23 | Missing security headers, clickjacking | CSP, HSTS (production), `X-Content-Type-Options`, `frame-ancestors 'none'`, referrer policy | Header test | NOT STARTED |
| TM-24 | Verbose errors | One error envelope; stack traces only in server logs | Review, tests | NOT STARTED |
| TM-25 | Abuse of admin power going unnoticed | Append-only audit log written in the same transaction | Audit tests | NOT STARTED |
| TM-26 | Suspended seller or deactivated user keeps acting | Status checked on every request from the database; sessions revoked on deactivation | Tests | NOT STARTED |
| TM-27 | Mass assignment | Explicit field mapping in services; never spread request bodies into Prisma calls | Review | NOT STARTED |
| TM-28 | CI supply chain | Least-privilege workflow permissions; actions pinned to SHAs; no untrusted input in `run:`; no secrets to fork PRs | Workflow review | NOT STARTED |

## Session and cookie settings

To be filled in by the auth agent with the values actually configured (T-015).

## Rate-limited endpoints

See the table in [API_CONTRACTS.md](API_CONTRACTS.md). The limiter is in-process; see residual risks.

## Upload policy

JPEG, PNG, WebP. Maximum 5 MB per file, 8 images per product. Content verified by magic bytes. Stored under generated keys. Product images are public by design; no private documents are uploaded in the MVP.

## Privacy and data retention

- Personal data collected: email, name, phone, shipping addresses, order history. Nothing else.
- No payment card data is collected or stored. The mock provider takes no card input.
- Logs must not contain passwords, session tokens, cookies, or full addresses.
- Thailand's PDPA applies to a real launch: a privacy notice, a lawful basis, data-subject request handling, and a retention schedule are required and are **not** part of the MVP. Recorded in KNOWN_LIMITATIONS.md.
- Order and audit records are retained indefinitely in the MVP; deactivated accounts keep their order history.

## Findings register

No findings. No review has been performed yet.

Format for future entries:

```
### SEC-0xx <title>
Severity: Critical | High | Medium | Low
Status: OPEN | FIXED (re-checked <date>) | ACCEPTED (reason, approver)
Location: path:line
Description:
Reproduction:
Remediation:
Re-check evidence:
```

## Scans and reviews performed

| Date | Check | Tool and version | Command | Result |
| --- | --- | --- | --- | --- |
| | none yet | | | |

A clean scan means the tool found nothing. It is not proof of security.

## Residual risks (known before any code is written)

- In-process rate limiting does not protect a multi-instance or serverless deployment.
- No multi-factor authentication, including for admins.
- No email verification or password recovery until an email provider exists.
- No web application firewall, bot protection, or fraud detection.
- CSP strictness is limited by what the framework's inline scripts require.
- Local-disk file storage has no malware scanning.
- No independent human penetration test is planned within this project.
- Real payment integration will introduce webhook verification, replay protection, and reconciliation risks that the mock does not exercise.

## Reporting a vulnerability

See [.github/SECURITY.md](../.github/SECURITY.md).
