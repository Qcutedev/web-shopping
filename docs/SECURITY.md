# Security

Owner: security agent. Threat model, security rules, findings register, and residual risks.

**State on 2026-10-11: the only application code is the server utilities (T-019) and the local database setup (T-012). Both were reviewed on 2026-10-11, and the T-019 fixes (commit 4407b71) were re-checked the same day. Of 18 findings registered so far, 8 are fixed (SEC-001 to SEC-007 and SEC-011) and 10 are open (0 Critical, 0 High, 0 Medium, 10 Low): SEC-008 to SEC-010 from the first review and SEC-012 to SEC-018 from the re-check. No authentication, route handler, database schema, upload, or checkout code exists, and nothing calls the logger, the rate limiter, or the client-address function yet, so no control that depends on them is implemented or reviewed.** The "Status" columns are updated only with evidence.

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
| TM-01 | Credential stuffing, brute force | Rate limit per client network (derived by SR-01) and per account; the limiter never fails open (SR-02); generic errors; strong hash from the auth library | Auth tests, rate-limit test | PARTIAL: limiter re-checked 2026-10-11, SEC-004 and SEC-005 fixed, SEC-018 open (Low); nothing calls it yet |
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
| TM-21 | Secret exposure | Env-only secrets; validated at startup, including refusal of the local placeholder credentials outside local use (SEC-009); `.env*` git-ignored; secret scan in CI; no secrets in logs (SR-04) | Secret scan, logger tests | PARTIAL: manual pattern scan of tracked files and history clean 2026-10-11 (no scanner tool installed); key material git-ignored (SEC-011 fixed); logger findings SEC-001 and SEC-002 fixed, SEC-012 to SEC-015 open (Low); `src/server/env.ts` does not exist |
| TM-22 | Vulnerable dependencies | Lockfile; `pnpm audit` in CI; Dependabot | Audit output | PARTIAL: audited 2026-10-11, production dependencies clean, one development-only advisory (SEC-010); no CI yet |
| TM-23 | Missing security headers, clickjacking | CSP, HSTS (production), `X-Content-Type-Options`, `frame-ancestors 'none'`, referrer policy; `Cache-Control: no-store` on API responses (SEC-006) | Header test | PARTIAL: envelope helpers send `Cache-Control: no-store` by default (SEC-006 fixed, re-checked 2026-10-11); every other header NOT STARTED |
| TM-24 | Verbose errors | One error envelope; stack traces only in server logs, and those logs follow SR-04; a schema failure is the client's fault only when the handler says so (`parseInput`), otherwise it is a 500 with nothing disclosed | Review, tests | PARTIAL: envelope re-checked 2026-10-11, message and cause do not leak, regression tests in `tests/security`; `details` on an `INTERNAL_ERROR` still reaches the client (SEC-017, Low); no route handler uses it yet |
| TM-25 | Abuse of admin power going unnoticed | Append-only audit log written in the same transaction | Audit tests | NOT STARTED |
| TM-26 | Suspended seller or deactivated user keeps acting | Status checked on every request from the database; sessions revoked on deactivation | Tests | NOT STARTED |
| TM-27 | Mass assignment | Explicit field mapping in services; never spread request bodies into Prisma calls | Review | NOT STARTED |
| TM-28 | CI supply chain | Least-privilege workflow permissions; actions pinned to SHAs; no untrusted input in `run:`; no secrets to fork PRs | Workflow review | NOT STARTED |
| TM-29 | Rate-limit bypass or lock-out through a forged client address | Client address derived only by SR-01; `X-Forwarded-For` ignored unless a proxy is explicitly configured; IPv6 grouped by /64 | Client-address unit tests, `tests/security` SR-01 tests, env validation tests | PARTIAL: `getClientAddress` reviewed 2026-10-11, no way found to forge the result in the default, hop, or single-header mode; `src/server/env.ts` validation does not exist and nothing calls the function yet |
| TM-30 | Denial of service by filling the rate-limit store | Bounded store that never evicts a live counter and never fails open; capacity isolated per rule (SR-02) | `tests/security` SEC-004 tests | PARTIAL: isolation, short retry, and saturation warning verified 2026-10-11 (SEC-004 fixed); SEC-018 open (Low); nothing calls the limiter yet |
| TM-31 | Personal data or secrets copied into logs | Logger redaction list and caller rules in SR-04; ids are logged, payloads are not | `tests/security` SEC-001, SEC-002, and SEC-012 to SEC-015 tests | PARTIAL: the SR-04 list of 2026-10-11 is implemented (SEC-001, SEC-002 fixed); four narrower gaps open (SEC-012 to SEC-015, Low); the caller rules cannot be checked until log call sites exist |
| TM-32 | Forged or confusing log entries | One JSON object per line with control, line-separator, and invisible characters escaped; request ids generated by the server unless a trusted proxy supplies them (SR-03) | `tests/security` log-injection, SEC-003, SEC-007, and SEC-016 tests | PARTIAL: CR, LF, C0 controls, U+0085, U+2028, U+2029, and bidirectional embeddings, overrides, and isolates verified escaped 2026-10-11 (SEC-003, SEC-007 fixed); C1 controls and other invisible characters open (SEC-016, Low) |

## Security rules decided by the security owner

These are binding on the code named in each rule. They are technical rules; none of them decides a product or business matter.

### SR-01 Trusted proxy and client address (decided 2026-10-11)

Resolves the "per IP" half of review item S20.

