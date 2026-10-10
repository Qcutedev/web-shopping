# Security

Owner: security agent. Threat model, security rules, findings register, and residual risks.

**State on 2026-10-11: the only application code is the server utilities (T-019) and the local database setup (T-012). Both were reviewed on 2026-10-11; 11 findings are open (0 Critical, 0 High, 4 Medium, 7 Low). No authentication, route handler, database schema, upload, or checkout code exists, so no control that depends on them is implemented or reviewed.** The "Status" columns are updated only with evidence.

This document never claims the application is secure. It records what was checked, how, and what remains. A clean scanner run is evidence that the scanner found nothing, not that the application is secure.

## Assets

| Asset | Why it matters |
| --- | --- |
| User credentials and sessions | Account takeover |
| Personal data: names, emails, phones, addresses, order history, IP addresses | Privacy, PDPA obligations |
| Order, payment, and stock records | Financial and operational integrity |
| Seller private data: orders, sales, inventory | Tenant confidentiality |
| Admin capability | Full platform control |
| Secrets: database URL, auth secret, future payment keys | Total compromise |
| Server logs | Hold request metadata and error details; a copy of whatever is written to them leaves the database's access control |

## Actors and trust boundaries

Anonymous visitor, customer, seller (pending, approved, suspended), admin, and an external attacker who may hold any non-admin account. Trust boundaries: browser to server (everything from the browser is untrusted, including every request header), reverse proxy to server (trusted only as configured in SR-01), server to database, server to file storage, server to log collector, and later server to payment and shipping providers (inbound webhooks are untrusted until signature-verified).

## Threats and planned controls

| Id | Threat | Control | Verified by | Status |
| --- | --- | --- | --- | --- |
| TM-01 | Credential stuffing, brute force | Rate limit per client network (derived by SR-01) and per account; the limiter never fails open (SR-02); generic errors; strong hash from the auth library | Auth tests, rate-limit test | PARTIAL: limiter reviewed 2026-10-11, findings SEC-004 and SEC-005 open; nothing calls it yet |
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
| TM-16 | CSRF | `SameSite=Lax` session cookie, plus an `Origin` check (must equal `APP_URL`) on every `POST`, `PATCH`, `PUT`, and `DELETE` whatever the content type. Each mutation accepts exactly one content type and rejects any other with 415 before reading the body: `application/json` everywhere, except the upload endpoint, which accepts `multipart/form-data` only and gets the same `Origin` check. No endpoint accepts `application/x-www-form-urlencoded` or `text/plain`. `GET` and `HEAD` never change state | CSRF test (missing, foreign, and `null` Origin; form-encoded and text bodies; multipart upload from a foreign origin) | NOT STARTED |
| TM-17 | Malicious upload | Size limit, extension and MIME allow-list, magic-byte check, generated name, no SVG or HTML, served with fixed image type and `nosniff` | Upload tests | NOT STARTED |
| TM-18 | Path traversal in file serving | Keys are generated ids matched against a strict pattern; never joined from raw input | Traversal test | NOT STARTED |
| TM-19 | Open redirect after login | Only same-origin relative paths accepted | Redirect test | NOT STARTED |
| TM-20 | SSRF | No server-side fetch of user-supplied URLs in the MVP | Review | NOT STARTED |
| TM-21 | Secret exposure | Env-only secrets; validated at startup, including refusal of the local placeholder credentials outside local use (SEC-009); `.env*` git-ignored; secret scan in CI; no secrets in logs (SR-04) | Secret scan, logger tests | PARTIAL: manual pattern scan of tracked files and history clean 2026-10-11 (no scanner tool installed); logger findings SEC-001 and SEC-002 open |
| TM-22 | Vulnerable dependencies | Lockfile; `pnpm audit` in CI; Dependabot | Audit output | PARTIAL: audited 2026-10-11, production dependencies clean, one development-only advisory (SEC-010); no CI yet |
| TM-23 | Missing security headers, clickjacking | CSP, HSTS (production), `X-Content-Type-Options`, `frame-ancestors 'none'`, referrer policy; `Cache-Control: no-store` on API responses (SEC-006) | Header test | NOT STARTED |
| TM-24 | Verbose errors | One error envelope; stack traces only in server logs, and those logs follow SR-04 | Review, tests | PARTIAL: envelope reviewed 2026-10-11, no leak found, regression tests in `tests/security`; no route handler uses it yet |
| TM-25 | Abuse of admin power going unnoticed | Append-only audit log written in the same transaction | Audit tests | NOT STARTED |
| TM-26 | Suspended seller or deactivated user keeps acting | Status checked on every request from the database; sessions revoked on deactivation | Tests | NOT STARTED |
| TM-27 | Mass assignment | Explicit field mapping in services; never spread request bodies into Prisma calls | Review | NOT STARTED |
| TM-28 | CI supply chain | Least-privilege workflow permissions; actions pinned to SHAs; no untrusted input in `run:`; no secrets to fork PRs | Workflow review | NOT STARTED |
| TM-29 | Rate-limit bypass or lock-out through a forged client address | Client address derived only by SR-01; `X-Forwarded-For` ignored unless a proxy is explicitly configured; IPv6 grouped by /64 | Client-address unit tests, env validation tests | NOT STARTED |
| TM-30 | Denial of service by filling the rate-limit store | Bounded store that never evicts a live counter and never fails open; capacity isolated per rule (SR-02) | `tests/security` SEC-004 tests | NOT STARTED (SEC-004 open) |
| TM-31 | Personal data or secrets copied into logs | Logger redaction list and caller rules in SR-04; ids are logged, payloads are not | `tests/security` SEC-001 and SEC-002 tests | NOT STARTED (SEC-001, SEC-002 open) |
| TM-32 | Forged or confusing log entries | One JSON object per line with control characters escaped; request ids generated by the server unless a trusted proxy supplies them (SR-03) | `tests/security` log-injection and SEC-003 tests | PARTIAL: CR, LF, and control characters verified escaped 2026-10-11; SEC-003 and SEC-007 open |

## Security rules decided by the security owner

These are binding on the code named in each rule. They are technical rules; none of them decides a product or business matter.

### SR-01 Trusted proxy and client address (decided 2026-10-11)

Resolves the "per IP" half of review item S20.

**Rule.** The client address used for rate limiting and security logging comes from exactly one function, `getClientAddress(request)` in `src/server` (backend-api). No other code reads `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, or any similar header. What the function trusts is set only by environment variables validated in `src/server/env.ts` (devops):

| Variable | Values | Default | Meaning |
| --- | --- | --- | --- |
| `TRUSTED_PROXY_HOPS` | integer 0 to 5 | `0` | Number of reverse proxies between the internet and the application that the operator controls and that each append the address they received the connection from to `X-Forwarded-For` |
| `TRUSTED_CLIENT_IP_HEADER` | header name matching `^[A-Za-z0-9-]{1,64}$`, or unset | unset | Name of a single-value header that the hosting platform's proxy always overwrites with the client address (for platforms that document one). Not `X-Forwarded-For`, `Forwarded`, `Cookie`, `Authorization`, or `Host` |

Derivation:

1. `TRUSTED_PROXY_HOPS=0` and no `TRUSTED_CLIENT_IP_HEADER` (the default): no request header is read. The client address is **unknown**.
2. `TRUSTED_PROXY_HOPS=n` with n of 1 or more: split the combined `X-Forwarded-For` value on commas, trim each entry, and take the entry n places from the right end (n = 1 is the last entry). Entries to the left of it are client-controlled and are never used. Fewer than n entries means unknown.
3. `TRUSTED_CLIENT_IP_HEADER` set: use that header's whole value. Missing, or containing a comma, means unknown.
4. The candidate must parse as an IPv4 or IPv6 address (`node:net` `isIP`), after removing an IPv4-mapped prefix (`::ffff:`). Anything else is unknown. No brackets, ports, zone ids, or host names are accepted.
5. Normalise: IPv4 as dotted decimal. IPv6 is reduced to its /64 network (first four groups of the fully expanded, lower-case form), because one subscriber normally controls a whole /64 and could otherwise rotate through 2^64 addresses.
6. Unknown addresses share one rate-limit subject, the literal `unknown`. They are never given a fresh or random subject and are never exempt from a limit.

`src/server/env.ts` must:

- reject a value outside the ranges above, and reject both variables being set at once (`TRUSTED_PROXY_HOPS` greater than 0 together with `TRUSTED_CLIENT_IP_HEADER`);
- when `NODE_ENV=production`, require that `TRUSTED_PROXY_HOPS` is set explicitly (no silent default) and, if the result is "no proxy trusted", log one warning at startup that every per-address limit is shared by all clients;
- never accept a boolean "trust proxy" switch.

**Reason.** Measured in the installed framework: Next.js 16.4.0 does not give a route handler the TCP peer address. `node_modules/next/dist/server/base-server.js:567` runs `req.headers['x-forwarded-for'] ??= socket.remoteAddress`, so when a client sends its own `X-Forwarded-For` the framework keeps the client's value and the real address is lost. With no proxy, the header is therefore exactly as trustworthy as any other client input: not at all. An attacker who can choose the address gets unlimited sign-in attempts (a new "address" per request), can spend another network's allowance to lock it out, and can fill the limiter store (SEC-004). Counting hops from the right is the only position a client cannot influence, because each trusted proxy appends what it saw itself. The deployment target is not chosen, so the rule supports both the append style and the single-header style without guessing which platform will be used.

**Consequences that are intended.** With the default configuration every anonymous client shares one bucket, so sign-in is limited to 5 per minute for the whole site. That is safe and unusable, which forces the proxy to be configured before any real deployment rather than leaving limits silently bypassable. Local development and tests are unaffected in practice.

**Deployment conditions (devops, `docs/DEPLOYMENT.md`).** When either variable is set, the application port must be reachable only from the proxy (loopback or a private network); otherwise a client can connect directly and forge the trusted position. The proxy must append to or overwrite `X-Forwarded-For` (never pass a client value through as the last entry) and must overwrite the header named in `TRUSTED_CLIENT_IP_HEADER`. The hop count must be confirmed on staging by a request from a known address before production.

**What other code must do.**

- auth (T-015): the auth library's own address detection and built-in rate limiter must not read `X-Forwarded-For` by themselves. Either feed them the SR-01 result or switch them off and use `src/server/rate-limit.ts`. To be validated against the installed library version (review item V10).
- backend-api: rate-limit subjects are built only from `getClientAddress`, `actor.userId`, or a normalised email (trimmed, lower-cased, Unicode NFKC). A per-email subject is consumed only after the per-address check has allowed the request, so one address cannot create unlimited per-email keys.
- Nobody uses the client address for authorization, and nobody stores it outside security log lines (SR-04) and what the auth library's session table requires.

### SR-02 Rate limiter at the key cap (decided 2026-10-11)

**Rule.** Keep fail-closed: when a store is full of live windows, a subject that has no window yet is refused with 429. Live counters are never evicted and the limiter never fails open. This is conditional on four changes, tracked as SEC-004 and SEC-005:

1. **Isolated capacity per rule.** Each rule (sign-in by address, sign-in by email, sign-up, checkout, uploads, seller application, review create) has its own key capacity, so filling one cannot refuse another. The sum of all capacities stays bounded and documented in the module (at most 200,000 windows in total).
2. **The rule is part of the key.** The limiter API takes the rule's name and builds the stored key itself (`<rule>:<subject>`); a caller cannot make two rules share a counter or a window.
3. **Short retry at saturation.** A refusal caused by a full store reports a `Retry-After` of at most 60 seconds, not the rule's whole window (today it is up to 24 hours).
4. **Visible.** Saturation writes one `warn` line per rule per minute at most (rule name and store size only, never the keys) and is distinguishable from an ordinary limit hit in the result, so operators can alert on it.

**Reason.** The alternatives are worse. Failing open means anyone who can fill the store switches off brute-force protection for every new subject, which is the exact moment an attacker wants it off (TM-01). Evicting the oldest or a random live counter lets an attacker reset their own or a victim's counter by flooding. Failing closed costs availability only, and only for subjects that have no window yet. The cost is real: verified on 2026-10-11, 100,000 distinct sign-up keys (one-hour windows) make the shared store refuse every new checkout, upload, and sign-in key for up to an hour. Isolation limits that damage to the rule being flooded; per-user rules can then only be filled by as many signed-in accounts as their capacity, and anonymous rules are bounded by SR-01 (one key per IPv4 address or IPv6 /64, per-email keys only after the address check).

**Accepted remainder.** An attacker with tens of thousands of distinct networks can still make sign-up or sign-in refuse new subjects while the flood lasts. That is a volumetric attack which an in-process limiter cannot solve; see residual risks.

### SR-03 Client-supplied request ids (decided 2026-10-11)

**Rule.** By default the server generates every request id (`crypto.randomUUID()`) and ignores an incoming `X-Request-Id`. An incoming value is reused only when both hold: the deployment has a trusted proxy configured under SR-01 (`TRUSTED_PROXY_HOPS` of 1 or more, or `TRUSTED_CLIENT_IP_HEADER` set), and the value matches `^[A-Za-z0-9_-]{8,64}$`. The proxy is then expected to set or overwrite the header. `resolveRequestId` must take the trust decision as an explicit argument that defaults to "do not trust"; it must not read the environment by itself. When an untrusted client sends a well-formed id it may be logged as a separate field named `clientRequestId`, never as `requestId`.

**Reason.** The request id is how one request is found in the logs and what a user quotes from an error message. If any client can choose it, an attacker can reuse the id of someone else's request (ids are shown in error bodies and response headers) or one id for thousands of requests, which makes the log trail of an incident ambiguous exactly when it is needed. The format check already prevents header and log injection (verified), so the remaining harm is to log integrity only, hence Low (SEC-003). A proxy that sits in front of every request is a legitimate source of ids because it lets proxy logs and application logs be joined.

### SR-04 Data that must never appear in logs (decided 2026-10-11)

Review of `docs/DATA_MODEL.md` (draft schema v1). Logs identify people and things by opaque id only: `userId`, `storeId`, `orderId`, `orderNumber`, `sellerOrderId`, `productId`, `addressId`, `requestId`.

**Never logged, at any level, including inside error objects:**

| Class | Fields (data-model names and the request fields that carry them) |
| --- | --- |
| Credentials and secrets | passwords and password hashes (`Account.password`), session tokens and session ids, cookies, `Authorization` values, `Verification.value`, any provider access, refresh, or id token, API keys, `AUTH_SECRET`, connection strings with credentials, `ADMIN_BOOTSTRAP_PASSWORD`, one-time codes |
| Email | `User.email`, `ADMIN_BOOTSTRAP_EMAIL`, an email typed into a sign-in or sign-up form |
| Phone | `User.phone`, `Address.phone`, `Store.contactPhone`, `SellerApplication.contactPhone`, `Order.shipPhone` |
| Personal name | `User.name`, `Address.recipientName`, `Order.shipRecipientName` |
| Address, every part | `Address.line1`, `subdistrict`, `district`, `province`, `postalCode`, and the `Order.ship*` copies. Province and district are included: with an order time they narrow down a person, and one rule for the whole address is harder to get wrong |
| Free text written by users or about users | `Review.comment`, `SellerApplication.description`, `SellerApplication.reviewNote`, `Store.statusReason`, `Product.moderationNote`, `Payment.failureReason`, `AuditLog.metadata`, catalog search text (`q`) |
| Parcel identifiers | `Shipment.trackingNumber` (it leads to a recipient's name and address at the carrier) |
| Whole payloads | request bodies, query strings, header collections, database rows, and Prisma arguments, in any form |

**Allowed with limits:**

- The client address from SR-01 may be written under the single key `clientIp`, and only on security events: a rate-limit refusal, a failed or successful sign-in, a sign-up, an `Origin` check failure, and an admin action. It is personal data; how long those lines are kept is an open question for the owner. Any other address-like key (`ip`, `ipAddress`, `remoteAddress`, `x-forwarded-for`, `x-real-ip`, `forwarded`) is redacted.
- `User-Agent` may be logged on the same security events, truncated to 200 characters.
- Store names, product titles, SKUs, and category names are public catalog data and are not personal, but ids are still preferred.

**What the logger must do (backend-api, `src/server/logger.ts`; SEC-001 and SEC-002).** Key matching stays case-insensitive on the key with non-alphanumeric characters removed.

- Redact when the key **contains**: `password`, `passwd`, `pwd`, `passphrase`, `token`, `secret`, `authorization`, `cookie`, `session`, `apikey`, `credential`, `privatekey`, `signature`, `jwt`, `email`, `phone`, `recipient`, `postalcode`, `district` (also covers `subdistrict`), `province`, `street`, `forwarded`.
- Redact when the key **equals**: `sid`, `pass`, `pin`, `otp`, `hash`, `name`, `fullname`, `firstname`, `lastname`, `displayname`, `address`, `shippingaddress`, `billingaddress`, `addressline1`, `addressline2`, `line1`, `line2`, `shipline1`, `ip`, `ipaddress`, `remoteaddress`, `clientaddress`, `realip`, `xrealip`, `comment`, `description`, `reviewnote`, `statusreason`, `moderationnote`, `failurereason`, `metadata`, `trackingnumber`, `q`, `query`, `body`, `headers`, `rawheaders`. `address` is matched exactly, not as a substring, so that `addressId` stays readable.
- The exact key `name` is redacted on ordinary objects but an `Error`'s own `name` (for example `AppError`, which sets it as an own property) must still be written. Use `module` or `component`, not `name`, for logger bindings.
- In every string, wherever it appears (messages, error messages, stacks, values under harmless keys): mask URL user-info up to the **last** `@` before the host (a password containing `@` currently leaks its tail), mask the values of URL query parameters whose names match the "contains" list, mask `key=value` and `key: value` pairs whose key matches the "contains" list (covers `password=...` and a raw `Cookie:` header line), mask `Bearer` tokens (already done), and mask email-shaped substrings.
- Phone numbers inside free text are not pattern-masked: a digit pattern would also destroy ids, amounts, and timestamps. The protection there is the caller rule below.
- Escape U+2028, U+2029, U+0085, and the bidirectional control characters (U+202A to U+202E, U+2066 to U+2069) in the output line (SEC-007).

**What callers must do (every agent that writes a log line).** Log identifiers and outcomes, not payloads. Never pass a request body, a `Request`, a `Headers` object, a database row, or user-typed text to the logger. Database-layer errors are logged with their class name, code, and target model or constraint only; the message of a query-validation error is not logged, because it embeds the query arguments (to be confirmed by the database agent against the installed Prisma version in T-013). Rate-limit keys are never logged, since they contain an email or an address. Key-based redaction is a second line of defence, not the control.

## Session and cookie settings

To be filled in by the auth agent with the values actually configured (T-015).

## Rate-limited endpoints

See the table in [API_CONTRACTS.md](API_CONTRACTS.md). "Per IP" there means per client address as derived by SR-01 (IPv4 address or IPv6 /64, or the shared `unknown` subject). The limiter is in-process and fails closed at its key cap (SR-02); see residual risks.

## Upload policy

JPEG, PNG, WebP. Maximum 5 MB per file, 8 images per product. Content verified by magic bytes. Stored under generated keys. Product images are public by design; no private documents are uploaded in the MVP. The upload endpoint is the only one that accepts `multipart/form-data`, and it is covered by the same `Origin` check as every other mutation (TM-16).

## Privacy and data retention

- Personal data collected: email, name, phone, shipping addresses, order history, and the client IP address in security log lines (and in the auth library's session records, if it stores one). Nothing else.
- No payment card data is collected or stored. The mock provider takes no card input.
- What may and may not be written to logs is defined in SR-04.
- Thailand's PDPA applies to a real launch: a privacy notice, a lawful basis, data-subject request handling, and a retention schedule are required and are **not** part of the MVP. Recorded in KNOWN_LIMITATIONS.md.
- Order and audit records are retained indefinitely in the MVP; deactivated accounts keep their order history.
- Log retention and log access are not decided (questions for the owner, raised 2026-10-11).

## Findings register

Reproduction for SEC-001 to SEC-007: `pnpm exec vitest run --config tests/security/vitest.security.config.mts`. Each open finding is an `it.fails` test whose body asserts the secure behaviour; it is reported as "expected fail" while the flaw exists and turns red when the code is fixed, at which point the security agent re-checks and changes it to a normal test. Result on 2026-10-11: 10 passed (controls that hold), 34 expected fail (open findings).

Format:

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

### SEC-001 Personal data is written to logs in clear text
Severity: Medium
Status: OPEN
Owner: backend-api
Location: src/server/logger.ts:50-76 (redaction lists), src/server/logger.ts:83-87 (`isSensitiveKey`)
Description: The logger redacts by key name, and the lists cover secrets, `line1`, and postal code only. Email, phone, personal names, subdistrict, district, province, IP address, review comments, and tracking numbers pass through unchanged at any depth, and so does an email inside an error message. `errorResponse` logs the original error with its message and stack (src/server/http.ts:120-123), so a database error that quotes its arguments would put a customer's email or phone into the log without any developer choosing to log it. Failure scenario: a checkout handler logs `{ order }` or an unexpected error carries the address payload; the customer's name, phone, and delivery area are then readable by anyone with access to the host's log collector, outside the database's access control and outside any PDPA deletion. No log call site exists yet, which is why this is Medium and not higher.
Reproduction: `tests/security/t019-server-utilities.test.ts`, block "SEC-001" (17 expected-fail cases, one per key plus free-text email).
Remediation: Implement the logger list in SR-04; keep an `Error`'s own `name`. Extend src/server/logger.test.ts accordingly.
Re-check evidence: none yet.

### SEC-002 Secrets survive logger redaction
Severity: Medium
Status: OPEN
Owner: backend-api
Location: src/server/logger.ts:89-95 (`scrubString`), src/server/logger.ts:50-61 (`SENSITIVE_KEY_PARTS`)
Description: (a) The URL-credential pattern stops at the first `@`, so for `postgresql://app:Pa@ssTAIL99@db:5432/shop` the log contains `ssTAIL99@db`; a database password containing an unencoded `@` is a common configuration and connection errors quote the URL. (b) `password=hunter2` inside an error message is logged as is; the project's own test fixture at src/server/http.test.ts:137 uses such a message, and the test checks only the response body. (c) A URL such as `/reset?token=...` logged under a harmless key keeps its token. (d) A raw `Cookie: name=value` line inside a string or array keeps the session cookie. (e) The keys `pwd`, `pass`, `passphrase`, `otp`, `pin`, `signature`, `jwt`, and `hash` are not treated as sensitive. An attacker with read access to logs (or a support engineer, or a third-party log service) obtains credentials or live session tokens.
Reproduction: same test file, block "SEC-002" (12 expected-fail cases).
Remediation: Implement the string-scrubbing and key rules in SR-04.
Re-check evidence: none yet.