**Rule.** The client address used for rate limiting and security logging comes from exactly one function, `getClientAddress(request, config)` in `src/server/client-address.ts` (backend-api), where `config` is `{ trustedProxyHops, trustedClientIpHeader? }`. The function does not read the environment: the caller passes the validated configuration in, and the exported constant `NO_TRUSTED_PROXY` is the default. No other code reads `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, or any similar header. What the function trusts is set only by environment variables validated in `src/server/env.ts` (devops):

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

Decisions on the implementation (security owner, 2026-10-11, after reviewing `src/server/client-address.ts`):

- **Text form of an IPv6 network: accepted.** The result is written as the four expanded groups followed by `::/64`, for example `2001:0db8:85a3:0000::/64`. It is an opaque subject and a log value; nothing may parse it back into an address. Every spelling of an address in one /64 gives the same string (tested).
- **Hexadecimal IPv4-mapped form (`::ffff:cb00:7107`) resolves to `unknown`: accepted.** Only the dotted form (`::ffff:203.0.113.7`, any letter case) is converted to the IPv4 address. Fully written-out forms (`0:0:0:0:0:ffff:...`), `::`, and `::1` fall into the all-zero network `0000:0000:0000:0000::/64`. All of these are shared subjects, so the failure direction is a shared allowance, never a fresh one, and a client cannot choose the spelling because the entry is written by the trusted proxy. The staging check in "Deployment conditions" must confirm that the proxy writes plain IPv4 or the dotted mapped form.
- **An invalid configuration throws `TypeError` on every call: accepted.** A configuration outside the table above must never widen what is trusted, and an exception is the fail-closed result. Two conditions: `src/server/env.ts` rejects the same values at startup so that the throw is never reached in a running deployment, and handlers call `getClientAddress` inside the `try` block that ends in `errorResponse`, so that a throw becomes a 500 and not an unhandled rejection.
- **Ports are not accepted.** A proxy that appends `address:port` (some cloud load balancers do) makes every client `unknown`. That is the safe direction, and it is another thing the staging check must catch.

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

**Capacity split (decided 2026-10-11): accepted as implemented.** `sign-in-address`, `sign-in-email`, and `sign-up` hold 40,000 windows each; `checkout`, `uploads`, `seller-application`, and `review-create` hold 20,000 each; the total is exactly 200,000. The anonymous rules get the larger share because their subjects are the cheapest to vary. What the numbers mean in practice:

- A signed-in rule can only be filled by 20,000 distinct accounts acting inside one window, and account creation is itself limited by `sign-up`.
- `sign-up` (one-hour windows) is filled by 40,000 distinct addresses or IPv6 /64 networks inside an hour. **One IPv6 /48 contains 65,536 /64 networks**, and a /48 is what many hosting providers and tunnel brokers hand to a single customer, so one such customer can keep `sign-up` refusing new networks with about 11 requests a second. The same holder needs about 670 requests a second to do it to `sign-in-address` (one-minute windows). Existing subjects keep their counters and nothing fails open; the cost is that new visitors cannot sign up or sign in while the flood lasts. This is part of the accepted remainder above and is listed in residual risks; an aggregate limit per /48 or upstream rate limiting is the answer if it is ever observed, and the saturation warning is how it would be observed.
- Because the total is used up, a rule added later does not fit. Today that makes whichever rule is used last throw at run time (SEC-018). Any new rule must come with a new split recorded here.

**Custom stores.** `MemoryRateLimitStore` accepts a smaller total (`maxKeys`) for tests; with a total below the sum of the rule capacities the rules compete again and are not isolated. Production code must use the default.

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

**What the logger must do (backend-api, `src/server/logger.ts`; SEC-001, SEC-002, SEC-007, and the additions of 2026-10-11 tracked as SEC-012 to SEC-016).** Key matching stays case-insensitive on the key with non-alphanumeric characters removed.

- Redact when the key **contains**: `password`, `passwd`, `pwd`, `passphrase`, `token`, `secret`, `authorization`, `cookie`, `session`, `apikey`, `credential`, `privatekey`, `signature`, `jwt`, `email`, `phone`, `recipient`, `postalcode`, `district` (also covers `subdistrict`), `province`, `street`, `forwarded`.
- Redact when the key **equals**: `sid`, `pass`, `pin`, `otp`, `hash`, `name`, `fullname`, `firstname`, `lastname`, `displayname`, `address`, `shippingaddress`, `billingaddress`, `addressline1`, `addressline2`, `line1`, `line2`, `shipline1`, `ip`, `ipaddress`, `remoteaddress`, `clientaddress`, `realip`, `xrealip`, `comment`, `description`, `reviewnote`, `statusreason`, `moderationnote`, `failurereason`, `metadata`, `trackingnumber`, `q`, `query`, `body`, `headers`, `rawheaders`. `address` is matched exactly, not as a substring, so that `addressId` stays readable.
- The exact key `name` is redacted on ordinary objects but an `Error`'s own `name` (for example `AppError`, which sets it as an own property) must still be written. Use `module` or `component`, not `name`, for logger bindings.
- In every string, wherever it appears (messages, error messages, stacks, values under harmless keys): mask URL user-info up to the **last** `@` before the host (a password containing `@` currently leaks its tail), mask the values of URL query parameters whose names match the "contains" list, mask `key=value` and `key: value` pairs whose key matches the "contains" list (covers `password=...` and a raw `Cookie:` header line), mask `Bearer` tokens (already done), and mask email-shaped substrings.
- Phone numbers inside free text are not pattern-masked: a digit pattern would also destroy ids, amounts, and timestamps. The protection there is the caller rule below.
- Escape U+2028, U+2029, U+0085, and the bidirectional control characters (U+202A to U+202E, U+2066 to U+2069) in the output line (SEC-007).

**Additions decided on 2026-10-11 after the re-check (not implemented yet; each is tracked by the finding named).**

- Keys, "equals" list, add: `username`, `customername`, `contactname`, `tel`, `mobile`. These are the names a developer is most likely to give a copy of `User.name` or a phone number (SEC-015).
- `key=value` and `key: value` pairs inside strings are also masked when the key **equals** `sid`, `pass`, `pin`, or `otp` (the short secret names of the "equals" list; the rest of that list stays key-only because words such as `name`, `query`, and `hash` are too common in ordinary text). A run of up to 32 blanks on either side of the separator, and the separator `=>`, must not defeat the mask (SEC-015).
- The local part of an email may contain an apostrophe (`o'brien@example.com` is accepted by `z.email()`, verified against the installed Zod); the email mask must cover the whole local part and today leaves `o'` (SEC-015).
- Local-scheme exemption (`file`, `node`, `webpack`, `webpack-internal`, `turbopack`): allowed, but it covers only that URL. A further `://` inside the same unbroken run of text must still have its user-info masked (SEC-012).
- File-position exemption: allowed only when the colon is followed by a line number and nothing else, that is digits, optionally `:` and more digits, and then the end of the text, a blank, a line end, or `)`. `session.ts:12:5` stays readable; `db.password.prod:9x7Qz` is masked (SEC-013).
- Clipping: a string is still clipped before it is scanned, so that the cost stays bounded, but the clip must not leave the beginning of something the full string would have masked. At a cut, an unfinished URL (a `://` with no blank after it) loses everything after `://`, and an unfinished email (an `@` in the last 256 characters with no complete domain after it) loses its local part (SEC-014).
- Output escaping is widened from the list above to: U+007F to U+009F (DEL and all C1 controls; U+009B starts a terminal escape sequence on terminals that honour 8-bit controls), U+2028, U+2029, and every character of Unicode general category Cf (format). Cf covers the soft hyphen U+00AD, the Arabic letter mark U+061C, U+180E, zero-width characters and direction marks U+200B to U+200F, all bidirectional controls, U+2060 to U+206F, the byte order mark U+FEFF, U+FFF9 to U+FFFB, and the tag characters U+E0001 and U+E0020 to U+E007F. In a regular expression with the `u` flag this is `[\u007F-\u009F\u2028\u2029\p{Cf}]`; a character outside the Basic Multilingual Plane is written as its two `\uXXXX` surrogate escapes. A JSON parser reads back exactly the original string, so nothing is lost for machines (SEC-016).