### SEC-003 A client chooses the request id written to logs and responses
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/request-id.ts:37-47 (`resolveRequestId`)
Description: Any well-formed `X-Request-Id` from any client is adopted as the request id for the response header, the error envelope, and every log line. An attacker can replay an id copied from another request's error message, or send one id on thousands of requests, so that a later log search for that id returns the attacker's lines mixed with the real ones. Injection is not possible (the pattern check holds; verified).
Reproduction: same test file, block "SEC-003".
Remediation: SR-03. Default to generating the id; accept the header only when the caller passes an explicit "trusted proxy configured" flag.
Re-check evidence: none yet.

### SEC-004 One flood of new keys refuses every other rate-limited action
Severity: Medium
Status: OPEN
Owner: backend-api
Location: src/server/rate-limit.ts:116-121 (saturation branch), src/server/rate-limit.ts:119 (`resetAt` at saturation), src/server/rate-limit.ts:169 (single shared store)
Description: All rules share one store of 100,000 windows. When it is full, every subject without a window is refused. Sign-up windows last one hour and seller-application windows a day, so 100,000 distinct sign-up keys (for example one per IPv6 /64 if addresses are keyed in full, or one per forged `X-Forwarded-For` value if that header were ever trusted) make checkout, uploads, reviews, and sign-in refuse every new subject for up to an hour, and the flood can be repeated. Checkout windows last one minute, so in practice every customer is refused. In addition the refusal reports the rule's whole window as `Retry-After` (24 hours for a seller application) although space may free within a second. Nothing calls the limiter yet, and SR-01 raises the cost of creating keys, hence Medium.
Reproduction: same test file, block "SEC-004" (2 expected-fail cases; the first fills the default store with 100,000 sign-up keys and shows a checkout key refused).
Remediation: SR-02 items 1, 3, and 4. Fail-closed itself stays.
Re-check evidence: none yet.