**Logger behaviour reviewed and accepted on 2026-10-11 (no change required).**

| Behaviour | Decision |
| --- | --- |
| A URL is masked from `://` to the **last** `@` of the run, so a URL with an `@` in its path or query loses the part in front of it | Accepted. Over-masking is the safe direction; verified with passwords containing `@` and `/` |
| A `key: value` secret is masked to the end of the line | Accepted. A header value may contain blanks; the rest of a line after a secret key is not worth keeping |
| `Bearer` is matched in any letter case; a standalone `Basic` credential only with a capital B and 8 or more base64 characters | Accepted. The application uses no Basic authentication, a lower-case scheme on an `authorization:` line is masked by the key rule (verified), and a case-insensitive match would mask ordinary prose such as "basic information" |
| An email is masked only when its domain has a dot and ends in two or more letters, so `user@localhost`, `user@[203.0.113.5]`, a quoted local part, a punycode top-level domain, and a percent-encoded `@` are not recognised | Accepted. A customer email reaches the database only through `z.email()`, which rejects the first four shapes (verified against the installed Zod), so they are not customer addresses; a percent-encoded address appears only inside a query string, which callers must not log. Recorded under residual risks |
| `file://user:password@host/...` is not masked | Accepted. That is not a form any driver or tool in this stack produces; the exemption exists so that stack frames stay readable |
| A value under a harmless key is not treated as a secret when it has no recognisable shape: a bare JWT, a name/value pair split over two array items (`["authorization", "Token ..."]`), a schemeless `user:password@host`, a value on the line after its key, a `Bearer` token containing characters outside the token alphabet, a key written in full-width letters or with a zero-width character inside a string | Accepted. No pattern can know these, and guessing would destroy ordinary text. `Headers`, `URLSearchParams`, `Map`, and plain objects are redacted by name (verified); the control is the caller rule below |
| A boxed string (`new String(...)`) is written as an object of single characters, which no mask recognises | Accepted. Nothing in the code base creates boxed strings; recorded under residual risks |
| Keys are normalised at their full length before the entry budget applies; 100 keys of 1,000,000 characters each took 0.8 s, growing linearly | Accepted. The cost is proportional to text the caller itself built, there is no amplification, and request bodies are never logged. If the logger is changed for SEC-014 anyway, redacting any key longer than 256 characters without normalising it would close this as well |
| Budget of 2,000 values and 64,000 characters per entry; strings clipped at 8,000 characters; arrays and objects at 100 entries; depth 8 | Accepted, subject to SEC-014 |

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
- Log retention and log access are not decided (questions for the owner, raised 2026-10-11). In plain words: for how many days are server logs kept before they are deleted, and who is allowed to read them? Security log lines contain the visitor's IP address, which is personal data.

## Findings register

Reproduction for every finding against `src/server`: `pnpm exec vitest run --project security` (file `tests/security/t019-server-utilities.test.ts`; the project is also part of `pnpm test`). Each open finding is an `it.fails` test whose body asserts the secure behaviour; it is reported as "expected fail" while the flaw exists and turns red when the code is fixed. The owner may then change `it.fails` to `it` without touching the body, and the security agent re-checks independently before the finding is marked fixed.

History of that run:

| Date | Passed | Expected fail | Meaning |
| --- | --- | --- | --- |
| 2026-10-11, first review | 10 | 34 | SEC-001 to SEC-006 open |
| 2026-10-11, after commit 4407b71, file as the implementer left it | 44 | 0 | The 34 reproductions pass. `git show 4407b71 -- tests/security` shows `it.fails` changed to `it` 12 times in the source (34 generated cases), no assertion changed, one `?? ""` added for a compiler option, and `RATE_LIMITS.SIGN_IN` renamed to `SIGN_IN_ADDRESS` in two regression tests. The test was not weakened |
| 2026-10-11, after the re-check | 120 | 41 | 76 new plain tests (adversarial re-checks, SEC-007, SR-01, cost bounds) pass; 41 new cases demonstrate SEC-012 to SEC-018 |