### SEC-005 Two rules that share a key share one counter and one window
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/rate-limit.ts:147-164 (`consume` takes a bare key), src/server/rate-limit.ts:110-114 (existing window reused whatever the rule)
Description: The stored key is exactly what the caller passes, and the window length is fixed by whichever rule touched the key first. If two handlers both pass `user:<id>`, ten checkouts in a minute consume the hourly review allowance, and a review made first would give checkout a one-hour window. The result is either a limit that is far too loose or a user locked out of an unrelated action. It is a trap in the interface rather than a present bug, because no caller exists.
Reproduction: same test file, block "SEC-005".
Remediation: SR-02 item 2: the limiter takes the rule name and prefixes the key itself.
Re-check evidence: none yet.

### SEC-006 API responses carry no cache directive
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/http.ts:58-62 (`buildHeaders`)
Description: `ok`, `paginated`, and `errorResponse` set no `Cache-Control`. These helpers will carry profiles, addresses, and orders, and DEPLOYMENT.md expects a reverse proxy in front. A proxy or CDN configured to cache by URL could store one customer's `/api/v1/me/addresses` response and serve it to another. Whether the framework adds its own directive to route-handler responses was not verified, because no route handler exists.
Reproduction: same test file, block "SEC-006".
Remediation: Set `Cache-Control: no-store` in `buildHeaders` unless the caller passes a different value on purpose (public catalog responses may opt in to caching).
Re-check evidence: none yet.

### SEC-007 Unicode line separators and bidirectional controls reach the log unescaped
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/logger.ts:184 (`JSON.stringify` of the line)
Description: CR, LF, and C0 control characters are escaped (verified), so a classic forged-line attack fails. `JSON.stringify` leaves U+2028, U+2029, U+0085, and bidirectional overrides (U+202E and similar) as raw characters. Log viewers and terminals that treat the first three as line breaks will show attacker text (a product title, a `User-Agent`) as a separate, forged-looking entry, and a bidirectional override can visually reorder a line for a human reader. Machine parsing is unaffected.
Reproduction: `node -e 'console.log(JSON.stringify({m:"a b‮c"}))'` prints the characters raw (run 2026-10-11).
Remediation: After `JSON.stringify`, replace those code points with their `\uXXXX` escapes.
Re-check evidence: none yet.

### SEC-008 Local database image is referenced by a mutable tag
Severity: Low
Status: OPEN
Owner: devops
Location: docker-compose.yml:18, docker-compose.yml:49
Description: `postgres:18-trixie` is a moving tag. A later pull can silently bring a different image than the one exercised in T-012; if the tag were ever compromised upstream, every developer machine would run it with the development data mounted. Local scope only.
Reproduction: read the file; `docker compose config` shows `image: postgres:18-trixie` with no digest.
Remediation: Pin the digest (`postgres:18-trixie@sha256:...`) and let the dependency bot update it, or record the accepted risk here.
Re-check evidence: none yet.