Summary of the register: 18 findings; 8 fixed (SEC-001 to SEC-007, SEC-011); 10 open, all Low (SEC-008, SEC-009, SEC-010, SEC-012 to SEC-018); none accepted.

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
Status: FIXED (re-checked 2026-10-11)
Owner: backend-api
Location: src/server/logger.ts:50-76 (redaction lists), src/server/logger.ts:83-87 (`isSensitiveKey`); line numbers as of the first review
Description: The logger redacts by key name, and the lists cover secrets, `line1`, and postal code only. Email, phone, personal names, subdistrict, district, province, IP address, review comments, and tracking numbers pass through unchanged at any depth, and so does an email inside an error message. `errorResponse` logs the original error with its message and stack (src/server/http.ts:120-123), so a database error that quotes its arguments would put a customer's email or phone into the log without any developer choosing to log it. Failure scenario: a checkout handler logs `{ order }` or an unexpected error carries the address payload; the customer's name, phone, and delivery area are then readable by anyone with access to the host's log collector, outside the database's access control and outside any PDPA deletion. No log call site exists yet, which is why this is Medium and not higher.
Reproduction: `tests/security/t019-server-utilities.test.ts`, block "SEC-001" (17 expected-fail cases, one per key plus free-text email).
Remediation: Implement the logger list in SR-04; keep an `Error`'s own `name`. Extend src/server/logger.test.ts accordingly.
Re-check evidence: 2026-10-11, commit 4407b71. `pnpm exec vitest run --project security`: the 17 original cases pass unchanged. 16 new cases written for the re-check pass: an email under harmless keys, in the message, the request id, logger bindings, a `Map` key, an object key, a `Set`, a symbol, a cause chain, an error's extra property, and a `URL` object; key spellings such as `E_Mail`, `X-Real-IP`, `postal code`; `Headers` and `URLSearchParams` redacted by name; `toJSON` not called; `AppError` keeps its name while a person's `name` is redacted. Code read: `SENSITIVE_KEY_PARTS` and `SENSITIVE_KEYS` in src/server/logger.ts match the SR-04 lists of the first review entry for entry. What the re-check found beyond the original scope is registered as SEC-014 and SEC-015.

### SEC-002 Secrets survive logger redaction
Severity: Medium
Status: FIXED (re-checked 2026-10-11)
Owner: backend-api
Location: src/server/logger.ts:89-95 (`scrubString`), src/server/logger.ts:50-61 (`SENSITIVE_KEY_PARTS`); line numbers as of the first review
Description: (a) The URL-credential pattern stops at the first `@`, so for `postgresql://app:Pa@ssTAIL99@db:5432/shop` the log contains `ssTAIL99@db`; a database password containing an unencoded `@` is a common configuration and connection errors quote the URL. (b) `password=hunter2` inside an error message is logged as is; the project's own test fixture at src/server/http.test.ts:137 uses such a message, and the test checks only the response body. (c) A URL such as `/reset?token=...` logged under a harmless key keeps its token. (d) A raw `Cookie: name=value` line inside a string or array keeps the session cookie. (e) The keys `pwd`, `pass`, `passphrase`, `otp`, `pin`, `signature`, `jwt`, and `hash` are not treated as sensitive. An attacker with read access to logs (or a support engineer, or a third-party log service) obtains credentials or live session tokens.
Reproduction: same test file, block "SEC-002" (12 expected-fail cases).
Remediation: Implement the string-scrubbing and key rules in SR-04.
Re-check evidence: 2026-10-11, commit 4407b71. `pnpm exec vitest run --project security`: the 12 original cases pass unchanged, so items (a) to (e) are closed. 16 new cases pass: upper-case scheme, a password containing `/` and several `@`, an empty user name, a URL after a local-scheme URL and a blank, tabs around `=`, `COOKIE   :   a=...; b=...`, `set-cookie:sid=...`, JSON text with escaped quotes, a quoted value with a blank, `bEaReR`, `BEARER<tab>`, standalone `Basic`, `authorization: basic ...`, several secret query parameters, secrets under sensitive keys in nested arrays and objects, and a real file position kept readable. Each text was checked as a field, as an error message with its stack, and as the log message. The re-check also found four narrower bypasses that the original finding did not describe, two of them introduced by exemptions added in the fix; they are registered as SEC-012 to SEC-015 (all Low) instead of keeping this finding open, because every flaw it described is gone.

### SEC-003 A client chooses the request id written to logs and responses
Severity: Low
Status: FIXED (re-checked 2026-10-11)
Owner: backend-api
Location: src/server/request-id.ts:37-47 (`resolveRequestId`); line numbers as of the first review
Description: Any well-formed `X-Request-Id` from any client is adopted as the request id for the response header, the error envelope, and every log line. An attacker can replay an id copied from another request's error message, or send one id on thousands of requests, so that a later log search for that id returns the attacker's lines mixed with the real ones. Injection is not possible (the pattern check holds; verified).
Reproduction: same test file, block "SEC-003".
Remediation: SR-03. Default to generating the id; accept the header only when the caller passes an explicit "trusted proxy configured" flag.
Re-check evidence: 2026-10-11, commit 4407b71. `pnpm exec vitest run --project security`: the original case passes unchanged; 4 new cases pass: the id is ignored whether passed as a `Request`, a `Headers` object, or a raw value, with no options, `{}`, or `trustIncoming: false`; only the boolean `true` is trusted (`"true"`, `1`, `{}`, `[]` are not); two calls with the same client id give two different UUIDs; with trust on, a client-added second header line is not reused. Code read: `resolveRequestId` takes the decision as an argument defaulting to "do not trust" and the module does not read the environment, as SR-03 requires. Not verifiable yet: that handlers derive `trustIncoming` from the SR-01 configuration and log a client id only as `clientRequestId`, because no handler exists.