### SEC-009 Nothing stops the local placeholder database credentials from being used outside local development
Severity: Low
Status: OPEN
Owner: devops
Location: docker-compose.yml:21, docker-compose.yml:52, .env.example:7, .env.example:10 (and the future src/server/env.ts)
Description: The compose file falls back to publicly known passwords when the variables are unset, and `.env.example` contains working connection strings. Both are labelled local-only and the ports are bound to 127.0.0.1 (verified), so there is no exposure today. The failure scenario is procedural: someone copies `.env.example` or the compose file to a staging host, and the database then runs with a password published in the repository. Comments do not prevent that; a startup check does.
Reproduction: `docker compose config` with no `.env` renders `POSTGRES_PASSWORD: local_dev_only_not_a_secret`.
Remediation: In `src/server/env.ts`, when `NODE_ENV=production` refuse to start if `DATABASE_URL` contains `local_dev_only_not_a_secret` or `local_test_only_not_a_secret`, or if `DATABASE_URL_TEST` is set. Keep the 127.0.0.1 bindings.
Re-check evidence: none yet.

### SEC-010 Development dependency with a published high-severity advisory
Severity: Low
Status: OPEN
Owner: orchestrator (package.json and lockfile)
Location: package.json:38 (`eslint-config-next` 16.4.0, which brings `@next/eslint-plugin-next` > `fast-glob` > `micromatch` > `braces` <= 3.0.3)
Description: `pnpm audit` reports GHSA-vfj7-8cjw-p6xm (stack exhaustion in `braces` on deeply nested patterns), rated high by the advisory, with no patched version listed. The package is reached only through the lint toolchain; it is not in the production dependency tree (`pnpm audit --prod`: no known vulnerabilities) and the patterns it expands come from the repository's own lint configuration, not from users. Project severity is therefore Low, but it will make a CI audit step fail as soon as one exists.
Reproduction: `pnpm audit` (exit 1, "1 vulnerabilities found, Severity: 1 high").
Remediation: Update when a fixed release exists, or add a documented override or audit exception limited to this advisory; make the CI gate `pnpm audit --prod` plus a reviewed exception list.
Re-check evidence: none yet.

### SEC-011 .gitignore does not cover key material
Severity: Low
Status: OPEN
Owner: orchestrator (root config)
Location: .gitignore:13-16
Description: `.env` files are ignored (verified with `git check-ignore`), but private keys and certificates (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`) are not, and no secret scanner runs on commits. A locally generated TLS key or a downloaded service-account file placed in the repository folder would be picked up by `git add .`.
Reproduction: `git check-ignore -v server.key` prints nothing.
Remediation: Add those patterns; add a secret scan to CI (planned in T-070).
Re-check evidence: none yet.

## Scans and reviews performed

| Date | Check | Tool and version | Command | Result |
| --- | --- | --- | --- | --- |
| 2026-10-11 | Manual code review of T-019 | none (reading) | `src/server/errors.ts`, `http.ts`, `logger.ts`, `request-id.ts`, `rate-limit.ts` and their tests | SEC-001 to SEC-007 |
| 2026-10-11 | Manual review of T-012 | Docker 29.8.2 | `docker compose config`; `docker compose ps` | Both services published on 127.0.0.1 only (5432, 5433); SEC-008, SEC-009 |
| 2026-10-11 | Security tests | Vitest 5.0.3 | `pnpm exec vitest run --config tests/security/vitest.security.config.mts` | 10 passed, 34 expected fail (open findings), exit 0 |
| 2026-10-11 | Unit tests (unchanged tree under `src`) | Vitest 5.0.3 | `pnpm test` | 13 files, 257 of 257 passed, exit 0 |
| 2026-10-11 | Dependency audit | pnpm 12.11.2 | `pnpm audit`; `pnpm audit --prod` | 1 high advisory in a development-only package (SEC-010); production tree: no known vulnerabilities |
| 2026-10-11 | Secret scan, tracked files | git 2.55.0 `git grep` (no scanner installed: `gitleaks` and `trufflehog` not found) | `git grep -nIiE` for cloud keys, private-key headers, GitHub, Slack, Stripe, Google, npm, and JWT token shapes; URL credentials; `password/secret/token/key = <12+ chars>`; strings of 40+ token characters; lockfile excluded | No credential found. Matches are the labelled local placeholders in `.env.example` and `docker-compose.yml` and fake fixtures in `src/server/*.test.ts` |
| 2026-10-11 | Secret scan, history | git 2.55.0 | `git log --all -p` (7 commits) filtered for the token shapes above; `git log --all --diff-filter=AD --name-only` filtered for env, pem, key, and credential file names | No match; the only env file ever added is `.env.example` |
| 2026-10-11 | Ignore rules | git 2.55.0 | `git check-ignore -v .env .env.local .env.production` | All three ignored; no `.env` file present in the working tree |
| 2026-10-11 | Lint | ESLint 9 with `eslint-config-next` 16.4.0 | `pnpm lint` | exit 0. The configuration has no security rule set (no `eslint-plugin-security` or equivalent), so this says nothing about security |

A clean scan means the tool found nothing. It is not proof of security. The secret scan above is a pattern search written for this review, weaker than a dedicated scanner.

## Residual risks

Not reviewed, because it does not exist yet: authentication and sessions, authorization and tenant isolation, checkout, uploads and file serving, CSRF and CORS handling, security headers, `src/server/env.ts`, any route handler, the database schema, CI workflows, and the production build output (client bundle contents).

Not verified in this review:

- How the rate limiter and logger behave across module instances in the dev server and the production build (review item V6); needs a running route handler.
- Whether the framework adds `Cache-Control` to route-handler responses (SEC-006).
- The auth library's own address detection and rate limiter (SR-01, review item V10).
- The "per email" half of review item S20 (how the email is read before the auth handler consumes the body); it belongs to T-015 and is still open.

Known and standing:

- In-process rate limiting does not protect a multi-instance or serverless deployment.
- The limiter uses fixed windows: a client can make up to twice the limit across a window boundary (for example 10 sign-in attempts in two seconds, then none for a minute).
- The limiter fails closed (SR-02): a flood from very many distinct networks can make one rule refuse new subjects while it lasts. Upstream protection (proxy or CDN rate limiting) is needed for that and is not planned.
- A per-email sign-in limit lets anyone lock a known email out of signing in by sending five bad attempts a minute. This is the usual trade-off against distributed guessing; the auth task should count the per-email limit on failed attempts only and keep the error generic.
- With the default proxy configuration all clients share one per-address bucket (SR-01). Correct limits in any deployment depend on `TRUSTED_PROXY_HOPS` or `TRUSTED_CLIENT_IP_HEADER` being set correctly and on the application port not being reachable around the proxy. A wrong hop count either trusts a client-written address or rate-limits the proxy itself.
- Carrier-grade NAT, offices, and campuses put many users behind one IPv4 address; they share a per-address allowance.
- Logger redaction is by key name and text pattern. A secret or personal value under an unlisted key, or inside free text in a shape the patterns do not know, is still written. The control is that callers log ids, not payloads (SR-04).
- The wall clock drives rate-limit windows; a backward clock step lengthens windows and delays sweeps (fails towards refusing).
- No multi-factor authentication, including for admins.
- No email verification or password recovery until an email provider exists.
- No web application firewall, bot protection, or fraud detection.
- CSP strictness is limited by what the framework's inline scripts require.
- Local-disk file storage has no malware scanning.
- No independent human penetration test is planned within this project.
- Real payment integration will introduce webhook verification, replay protection, and reconciliation risks that the mock does not exercise.
- No dedicated secret scanner is installed locally or in CI yet.

## Reporting a vulnerability

See [.github/SECURITY.md](../.github/SECURITY.md).