### SEC-004 One flood of new keys refuses every other rate-limited action
Severity: Medium
Status: FIXED (re-checked 2026-10-11)
Owner: backend-api
Location: src/server/rate-limit.ts:116-121 (saturation branch), src/server/rate-limit.ts:119 (`resetAt` at saturation), src/server/rate-limit.ts:169 (single shared store); line numbers as of the first review
Description: All rules share one store of 100,000 windows. When it is full, every subject without a window is refused. Sign-up windows last one hour and seller-application windows a day, so 100,000 distinct sign-up keys (for example one per IPv6 /64 if addresses are keyed in full, or one per forged `X-Forwarded-For` value if that header were ever trusted) make checkout, uploads, reviews, and sign-in refuse every new subject for up to an hour, and the flood can be repeated. Checkout windows last one minute, so in practice every customer is refused. In addition the refusal reports the rule's whole window as `Retry-After` (24 hours for a seller application) although space may free within a second. Nothing calls the limiter yet, and SR-01 raises the cost of creating keys, hence Medium.
Reproduction: same test file, block "SEC-004" (2 expected-fail cases; the first fills the default store with 100,000 sign-up keys and shows a checkout key refused).
Remediation: SR-02 items 1, 3, and 4. Fail-closed itself stays.
Re-check evidence: 2026-10-11, commit 4407b71. `pnpm exec vitest run --project security`: the 2 original cases pass unchanged. New case: all three anonymous rules flooded past capacity on the default store (126,000 distinct subjects); the store holds exactly 120,000 windows; a new subject on each flooded rule is refused with `saturated: true` and a retry of at most 60 seconds; a subject that already had a window is still counted (no eviction, no fail-open); `checkout`, `uploads`, `seller-application`, and `review-create` each still accept a new subject; exactly 3 warn lines were written (one per rule) and none contains a subject; after 61 seconds the one-minute rule accepts new subjects again while `sign-up` still refuses. A regression guard checks that `sign-up` holds exactly 40,000 windows. SR-02 items 1, 3, and 4 are met. The capacity split is accepted in SR-02; the related trap found in the re-check is SEC-018.

### SEC-005 Two rules that share a key share one counter and one window
Severity: Low
Status: FIXED (re-checked 2026-10-11)
Owner: backend-api
Location: src/server/rate-limit.ts:147-164 (`consume` takes a bare key), src/server/rate-limit.ts:110-114 (existing window reused whatever the rule); line numbers as of the first review
Description: The stored key is exactly what the caller passes, and the window length is fixed by whichever rule touched the key first. If two handlers both pass `user:<id>`, ten checkouts in a minute consume the hourly review allowance, and a review made first would give checkout a one-hour window. The result is either a limit that is far too loose or a user locked out of an unrelated action. It is a trap in the interface rather than a present bug, because no caller exists.
Reproduction: same test file, block "SEC-005".
Remediation: SR-02 item 2: the limiter takes the rule name and prefixes the key itself.
Re-check evidence: 2026-10-11, commit 4407b71. `pnpm exec vitest run --project security`: the original case passes unchanged; 2 new cases pass. A subject cannot be shaped to reach another rule's counter (`x` under `sign-in-address` against `x`, `sign-in-address:x`, and `sign-in-email:x` under the other rule: all separate; rule names cannot contain a colon). A 500-character subject is stored as a digest, and a neighbouring subject, the digest itself, and `sha256:<digest>` each get their own window. The window length follows the rule (checkout resets after a minute, review does not, for the same subject). Reusing a rule name with a different limit throws `TypeError`.

### SEC-006 API responses carry no cache directive
Severity: Low
Status: FIXED (re-checked 2026-10-11)
Owner: backend-api
Location: src/server/http.ts:58-62 (`buildHeaders`); line numbers as of the first review
Description: `ok`, `paginated`, and `errorResponse` set no `Cache-Control`. These helpers will carry profiles, addresses, and orders, and DEPLOYMENT.md expects a reverse proxy in front. A proxy or CDN configured to cache by URL could store one customer's `/api/v1/me/addresses` response and serve it to another. Whether the framework adds its own directive to route-handler responses was not verified, because no route handler exists.
Reproduction: same test file, block "SEC-006".
Remediation: Set `Cache-Control: no-store` in `buildHeaders` unless the caller passes a different value on purpose (public catalog responses may opt in to caching).
Re-check evidence: 2026-10-11, commit 4407b71. `pnpm exec vitest run --project security`: the original case passes unchanged. New case: `ok`, `created`, `paginated`, and `errorResponse` (404, 429, 400, 500) all answer `Cache-Control: no-store`, including when the caller passes `Cache-Control: public, max-age=600` in `headers`, and `errorResponse` ignores a forced `cacheControl` property; only the explicit `cacheControl` option of a success helper changes the value. Observation, no change required: `cacheControl: ""` produces an empty header, which is the caller's explicit choice. Still not verified: what the framework adds or changes on a real route-handler response, and that only endpoints documented as public use the option; both need a route handler.

### SEC-007 Unicode line separators and bidirectional controls reach the log unescaped
Severity: Low
Status: FIXED (re-checked 2026-10-11)
Owner: backend-api
Location: src/server/logger.ts:184 (`JSON.stringify` of the line); line number as of the first review
Description: CR, LF, and C0 control characters are escaped (verified), so a classic forged-line attack fails. `JSON.stringify` leaves U+2028, U+2029, U+0085, and bidirectional overrides (U+202E and similar) as raw characters. Log viewers and terminals that treat the first three as line breaks will show attacker text (a product title, a `User-Agent`) as a separate, forged-looking entry, and a bidirectional override can visually reorder a line for a human reader. Machine parsing is unaffected.
Reproduction: `node -e 'console.log(JSON.stringify({m:"a\u2028b\u202Ec"}))'` prints the characters raw (run 2026-10-11).
Remediation: After `JSON.stringify`, replace those code points with their `\uXXXX` escapes.
Re-check evidence: 2026-10-11, commit 4407b71. This finding had no test in `tests/security`; 12 were added, one per code point of the original list (U+0085, U+2028, U+2029, U+202A to U+202E, U+2066 to U+2069). Each puts the character into the message, a field key, a nested value, a binding key and value, an error message, and the request id, and checks that the output line does not contain the raw character, does contain its escape, and parses back to the original message. All 12 pass (`pnpm exec vitest run --project security`). The characters this finding did not list (C1 controls, direction marks, zero-width and other format characters) are still written raw; that is SEC-016.

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
Status: FIXED (re-checked 2026-10-11)
Owner: orchestrator (root config)
Location: .gitignore:13-16
Description: `.env` files are ignored (verified with `git check-ignore`), but private keys and certificates (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`) are not, and no secret scanner runs on commits. A locally generated TLS key or a downloaded service-account file placed in the repository folder would be picked up by `git add .`.
Reproduction: `git check-ignore -v server.key` prints nothing.
Remediation: Add those patterns; add a secret scan to CI (planned in T-070).
Re-check evidence: 2026-10-11. `git check-ignore -v server.key id_rsa cert.pem` prints `.gitignore:20:*.key server.key`, `.gitignore:23:id_rsa* id_rsa`, `.gitignore:19:*.pem cert.pem`, exit 0. The ignore rules are in place. The secret scan in CI is not part of this finding any more; it stays planned in T-070 and listed under residual risks.

### SEC-012 A URL password survives when a local-scheme URL starts the same run of text
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/logger.ts:224-248 (`maskUrlUserInfo`: the exemption at line 240 applies to the whole run, and line 245 continues the search after the run)
Description: The fix for SEC-002 exempts the schemes `file`, `node`, `webpack`, `webpack-internal`, and `turbopack` from user-info masking, so that stack frames stay readable. The exemption is applied to the whole unbroken run of non-blank characters that follows the scheme, and the scan then skips that run. A connection URL that follows a local-scheme URL without a blank, quote, or angle bracket in between is therefore never looked at: `at connect (file:///app/db.js:1:1):postgresql://app:PASSWORD@db:5432/shop`, `webpack-internal:///./src/db.ts?u=postgresql://app:PASSWORD@db:5432/shop`, and `[file:///a.js,redis://:PASSWORD@cache:6379]` are written with the password in clear text. When the host has no dot (`db`, `cache`, `localhost`, the usual container names) the email mask does not catch it either. An attacker with read access to logs obtains a database or cache password. It needs two URLs glued together in one error text, which is unusual, hence Low.
Reproduction: `tests/security/t019-server-utilities.test.ts`, block "SEC-012" (3 expected-fail cases).
Remediation: SR-04 addition of 2026-10-11: the exemption covers only the local URL itself. Any further `://` inside the same run must still be masked, and the scan must stay linear (for example by remembering, while walking the run, the last `://` whose scheme is not local, instead of restarting the walk).
Re-check evidence: none yet.

### SEC-013 A secret shaped like a file position is exempt from masking
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/logger.ts:262 (`FILE_NAME_PATTERN`), src/server/logger.ts:316 (`isFilePosition`)
Description: To keep `session.ts:12:5` readable, a `key: value` pair is left alone when the key ends in a dot and one to four letters or digits and the value starts with a digit. Nothing checks that the value is only a line number. `db.password.prod:9x7QzSecret`, `api.token.v1:12345abcdef`, and `auth.secret.key:0abc` are written unmasked. Dotted configuration keys followed by a value that starts with a digit are an ordinary shape for properties files and for values such as numeric tokens.
Reproduction: same test file, block "SEC-013" (3 expected-fail cases); the plain test "keeps a real file position readable" must keep passing after the fix.
Remediation: SR-04 addition of 2026-10-11: exempt only when the colon is followed by digits, optionally `:` and digits, and then the end of the text, a blank, a line end, or `)`.
Re-check evidence: none yet.

### SEC-014 Clipping before scrubbing leaves the start of a secret or an email at the cut
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/logger.ts:443-446 (`scrubString` clips, then scans), src/server/logger.ts:463-468 (`scrubWithinBudget`, the same at the entry-budget boundary)
Description: To bound the cost, a string is cut to 8,000 characters (or to what is left of the 64,000-character entry budget) before the masks run. The masks then see an incomplete shape and do not recognise it: a URL whose `@` lies beyond the cut is written as `postgresql://app:SECRET[Truncated]`, and an email whose domain is cut is written as `somchai@exam[Truncated]`. Observed on 2026-10-11 with both. The first part of a password, or a customer's whole local part, reaches the log. It needs a text longer than 8,000 characters with the sensitive part exactly at the boundary; long database error messages and stacks are the realistic source. `key=value`, `key: value`, and `Bearer` pairs are not affected (the part in front of the cut is still masked; verified).
Reproduction: same test file, block "SEC-014" (2 expected-fail cases).
Remediation: SR-04 addition of 2026-10-11. Keep the clip first, but treat the cut as hostile: after a clip, mask from the last `://` that has no blank after it to the end, and mask the local part in front of an `@` that lies within the last 256 characters and has no complete domain. Alternatively scan a bounded look-ahead (for example 512 characters past the limit) and clip afterwards.
Re-check evidence: none yet.

### SEC-015 Key and key=value matching misses shapes that SR-04 now lists
Severity: Low
Status: OPEN
Owner: backend-api (logger); the rule itself was extended by the security owner on 2026-10-11
Location: src/server/logger.ts:291 and 322 (at most 4 blanks around a separator), src/server/logger.ts:307 (inline keys are matched against the "contains" list only), src/server/logger.ts:100-138 (`SENSITIVE_KEYS`), src/server/logger.ts:373-384 (`isEmailLocalChar`)
Description: Found while trying to break the SEC-001 and SEC-002 fixes. (a) More than four blanks between a key and its separator, or after `=`, defeat the mask: `DB_PASSWORD        = value` (an aligned configuration dump) and `password=      value` are written in clear text. (b) `'password' => 'value'`, the form Node prints for a `Map` entry, is not masked. (c) Inside strings only the "contains" list is used, so `?sid=...`, `?otp=...`, `pin=...`, and `pass=...` keep their values although the same names are redacted as object keys. (d) The keys `userName`, `customerName`, `contactName`, `tel`, and `mobile` are not on any list; they are the obvious names for a copy of `User.name` or a phone number. This part is a gap in the rule as first written, not a deviation by the implementer. (e) An email with an apostrophe in its local part, which `z.email()` accepts, is only partly masked: `somchai'o@example.com` is written as `somchai'[REDACTED]`. None of this is reachable today because nothing logs such data; it weakens the second line of defence.
Reproduction: same test file, block "SEC-015" (13 expected-fail cases).
Remediation: The SR-04 additions of 2026-10-11: accept up to 32 blanks on either side of the separator (still a bounded look-back), treat `=>` as a separator, match the exact inline keys `sid`, `pass`, `pin`, `otp`, add the five keys to the "equals" list, and accept `'` as a local-part character.
Re-check evidence: none yet.

### SEC-016 Invisible, format, and C1 control characters reach the log unescaped
Severity: Low
Status: OPEN
Owner: backend-api (logger); the rule itself was extended by the security owner on 2026-10-11
Location: src/server/logger.ts:638-643 (`UNSAFE_OUTPUT_RANGES`)
Description: SEC-007 listed line separators and bidirectional embeddings, overrides, and isolates, and those are now escaped. The implementer correctly pointed out that the direction marks U+200E, U+200F, and U+061C were not on the list. The re-check found the same for DEL and the C1 controls U+0080 to U+009F other than U+0085 (U+009B is the 8-bit form of the escape-sequence introducer, which some terminals honour, so a logged `User-Agent` could move the cursor or recolour text when an operator tails the log), the soft hyphen, zero-width characters U+200B to U+200D, U+2060 to U+206F, the byte order mark, U+FFF9 to U+FFFB, U+180E, and the invisible tag characters U+E0001 and U+E0020 to U+E007F (which can hide text from a human reader while a tool still reads it). The effect is on people and tools reading the log, not on parsing: an entry can be made to look different from what it contains. Machine parsing is unaffected, hence Low.
Reproduction: same test file, block "SEC-016" (18 expected-fail cases, one representative per group).
Remediation: The SR-04 addition of 2026-10-11: escape `[\u007F-\u009F\u2028\u2029\p{Cf}]` (with the `u` flag) in the output line; write a character outside the Basic Multilingual Plane as its two surrogate escapes.
Re-check evidence: none yet.

### SEC-017 Details passed to an INTERNAL_ERROR reach the client
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/errors.ts:88-100 (the constructor fixes the message of an `INTERNAL_ERROR` but keeps `options.details`), src/server/errors.ts:103-105 (`toPublic`)
Description: The fix made the public message of a 500 constant, whatever the caller passes. `details` is not treated the same way: `new AppError("INTERNAL_ERROR", { details: { sql: "...", target: "..." } })` sends those details to the client (observed 2026-10-11). docs/API_CONTRACTS.md says that an `INTERNAL_ERROR` response "carries nothing about the cause", so the code does not meet its own contract. It takes a developer attaching details to a 500 on purpose, and the helper `internalError(cause)` does not allow it, hence Low; but a 500 is exactly where a developer is tempted to attach diagnostic data, and the type system does not stop it.
Reproduction: same test file, block "SEC-017" (1 expected-fail case).
Remediation: Decision of the security owner: details of an `INTERNAL_ERROR` are forced to `{}` in the constructor, next to the fixed message (and the same for any future code whose status is 500 or above). Diagnostic data belongs in `cause`, which goes to the log only.
Re-check evidence: none yet.

### SEC-018 One extra rate-limit rule makes a built-in rule throw at its first use
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/server/rate-limit.ts:261-296 (`register` runs on first use of each rule), src/server/rate-limit.ts:284-288 (capacity check), src/server/rate-limit.ts:124-137 (built-in capacities add up to exactly `MAX_TOTAL_WINDOWS`)
Description: Rules are registered lazily, when `consume` first sees them, and the built-in rules already use the whole budget of 200,000 windows. If any other rule is ever passed to the process-wide limiter (the API invites it: `consume` accepts any rule object), it registers without complaint as long as it is seen early, and the capacity check then fails for whichever built-in rule happens to be used last. Observed on 2026-10-11: after one call with a new 10,000-key rule, `review-create` throws `TypeError` on every call. In production that would be a permanent 500 on one endpoint, decided by request order after each restart, and it would appear only after deployment. It fails closed, so it is an availability trap rather than a bypass, and it needs a developer mistake, hence Low.
Reproduction: same test file, block "SEC-018" (1 expected-fail case).
Remediation: Make the outcome independent of call order. For example register the built-in rules when the limiter is created, so that a rule that does not fit is the one refused, at its own first use and in every test run; or take the full rule set as an argument of `createRateLimiter` and validate it there. A rule added later must come with a new capacity split recorded in SR-02.
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

| 2026-10-11 | Re-check of the T-019 fixes, code reading | git 2.55.0 | `git show --stat 4407b71`; `git show 4407b71 -- tests/security/t019-server-utilities.test.ts`; read `src/server/logger.ts`, `rate-limit.ts`, `request-id.ts`, `http.ts`, `errors.ts`, `client-address.ts` | The lent security test was not weakened (only `it.fails` to `it`, one `?? ""`, one rule rename). SEC-001 to SEC-007 fixed; SEC-012 to SEC-018 registered |
| 2026-10-11 | Re-check, adversarial probe | Vitest 5.0.3, Node 24.20.0 | A scratch test file with about 190 hostile inputs against the logger, limiter, request id, envelope, and client address; deleted afterwards, the useful cases kept in `tests/security` | 31 of 70 logger inputs were written with their marker unmasked, and 25 of 37 unusual code points were written raw. Those that must be fixed became SEC-012 to SEC-016; the rest are decided in SR-04 ("accepted") and listed under residual risks. Request id, cache header, and client address: nothing found. Limiter and envelope: SEC-018, SEC-017 |
| 2026-10-11 | Re-check, logger cost | Vitest 5.0.3, Node 24.20.0 | 18 pathological string shapes logged at 2,000, 4,000, 8,000, and 1,000,000 characters; 7 hostile structures (100,000 keys, 1,000,000-item array and set, 100x100x100 nesting, 800,000 characters of strings, a 9,000,000-character stack) | Every string shape: 0.1 to 1.2 ms at 8,000 characters and 0.4 to 2.1 ms at 1,000,000 (the clip makes the cost flat). Structures: 0.2 to 14 ms. No super-linear growth found; the 169-second stall reported by the code reviewer could not be reproduced on the fixed code. One cost outside the budget: key text is normalised at full length, 269, 414, 806, and 1,795 ms for 100 keys of 250,000, 500,000, 1,000,000, and 2,000,000 characters (linear; accepted in SR-04) |
| 2026-10-11 | Security tests after the re-check | Vitest 5.0.3 | `pnpm exec vitest run --project security` | 120 passed, 41 expected fail (SEC-012 to SEC-018), exit 0 |
| 2026-10-11 | Dependency audit, repeated | pnpm 12.11.2 | `pnpm audit`; `pnpm audit --prod` | Unchanged: 1 high advisory in a development-only package (SEC-010), exit 1; production tree: no known vulnerabilities, exit 0 |
| 2026-10-11 | Ignore rules for key material | git 2.55.0 | `git check-ignore -v server.key id_rsa cert.pem` | All three ignored (`.gitignore` lines 20, 23, 19); SEC-011 fixed |
| 2026-10-11 | Secret scanner availability | none | `Get-Command gitleaks`, `Get-Command trufflehog` | Neither is installed; no scanner was run in the re-check. The commit under review adds only source, tests, and docs under `src/server`, `tests/security`, and `docs`; its test fixtures use invented values |

A clean scan means the tool found nothing. It is not proof of security. The secret scan above is a pattern search written for this review, weaker than a dedicated scanner. The same holds for the tests: 120 passing security tests show that 120 specific attacks fail, not that the utilities are secure.

## Residual risks

Not reviewed, because it does not exist yet: authentication and sessions, authorization and tenant isolation, checkout, uploads and file serving, CSRF and CORS handling, security headers, `src/server/env.ts`, any route handler, the database schema, CI workflows, and the production build output (client bundle contents).

Not verified in this review:

- How the rate limiter and logger behave across module instances in the dev server and the production build (review item V6); needs a running route handler.
- Whether the framework adds or changes `Cache-Control` on route-handler responses (the helpers themselves were verified, SEC-006).
- Every caller-side rule, because no caller exists: that handlers pass the SR-01 configuration to `getClientAddress` and derive `trustIncoming` from it, that a per-email limit is consumed only after the per-address check, that only `clientIp` carries an address in a log line, and that nobody logs a payload (SR-04).
- `src/server/env.ts` does not exist, so nothing validates `TRUSTED_PROXY_HOPS` or `TRUSTED_CLIENT_IP_HEADER` at startup yet; `getClientAddress` refuses an invalid configuration on every call in the meantime.
- The other changes of commit 4407b71 that are not security findings (the `ZodError` boundary, field-path escaping, documentation wording) were read but are the code reviewer's to judge.
- The auth library's own address detection and rate limiter (SR-01, review item V10).
- The "per email" half of review item S20 (how the email is read before the auth handler consumes the body); it belongs to T-015 and is still open.

Known and standing:

- In-process rate limiting does not protect a multi-instance or serverless deployment.
- The limiter uses fixed windows: a client can make up to twice the limit across a window boundary (for example 10 sign-in attempts in two seconds, then none for a minute).
- The limiter fails closed (SR-02): a flood from very many distinct networks can make one rule refuse new subjects while it lasts. Upstream protection (proxy or CDN rate limiting) is needed for that and is not planned.
- A per-email sign-in limit lets anyone lock a known email out of signing in by sending five bad attempts a minute. This is the usual trade-off against distributed guessing; the auth task should count the per-email limit on failed attempts only and keep the error generic.
- With the default proxy configuration all clients share one per-address bucket (SR-01). Correct limits in any deployment depend on `TRUSTED_PROXY_HOPS` or `TRUSTED_CLIENT_IP_HEADER` being set correctly and on the application port not being reachable around the proxy. A wrong hop count either trusts a client-written address or rate-limits the proxy itself.
- Carrier-grade NAT, offices, and campuses put many users behind one IPv4 address; they share a per-address allowance.
- One holder of an IPv6 /48 controls 65,536 /64 networks, more than the 40,000 windows of an anonymous rule, and can keep `sign-up` (about 11 requests a second) or `sign-in-address` (about 670 a second) refusing new networks. Nothing fails open and existing subjects are unaffected (SR-02, capacity split).
- Addresses that a proxy writes in an unusual form share a subject: hexadecimal IPv4-mapped addresses are `unknown`, written-out mapped addresses and loopback share the all-zero /64, and all NAT64 clients share one /64 (SR-01).
- Logger redaction is by key name and text pattern. A secret or personal value under an unlisted key, or inside free text in a shape the patterns do not know, is still written. The control is that callers log ids, not payloads (SR-04).
- Shapes the logger is known not to mask, observed on 2026-10-11 and accepted in SR-04: a bare JWT or other token with no key in front of it; a header name and its value as two separate array items; `user:password@host` without a scheme; a value on the line after its key; a lower-case standalone `basic` credential; `file://user:password@host`; emails without a dotted domain, with a quoted local part, an address literal, or a percent-encoded `@`; a key written in full-width letters; a boxed `String` object; personal data under a key that is on no list (for example `dob`, `nationalId`). Open and to be fixed: SEC-012 to SEC-016.
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
