# API Contracts

Owner: backend-api agent. This is the **planned** contract, corrected on 2026-10-11 after the T-004 planning review ([reviews/T-004-findings.md](reviews/T-004-findings.md)) the owner answers in [DECISIONS.md](DECISIONS.md) D-025, D-026, and D-028, and the technical rulings in D-029, and corrected again the same day after the cross-document check, for the technical rulings in D-031, and on 2026-10-12 for D-032 (the store status is judged before the body is read; SECURITY.md SR-05 item 5). **Implemented so far: the six catalog endpoints of [section 5.2](#52-catalog) (T-020, 2026-10-13), the six profile and address endpoints of [section 5.3](#53-account) (T-030 backend, 2026-10-13; integration tests not yet run, [section 5.3.1](#531-as-built-t-030-backend-2026-10-13)), the four cart endpoints of [section 5.4](#54-cart) (T-031), `POST /checkout`, `GET /orders`, and `GET /orders/{id}` of [section 5.5](#55-checkout-and-orders) (T-032, 2026-10-14; unit tests only, [section 5.5.5](#555-as-built-t-032-2026-10-14)), the four application and store endpoints of [section 5.7.1](#571-application-and-store) (T-040, 2026-10-14, [section 5.7.1.1](#5711-as-built-t-040-2026-10-14)), `POST /seller/uploads` and `GET /api/files/{key}` of [section 5.8](#58-uploads-and-files) (T-041, 2026-10-19, [section 5.8.1](#581-as-built-t-041-2026-10-19); not security-reviewed), the nine seller product endpoints of [section 5.7.2](#572-products) (T-042, 2026-10-20, [section 5.7.2.1](#5721-as-built-t-042-2026-10-20)), the three seller order endpoints of [section 5.7.3](#573-seller-orders) and `GET /seller/summary` of [section 5.7.4](#574-dashboard-summary) (T-043, 2026-10-20, [section 5.7.3.1](#5731-as-built-t-043-2026-10-20); not security-reviewed and not code-reviewed), the twenty-six admin endpoints of [section 5.9](#59-admin) (T-050, 2026-10-23, [section 5.9.8](#598-as-built-t-050-2026-10-23); unit, route, and integration tests; not reviewed), and `GET /api/health` ([section 5.10](#510-platform)); every other endpoint is planned.** Once an endpoint is built, the Zod schemas in `src/modules/<domain>/schema.ts` are authoritative for it and this document must match them.

What this document must agree with, and which one wins when a name or value is in question:

| Subject | Source |
| --- | --- |
| What the product must do, business rules (BR), stories (REQ) | [REQUIREMENTS.md](REQUIREMENTS.md) |
| Entity, column, and enum names; status values; bounds; state machines | [DATA_MODEL.md](DATA_MODEL.md) |
| Security rules (SR), threat controls (TM) | [SECURITY.md](SECURITY.md) |
| Decisions (D) and owner answers (OQ-01 to OQ-19 and OQ-21 to OQ-24 in D-025; OQ-25 to OQ-50 in D-026) | [DECISIONS.md](DECISIONS.md) |

**D-026, D-028, D-029, D-031, and D-032 are binding and newer than parts of the other documents.** Where another document has not yet been updated to one of them, this contract follows the decision and cites it; the places known to lag are listed in [section 8.4](#84-documents-that-do-not-yet-match-the-decisions).

Markers used below:

- **`OPEN (owner)`**: the point waits for an owner answer that no document and no decision gives. The behaviour is not defined and nothing may be built on a guess (D-019). One such point is listed in [section 8.1](#81-open-owner).
- **`OPEN (technical)`**: not an owner matter; settled by the named task.
- **`DISAGREEMENT`**: two documents say different things and no decision settles it. The contract does not pick a side. None remains ([section 8.3](#83-disagreements-between-documents)).

All open points are collected in [section 8](#8-open-points).

## 1. Conventions

### 1.1 Transport

- Base path: `/api/v1`. JSON request and response bodies, `Content-Type: application/json` (the upload endpoint uses `multipart/form-data`).
- Authentication: session cookie set by the auth handler at `/api/auth/*`. No bearer tokens in the MVP.
- Mutations (`POST`, `PATCH`, `PUT`, `DELETE`) require an `Origin` header matching the application origin.
- Mutation bodies reject unknown keys (strict objects). A body that carries `userId`, `storeId`, `sellerId`, `role`, `isActive`, `isSample`, `slug`, `status`, `moderationStatus`, a price, a total, a discount, or a fee where the endpoint's schema does not list that key is therefore rejected with `400 VALIDATION_ERROR`, and nothing is created or changed (D-029 point 3 for `storeId`; D-031 point 3 for amounts). An amount sent by a client is never used, and it is not silently dropped either: the request that carries it is refused.
- Unknown query parameters are not interpreted. A `storeId`, `userId`, or `role` in a query string never widens or changes what the caller may see.
- The acting user, role, and store always come from the session, never from the request (CLAUDE.md rules 2 and 6).
- `GET` and `HEAD` never change state (SECURITY.md TM-16).
- The order in which a request is checked, and so which refusal it gets when more than one applies, is in [section 1.8](#18-access-levels-and-404-against-403).

Decided by the orchestrator on 2026-10-11:

- **Request id.** The header is `X-Request-Id` on requests and on responses. Every response carries it, and an error envelope repeats it as `error.requestId`. The server generates the id (a UUID). An `X-Request-Id` sent by a client is ignored; it is reused only when the deployment has a trusted proxy configured and the value matches `^[A-Za-z0-9_-]{8,64}$` (security rule SR-03 in [SECURITY.md](SECURITY.md)). Clients must treat the id as opaque and should quote it when reporting a problem.
- **Origin.** A mutation whose `Origin` header is missing, is `null`, or is anything other than exactly the application origin (scheme, host, and port of `APP_URL`) is rejected with `403 FORBIDDEN`, whatever its content type. `GET` and `HEAD` are not checked.
- **Content type.** Each mutation accepts exactly one content type: `application/json`, or `multipart/form-data` for the upload endpoint only. A mutation that receives any other content type is rejected with `415 UNSUPPORTED_MEDIA_TYPE` before the body is read. Only the media type is compared, without regard to letter case or parameters, so `application/json; charset=utf-8` is accepted. A request with no `Content-Type` is rejected the same way, **also when the mutation has no body** ([section 1.2](#12-mutations-without-a-body)).
- **Body size.** A JSON request body may be at most 102,400 bytes (100 KiB), counted in bytes, not characters (security rule SR-05 in [SECURITY.md](SECURITY.md)). A larger body is rejected with `413 PAYLOAD_TOO_LARGE`, the generic message, and empty `details`. The request is refused before the body is read when its `Content-Length` exceeds the limit or is not a plain decimal number; a body sent without a length, or with an untrue one, is refused as soon as the bytes read pass the limit. An endpoint may raise its limit up to 1,048,576 bytes (1 MiB) and then says so in its entry in this document, in the Notes column, as `Body limit: <n> bytes`; an entry that says nothing has the default. No endpoint raises it so far. Uploads have their own limits ([section 5.8](#58-uploads-and-files)) and are not read as JSON.
- **JSON body.** A body that is not valid JSON (an empty body included) is rejected with `400 VALIDATION_ERROR` and exactly one field error, `{ "path": "", "code": "invalid_json", "message": "..." }`. Nothing of the body is echoed. JSON on the wire is UTF-8: a body whose bytes are not valid UTF-8 is rejected in exactly the same way, with `invalid_json`, and is never repaired or read with replacement characters (SECURITY.md SR-05 item 11). A leading byte order mark is accepted and removed. Implemented in `readJsonBody` on 2026-10-12 (SEC-022: fixed, and re-checked by security the same day; commit `6259d32`).
- **Strings that are not well-formed Unicode.** A JSON body that parses but contains a string that is not well-formed Unicode is rejected with `400 VALIDATION_ERROR`, whatever the endpoint's schema is; nothing of the body is echoed (ruled by the orchestrator on 2026-10-12; SECURITY.md SR-05 item 11 and finding SEC-028). Such a string is a surrogate half without its other half, and it can only arrive as a `\u` escape: `"\ud83d"` is valid JSON in plain ASCII, so the UTF-8 rule above does not stop it. It is refused wherever it stands, in a string value or in an object key, at any depth. Reason: such a string cannot be written as UTF-8, so whatever stores it later writes U+FFFD in its place, and two different bodies become one stored value. It is never repaired. A complete pair written as two escapes (`"😀"`) is ordinary text and is accepted, as is every other escape. The refusal comes after the size limit (`413` first), after the nesting limit, and after the text was parsed, so a body that is also too deep or not valid JSON gets that answer. Implemented in `readJsonBody` on 2026-10-12; the security re-check of SEC-028 is pending. **Provisional, `OPEN (technical)`:** the field error. As built it is `{ "path": "", "code": "invalid_json", "message": "The request body contains a string that is not well-formed Unicode." }`: the existing field code for a refused JSON body, reused until item 8.2-12 is ruled, whose answer it follows; the choice is one constant, `JSON_STRING_NOT_WELL_FORMED_FIELD_CODE` in `src/server/errors.ts`. The `path` is the empty string and does not say where the string stands. Until the ruling a client may rely on the status and on `VALIDATION_ERROR` only, not on the `code`, the `path`, or the message.
- **JSON nesting.** A JSON body may nest arrays and objects at most 32 levels deep (D-032 point 4; SECURITY.md SR-05 item 12). A deeper body (for example 33 arrays inside one another) is rejected with `400 VALIDATION_ERROR`, whatever the endpoint's schema is; nothing of the body is echoed. A scalar is depth 0, `[]` is 1, `[{}]` is 2; brackets inside a string do not count. The depth is judged after the size limit (`413` first) and before the text is parsed, so a text that is too deep and also not valid JSON gets this answer. Implemented in `readJsonBody` on 2026-10-12 (SEC-023: fixed, and re-checked by security the same day; commit `6259d32`). **Provisional, `OPEN (technical)`:** the field error. As built it is `{ "path": "", "code": "invalid_json", "message": "The request body nests arrays and objects more than 32 levels deep." }`, which reuses the existing field code so that no new public code exists before a ruling; the choice is one constant, `JSON_TOO_DEEP_FIELD_CODE` in `src/server/errors.ts`. It is not ruled ([section 8.2](#82-open-technical), item 8.2-12): until it is, a client may rely on the status and on `VALIDATION_ERROR` only, not on the `code`, the `path`, or the message.
- **A body that stops arriving.** When the body breaks off while it is read (the connection is lost, the request is aborted, or the body ends before its declared length), the request is answered as a client error, with a status below 500 and never `500 INTERNAL_ERROR`, and nothing of the part that arrived is kept or echoed (SECURITY.md SR-05 item 10). Normally nobody is left to receive that answer. Implemented for JSON bodies in `readJsonBody` and `errorResponse` on 2026-10-12 (SEC-024: fixed, and re-checked by security the same day; commit `6259d32`): every failure of a read of the body is answered this way. **Provisional, `OPEN (technical)`:** the status and the code. As built it is `400 VALIDATION_ERROR` with one field error, `{ "path": "", "code": "invalid_json", "message": "The request body was not received completely." }`, which reuses existing codes so that no new public code exists before a ruling; the choice is one constant, `ABORTED_BODY_ERROR_CODE` in `src/server/errors.ts`. It is not ruled ([section 8.2](#82-open-technical), item 8.2-13): until it is, a client may rely only on the status being below 500. A body that merely ends early without a failure of the read (the stream closes in the middle of a document) is judged as what arrived: not valid JSON. How the request is logged is not part of this contract (SR-05 item 10).
- **Required headers.** A missing or malformed required request header is rejected with `400 VALIDATION_ERROR` and a field error whose `path` is the header name as this document spells it and whose `code` is `invalid_header`. So far this applies to `Idempotency-Key` on `POST /checkout`: `{ "path": "Idempotency-Key", "code": "invalid_header", "message": "..." }`.
- **Caching.** Every envelope response, success or error, is sent with `Cache-Control: no-store` unless the endpoint's entry in this document says otherwise. Only public endpoints whose response does not depend on who is asking may be documented as cacheable; none is so far. Error responses are always `no-store`.

### 1.2 Mutations without a body

Settled on 2026-10-11 from documents that already decide it; this was the first of the two contract points left open by T-019.

**Rule.** Every mutation sends `Content-Type: application/json` (the upload endpoint: `multipart/form-data`), whether or not it has a body. A mutation without a body that arrives with no `Content-Type`, or with any other one, is rejected with `415 UNSUPPORTED_MEDIA_TYPE`. Its handler calls `assertSameOrigin` and then `assertContentType(request, JSON_CONTENT_TYPE)`; it does not read the body, so whatever a client sends as a body to such an endpoint is never read or parsed.

**What determines it.**

- SECURITY.md TM-16: "Each mutation accepts exactly one content type and rejects any other with 415 before reading the body: `application/json` everywhere, except the upload endpoint", and "No endpoint accepts `application/x-www-form-urlencoded` or `text/plain`".
- SECURITY.md, "CSRF helper": a missing content type is 415, and that is what keeps a plain HTML form (which can only send three content types, with or without fields) from reaching an endpoint where an old browser omits `Origin`. That reasoning does not depend on the endpoint having a body.
- SECURITY.md, residual risks: when handlers exist, a test must enumerate **every** mutation route and prove the origin and content-type checks on each.
- The code: `assertContentType` in `src/server/http.ts` refuses a missing header, and `src/server/http.test.ts` asserts it for a request with no body.

Mutations without a body are marked "No body" in the endpoint tables.

### 1.3 The `Idempotency-Key` header

Required on `POST /checkout` only.

Determined by the documents:

- The value is a UUID (D-009). A missing or malformed value is `400 VALIDATION_ERROR` with `invalid_header` ([section 1.1](#11-transport)).
- The key is scoped to the acting user: uniqueness is on `(userId, idempotencyKey)` (DATA_MODEL.md section 6.10). Two users may use the same key without affecting each other.
- The key is stored in one normalised form and compared exactly (DATA_MODEL.md section 6.10).
- A repeat with the same key returns the order the first request created, in whatever payment state it now is, creates nothing, and does not call the payment provider again (D-023 points 2 and 6). The body of the repeat is not compared with the original: the lookup is by user and key only.
- After a failed payment the customer checks out again with a **new** key (DATA_MODEL.md section 4.3); reusing the old key returns the failed order.

**Settled in T-032 (2026-10-14; item 8.2-4 closed).** The header is accepted in the 36-character hyphenated form of any UUID version, hexadecimal digits in either case (`^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`), and nothing else: no braces, no `urn:uuid:` prefix, no surrounding white space. The normalised form is **lower case**: the key is lower-cased, stored in that form, and compared exactly, so two spellings that differ only in letter case are one key. Built as `idempotencyKeySchema` and `parseIdempotencyKeyHeader` in `src/modules/checkout/schema.ts`. The header is read at step 7 of [section 1.8](#18-access-levels-and-404-against-403), after the body was read (so a body over the limit is `413` first) and before the body's schema is applied (so a request with both a bad header and a bad body gets the header's field error).

### 1.4 Identifiers, slugs, and order numbers

- **Ids are opaque strings** (DATA_MODEL.md section 1). Rows created by the auth library have a different id format from the application's own rows. No client and no schema may assume a length, an alphabet, or a shape. A path or body id is validated only as a non-empty string within a generous safety length; an id that matches no row the caller may see is `404 NOT_FOUND`. The single exception is `MarketplaceSettings`, which has no id in the API at all.
- **Slugs** (finding S11; DATA_MODEL.md section 9) exist for products, stores, and categories.
  - The server generates a slug once, at creation. No request accepts a slug, and a rename (store name, product title, category name) never changes it, so existing links keep working.
  - Form: `<readable part>-<suffix>`, or the suffix alone. The readable part keeps Thai letters, vowels, and tone marks; the suffix is 8 random characters. Two products or stores with the same title or name therefore get different slugs.
  - A slug is unique for ever within its kind; an archived product keeps its slug and it is never reused.
  - Clients treat a slug as opaque text. A `{slug}` path parameter may arrive percent-encoded; the server decodes it and normalises it to Unicode NFC before an exact-match lookup. An unknown slug is `404 NOT_FOUND`.
- **Order numbers** (finding S12; DATA_MODEL.md section 10). `orderNumber` is assigned by the database, is unique under any number of concurrent checkouts, and is returned as a string of at most 24 characters (for example `OD2610110000042`). Clients display it and must not parse it; gaps in the sequence mean nothing. Endpoints address an order by `id`, not by `orderNumber`. A visibly increasing number is accepted for the MVP (D-026, OQ-44).

### 1.5 Money

- Every money field is an **integer number of satang** and its name ends in `Satang` (BR-01, D-005). This includes query parameters ([section 5.2](#52-catalog): `minPriceSatang`, `maxPriceSatang`; finding S13). No endpoint accepts or returns THB as a decimal. Formatting to THB is the presentation layer's job.
- The client never sends a price, a line total, a fee, or an order total for its own purchase; the server computes them from database values inside the transaction (CLAUDE.md rule 3). A body that carries one is refused as an unknown key ([section 1.1](#11-transport); D-031 point 3). The only money a client ever sends is a seller's product price, an admin's shipping-fee setting, and the catalog price filter.
- Bounds (DATA_MODEL.md section 11): product price 100 to 100,000,000 satang (BR-02); quantity 1 to 99 (BR-03); order grand total at most 2,000,000,000 satang (BR-04); flat shipping fee 0 to 100,000 satang (BR-28).
- **Stored amounts fit in 32 bits. Aggregates do not** (finding S15). A field that is a **sum across rows** (a seller's sales total, admin revenue, any report figure) is still integer satang with a name ending in `Satang`, is sent as a JSON number, and **can exceed 2,147,483,647**: two orders at the BR-04 cap are enough. The server sends such a value only after checking that it is a safe integer (below 2^53). Clients must not hold it in a 32-bit integer type. Aggregate fields are marked "aggregate" where they appear.
- The commission rate is not money. It is carried as an integer number of basis points, `commissionRateBps` (100 basis points are 1 percent), the name and unit DATA_MODEL.md section 6.16 stores. The rate is always a **whole number of percent** (D-026, OQ-38), so every value is a multiple of 100 from 0 to 10,000.

### 1.6 Time

- Every timestamp in a response is an ISO 8601 string in **UTC** with the `Z` suffix (for example `2026-10-11T03:20:00.000Z`). The database stores UTC (DATA_MODEL.md section 1).
- Every timestamp in a request (the `from` and `to` filters) must be an ISO 8601 instant with an explicit `Z` or numeric offset; a value without one, and a date without a time, is `400 VALIDATION_ERROR`. The server never guesses a timezone (finding M9).
- A time range is half-open: `from` is inclusive, `to` is exclusive, and `from` must be earlier than `to`.
- Conversion to Asia/Bangkok is done only by the presentation layer, for display and for turning a calendar day picked by a user into the two instants of a range. A report "for 11 October" is therefore requested as `from=2026-10-10T17:00:00Z&to=2026-10-11T17:00:00Z`.

### 1.7 Pagination

**Every list endpoint is paginated** (REQ-N-06; finding M5). There is no unpaginated list in this contract, including short lists such as categories and addresses.

- Query: `page` (integer, default 1, minimum 1) and `pageSize` (integer, default 20, minimum 1, maximum 50). A value outside those bounds is `400 VALIDATION_ERROR`; it is not silently clamped.
- Response: the list envelope of [section 2.1](#21-success-envelope). A page beyond the last one returns an empty `data` array with the true `total`.
- Every ordering ends with `id` as the tie-breaker, so pages are stable (DATA_MODEL.md section 15). No list is ordered by a Thai text column.

List endpoints are marked "Paginated" in the endpoint tables. `GET /cart`, the summaries, the report, and the settings are single resources, not lists.

### 1.8 Access levels, and 404 against 403

Access values used in the endpoint tables (finding B3; DATA_MODEL.md section 4.1):

| Access | Who passes |
| --- | --- |
| `public` | Anyone, logged in or not |
| `user` | Any logged-in, active user of any role |
| `customer-role` | A logged-in user whose role is `CUSTOMER` |
| `seller` | Role `SELLER` **and** the caller's store has status `APPROVED` |
| `seller (any store status)` | Role `SELLER`; the store may be `APPROVED` or `SUSPENDED` |
| `admin` | Role `ADMIN` |

Facts behind the table:

- A store row exists only after an application is approved, and `Store.status` is only ever `APPROVED` or `SUSPENDED`. There is no pending or rejected store.
- A user whose application is `PENDING` or `REJECTED` has role `CUSTOMER` and no store. Such a user is not a seller in any sense this contract uses: every `seller` endpoint answers `403 FORBIDDEN`, and the user follows the application through `/seller/application` ([section 5.7](#57-seller)).
- The role changes from `CUSTOMER` to `SELLER` exactly once, when the application is approved, and never changes back. A suspended seller is still a `SELLER`.
- `ADMIN` is written only by the bootstrap script (BR-26).

**The order of refusals** (D-031 point 4, as amended by D-032 point 1; SECURITY.md SR-05 item 5, which uses the step numbers below). A request is checked in the order below and the first check that fails gives the answer; no later check is made. A request that is both not permitted and invalid is therefore answered as not permitted.

| Step | Check | Refusal | Reads the body |
| --- | --- | --- | --- |
| 1 | Mutations only: the `Origin` header ([section 1.1](#11-transport)) | `403 FORBIDDEN` | No |
| 2 | Mutations only: the `Content-Type` header, also on a mutation without a body ([sections 1.1](#11-transport) and [1.2](#12-mutations-without-a-body)) | `415 UNSUPPORTED_MEDIA_TYPE` | No |
| 3 | Identity: a valid session whose user is active, on anything but a `public` endpoint. A deactivated user has no session (REQ-A-02) and is answered exactly like a caller with none | `401 UNAUTHENTICATED` | No |
| 4 | Access level: the caller's role is the one the endpoint needs (a customer or admin on a `seller` endpoint, a customer or seller on an `admin` endpoint) and, **on an endpoint whose access is `seller`, the caller's store is `APPROVED`** (D-032 point 1). Both come from what step 3 read with the session. The role is judged first. On an endpoint whose access is `seller (any store status)` the role alone is judged | Wrong role: `403 FORBIDDEN`. Role `SELLER`, store `SUSPENDED`, access `seller`: `403 SELLER_NOT_APPROVED` | No |
| 5 | Rate limit, on the endpoints of [section 6](#6-rate-limits-initial-values-tune-after-testing) | `429 RATE_LIMITED` | No |
| 6 | The body is read, within its size limit ([section 1.1](#11-transport); for the upload, [section 5.8](#58-uploads-and-files)) | `413 PAYLOAD_TOO_LARGE` | Yes |
| 7 | Validation: the body is valid JSON and matches its schema; the path parameters, the query, and the required headers match theirs | `400 VALIDATION_ERROR` | Yes |
| 8 | In the service: the store status again, on an endpoint whose access is `seller`, by the service's own check and by the guarded write (DATA_MODEL.md section 7.7) | `403 SELLER_NOT_APPROVED` | |
| 9 | In the service: the resource named by an id does not exist, or belongs to another user or another store | `404 NOT_FOUND` | |
| 10 | In the service: every other outcome the endpoint's entry defines | `409`, `422` | |

- **Steps 1 to 5 use only the headers and the session.** The server does not read or parse a body for a caller it is going to refuse: an anonymous caller gets `401`, a caller with the wrong role gets `403 FORBIDDEN`, and a seller whose store is suspended gets `403 SELLER_NOT_APPROVED` on a `seller` endpoint, whatever the body contains, valid or not, and however large it is.
- **Origin and content type come first**, where sections 1.1 and 1.2 put them: neither needs the body or the session, so a cross-site or mistyped request costs nothing. An anonymous mutation from a foreign origin is `403 FORBIDDEN`, not `401`, and one with no `Content-Type` is `415`, not `401`. The answer at steps 1 and 2 depends only on headers the caller wrote, so it is the same whether or not the browser holds a session.
- **The store status is judged at step 4, before the rate limit and before the body is read** (D-032 point 1, which amends D-031 point 4; before this ruling the store status was first judged in the service, after validation). It applies to every endpoint whose access is `seller`, JSON or multipart; the endpoints open to a seller in any store state (the reads and the three order endpoints, [section 5.7](#57-seller)) judge the role alone. What follows:
  - A suspended seller who sends an invalid body to a `seller` endpoint gets `403 SELLER_NOT_APPROVED`, not `400`.
  - An upload from a suspended store is neither read nor stored ([section 5.8](#58-uploads-and-files)).
  - A request refused for the store status uses none of a rate-limit allowance.
  - A user who is not a `SELLER` never gets `SELLER_NOT_APPROVED`: the role is judged first, so a customer or an admin on a `seller` endpoint is `403 FORBIDDEN`. The only caller who can receive `SELLER_NOT_APPROVED` is the owner of the suspended store, who reads the same status from `GET /seller/store`.
- **Step 8 stays, and is the control.** The check at step 4 is a refusal made sooner, never the control (CLAUDE.md rule 2). A suspension can commit between step 4 and the write, so the service checks the store status again and the write carries the condition itself (DATA_MODEL.md section 7.7). A refusal there has the same status and code as at step 4.
- **A `public` endpoint skips steps 3 and 4.** The endpoints that take a body from an anonymous caller (register and login, [section 5.1](#51-auth-handled-by-the-auth-library)) are therefore limited by rate, at step 5, before the body is read. One limit cannot be: the per-email limit of sign-in needs the email, which is in the body. Its place is fixed in [section 6](#6-rate-limits-initial-values-tune-after-testing) (SECURITY.md SR-05 item 5; D-032 point 2); T-015 shows it on each of the auth library's routes ([section 8.2](#82-open-technical), item 8.2-9).
- **A `GET` or `HEAD` skips steps 1, 2, and 6.** Its path parameters and query are validated at step 7, after identity and the access level: an anonymous request with an invalid query to a protected endpoint is `401`, not `400`.
- **`429` falls at step 5**: after the caller is known and has passed step 4, because the limits other than sign-in and sign-up are counted per user, and before the body is read. A request refused at steps 1 to 4 uses none of the allowance; a request that reaches step 5 uses one, whatever happens to it afterwards (`413`, `400`, `403`, `404`, `409`, or success).
- **`413` falls at step 6**, after steps 1 to 5 and before `400`, in both of its forms: a `Content-Length` that exceeds the limit or is not a plain decimal number, refused before a byte is read, and a body that passes the limit while it is being read. A body that is too large and also not valid JSON is `413`, and so is a request that is too large and also invalid in a header, a path parameter, or the query. The upload's checks on the file (its type and content, `415`; its size, `413`; [section 5.8](#58-uploads-and-files)) are made here as well, while the multipart body is read.
- **Validation looks at the request only** (step 7; D-032 point 2). It makes no database query, so a `400` never depends on whether something exists. An id in a path or a body is checked at this step for its form only ([section 1.4](#14-identifiers-slugs-and-order-numbers)); steps 1 to 7 never consult the resource it names.
- **Store state before ownership** (steps 8 and 9). A suspended seller who names another store's product in a write to a `seller` endpoint gets `403 SELLER_NOT_APPROVED`, not `404`: such a seller is refused in the same way for every id, at step 4 already.
- **Step 10 never comes before step 9 for a resource named by an id.** An outcome that depends on the state of a resource (`INVALID_STATE_TRANSITION`, `UPLOAD_IN_USE`, `PRODUCT_UNAVAILABLE`, and the like) is not evaluated for a resource that is not the caller's.
- **As built (2026-10-13).** Ten handlers exist: the four auth routes of T-015 ([section 5.1](#51-auth)) and the six catalog reads of T-020 ([section 5.2.1](#521-as-built-t-020-2026-10-13)). The auth routes apply this order for what they are: sign-up and sign-in are `public` mutations (steps 1, 2, 5, 6, 7), sign-out is a `user` mutation without a body (steps 1, 2, 3), and the session read is a `public` `GET`. The catalog reads are `public` `GET`s (step 7, then the service). Since T-040 (2026-10-14) `PATCH /seller/store` is the first handler of access `seller` and applies steps 4 and 8, and `GET /seller/store` the first of access `seller (any store status)` ([section 5.7.1.1](#5711-as-built-t-040-2026-10-14)); since T-050 (2026-10-23) the handlers of access `admin` exist and apply steps 1 to 4, 6, and 7 with `requireRole(actor, "ADMIN")` ([section 5.9.8](#598-as-built-t-050-2026-10-23)). In detail:
  - The handler pattern in the file comment of `src/server/http.ts` shows the steps in this order since 2026-10-12 (code-review finding CR-09; re-checked by security the same day against this section, and a security test compares the two; commit `6259d32`): `assertSameOrigin`, `assertContentType`, `requireActor`, the role helper, the store-status helper, the rate limit, `readJsonBody`, `parseInput`, the service. It is a documented pattern, not a mechanism: nothing forces a handler to follow it, and the names it uses for the two helpers of step 4 are placeholders until auth chooses them (T-015). A unit test runs the pattern with stand-in guards and checks the order of refusals of this section; a test that enumerates the real routes is not written yet. Since 2026-10-13 the frame around `run` is one function, `handleRequest` in `src/server/request-frame.ts` (CR-83; [section 1.10](#110-where-the-conventions-are-implemented)); the guards are the first lines of `run`.
  - The guards exist since T-015 (2026-10-13): `requireActor(request)` in `src/server/auth/session.ts` loads the user's active flag, the role, the store id, and the store status with the session (step 3); the role helper `requireRole(actor, ...roles)` (role only) and the store-status helper `requireApprovedSeller(actor)` (role `SELLER` first, then store `APPROVED`; returns `{ storeId }`) are pure, in `src/server/auth/actor.ts` (step 4; D-022; D-032 point 1). In the pattern of `http.ts` they replace the placeholder names `assertRole` and `assertStoreApproved`. An endpoint of access `seller` calls `requireApprovedSeller`, which includes the role check; an endpoint of access `seller (any store status)` calls `requireRole(actor, "SELLER")`.
  - No service of a protected resource exists yet (the catalog service is public and writes nothing), so neither step 8 nor the guarded write does.

  See [section 1.10](#110-where-the-conventions-are-implemented) and item 8.2-11 in [section 8.2](#82-open-technical).

**Not found over forbidden** (D-015; finding S14). This applies to **every** endpoint that names a resource by id, in the path or in the body, whether or not its entry repeats it: a resource owned by another customer or another store is answered exactly like a resource that does not exist, with `404 NOT_FOUND`, the same message, and no change to anything. Ownership is part of the lookup itself, not a fetch followed by a comparison, so a foreign id and an unknown id take the same path (SECURITY.md SR-05 item 5, "Enumeration"). Entries carry the note "Else 404" as a reminder, not as the definition. A `404` caused by an id in the body names the kind of thing that was not found in `details.resource` (for example `"address"` or `"upload"`), never whether it exists.

### 1.9 Sample data, mock payment, and simulated shipping

Mock payment and simulated shipping are **not real**, and seeded content is **sample data**. The API carries a stored fact for each, so that every screen can label them (REQ-N-09; DATA_MODEL.md section 16). The Thai wording of the labels is in `src/i18n/th.ts`.

| Response field | Meaning | Stored as |
| --- | --- | --- |
| `isSample` on a store, a product, and a category | Seeded sample data. `false` for everything created through the application | `Store.isSample`, `Product.isSample`, `Category.isSample` |
| `payment.provider` | `"MOCK"` in the MVP: **a mock payment, no money moves** | `Payment.provider` |
| `payment.isSimulated` | `true` when the provider is the mock. **Derived** from `payment.provider`; there is no such column (finding M1) | derived |
| `shippingFeeIsSimulated` on a seller order and on a cart store group | The fee is a **simulated flat rate**, not a carrier quote. `true` for every row in the MVP | `SellerOrder.shippingFeeIsSimulated` |
| `shipment.isSimulated` | The shipment and its delivery are **simulated**: no carrier is contacted, and a tracking number is only ever what the seller typed | `Shipment.isSimulated` |

No request can set `isSample`, `isSimulated`, or `shippingFeeIsSimulated`; each is an unknown key in every mutation body.

### 1.10 Where the conventions are implemented

"Implemented" below means that a tested helper exists in `src/server/`; applying it is part of each endpoint's task. The handlers that exist on 2026-10-13 are the four auth routes (T-015) and the six catalog reads (T-020); the "State" column names which of them apply a helper. Open security findings on these helpers are tracked in [SECURITY.md](SECURITY.md), not here.

| Convention | Helper | State |
| --- | --- | --- |
| Request id | `resolveRequestId`, `trustsIncomingRequestId` (`request-id.ts`); every envelope helper writes the header (`http.ts`) | Implemented |
| Handler frame | `handleRequest(request, run)` (`request-frame.ts`): `connection()` before the `try`, the request id, the request's logger, and `errorResponse` for anything `run` throws; the guards are the first lines of `run`, in the order of section 1.8. The trust setting of the request id is read in one place, `requestIdTrust()` (`getEnv().trustedProxy`). `handlePublicGet` (`public-get.ts`) is a thin wrapper used by the six catalog handlers (code-review finding CR-83) | Implemented (2026-10-13). The four auth routes still open their own scope in `src/server/auth/routes.ts` and read the trust setting from their runtime; moving them onto the frame is auth's |
| Client address behind "per IP" | `getClientAddress` (`client-address.ts`) | Implemented |
| Origin | `assertSameOrigin(request, allowedOrigin)` (`http.ts`). The allowed origin is an argument; reading and validating `APP_URL` belongs to `src/server/env.ts` (devops) | Implemented; the three auth mutations call it (T-015) |
| Content type | `assertContentType(request, expected)` (`http.ts`); `readJsonBody` calls it for JSON; a handler without a body calls it directly ([section 1.2](#12-mutations-without-a-body)) | Implemented; the three auth mutations call it (T-015) |
| Body size | `readJsonBody(request, { maxBytes })` (`http.ts`): default `DEFAULT_JSON_BODY_LIMIT_BYTES`, ceiling `MAX_JSON_BODY_LIMIT_BYTES`; a larger `maxBytes` throws. Uploads: `readRawBodyBytes(request, maxBytes)` (`http.ts`, ceiling `MAX_RAW_BODY_LIMIT_BYTES` 8 MiB, the same `Content-Length` and streaming checks), called only by `readUploadRequest` in `src/modules/uploads` with `MAX_UPLOAD_BODY_BYTES` | Implemented for JSON and for the upload (T-041) |
| JSON body | `readJsonBody(request)` (`http.ts`), `invalidJsonBody` (`errors.ts`) | Implemented, all in [section 1.1](#11-transport): a body that is not valid JSON; a body that is not valid UTF-8 (strict decoding; SEC-022); the nesting limit of 32 levels (`MAX_JSON_NESTING_DEPTH`, `jsonBodyTooDeep`; SEC-023; its field code is **provisional**, 8.2-12); a body that stops arriving answered as a client error (`requestBodyAborted`, `RequestBodyAbortedError`; SEC-024; its status and code are **provisional**, 8.2-13). Those three were built on 2026-10-12 and re-checked by security the same day (SEC-022 to SEC-024 fixed; commit `6259d32`). Also built on 2026-10-12: a string that is not well-formed Unicode is refused (`jsonStringNotWellFormed`; SEC-028; its field code is **provisional**, 8.2-12), and the two labels logged for a body that stops arriving are kept only in the form of a class name and of an error code (SEC-027; not a contract matter). These two await the security re-check |
| Order of refusals ([section 1.8](#18-access-levels-and-404-against-403)) | The handler pattern documented in `http.ts`; the guards belong to auth (`src/server/auth/**`): `requireActor`, the role helper, and the helper that judges the store status (D-032 point 1) | The documented pattern follows section 1.8 since 2026-10-12 (code-review finding CR-09; re-checked by security the same day, commit `6259d32`). The guards are implemented (T-015, `src/server/auth/session.ts` and `actor.ts`) and the four auth routes apply the order ([section 5.1](#51-auth)); the protected endpoints of later tasks apply it as they are built |
| Required headers | `invalidHeader(name, message)` (`errors.ts`) builds the error; `parseIdempotencyKeyHeader` (`src/modules/checkout/schema.ts`) reads and checks `Idempotency-Key` ([section 1.3](#13-the-idempotency-key-header)) | Implemented (T-032, 2026-10-14) |
| Envelopes, error codes, caching | `ok`, `created`, `paginated`, `errorResponse`, `parseInput` (`http.ts`); `AppError` and the code table (`errors.ts`); `conflict(reason)` requires the reason and puts it in `details.reason` | Implemented; every code of [section 2.3](#23-error-codes) is in `errors.ts` since T-032. Not a contract matter, noted for operators: `errorResponse` logs an error's class name, status, and code only (`describeErrorForLog`, `errors.ts`), never its message or stack, for every unexpected error, library and Prisma errors included (SECURITY.md SEC-048, SR-04; 2026-10-13) |
| Rate limits | `rateLimiter.consume(subject, RATE_LIMITS.<RULE>)` (`rate-limit.ts`) | Limiter implemented; the sign-up and sign-in routes call it (`sign-up`, `sign-in-address`, `sign-in-email`; T-015; `sign-in-account`, SEC-032); `POST /checkout` calls `checkout` on the session's user id (T-032) |

## 2. Envelopes and errors

### 2.1 Success envelope

```json
{ "data": { } }
```

List endpoints:

```json
{ "data": [ ], "meta": { "page": 1, "pageSize": 20, "total": 132, "totalPages": 7 } }
```

### 2.2 Error envelope

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "details": { }, "requestId": "..." } }
```

`message` is a developer-facing English string. The frontend maps `code` to Thai copy.

Decided by the orchestrator on 2026-10-11:

- An error envelope always contains all four keys. `details` is always an object; it is the empty object `{}` when there is nothing to report, never `null` and never absent.
- On `VALIDATION_ERROR`, `details.fields` is an array of `{ "path": string, "code": string, "message": string }`, capped at 50 entries (further errors are not reported).
  - `path` is the location of the offending value: property names and array indexes joined with `.`, and the empty string for the request root (for example unknown keys on the body). A `.` or `\` inside a property name is escaped with a backslash, so the key `a.b` is reported as `a\.b` and `b` nested in `a` as `a.b`. Limitation: an array index and a property name made of the same digits look the same (`items.0`), and so do the root and a property whose name is the empty string.
  - `code` is the schema issue code, for example `invalid_type`, `too_small`, or `unrecognized_keys`. Two codes do not come from a schema: `invalid_json` (the body is not valid JSON, or is not valid UTF-8, [section 1.1](#11-transport); `path` is the empty string and it is the only entry; the same code is reused **provisionally** for a body nested too deep, for one that contains a string that is not well-formed Unicode, and for one that stops arriving, until items 8.2-12 and 8.2-13 are ruled) and `invalid_header` (a required header is missing or malformed; `path` is the header name, for example `Idempotency-Key`).
  - `message` is developer-facing English.
  - `path` and `message` are at most 200 characters each; a longer value is cut and ends with `...`. The rejected value itself is never echoed.
- The message of `INTERNAL_ERROR` is always the same fixed text, its `details` is always `{}`, and its response carries nothing about the cause.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": {
      "fields": [
        { "path": "quantity", "code": "too_small", "message": "Too small: expected number to be >=1" },
        { "path": "", "code": "unrecognized_keys", "message": "Unrecognized key: \"priceSatang\"" }
      ]
    },
    "requestId": "0f8fad5b-d9cb-469f-a165-70867728950e"
  }
}
```

A body that is not valid JSON, and a missing or malformed `Idempotency-Key` (decided by the orchestrator on 2026-10-11; the `message` texts are developer-facing and may change):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": {
      "fields": [{ "path": "", "code": "invalid_json", "message": "The request body is not valid JSON." }]
    },
    "requestId": "0f8fad5b-d9cb-469f-a165-70867728950e"
  }
}
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": {
      "fields": [{ "path": "Idempotency-Key", "code": "invalid_header", "message": "..." }]
    },
    "requestId": "0f8fad5b-d9cb-469f-a165-70867728950e"
  }
}
```

### 2.3 Error codes

"State" says whether the code exists in `src/server/errors.ts` today.

| HTTP | Code | When | `details` | State |
| --- | --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Request body, query, path parameter, or required header fails its schema, or the body is not valid JSON, is not valid UTF-8, or nests more than 32 levels deep | `fields` ([section 2.2](#22-error-envelope)) | Implemented. **Provisional:** the field `code` of a body that nests too deep (8.2-12), and the use of this code for a body that stops arriving (8.2-13); both in [section 1.1](#11-transport) |
| 401 | `UNAUTHENTICATED` | No valid session | `{}` | Implemented |
| 403 | `FORBIDDEN` | Role not allowed for this endpoint; missing, `null`, or foreign `Origin` on a mutation | `{}` | Implemented |
| 403 | `SELLER_NOT_APPROVED` | Role `SELLER` with a `SUSPENDED` store on an endpoint that needs an `APPROVED` store, whatever the body contains ([section 1.8](#18-access-levels-and-404-against-403), steps 4 and 8) | `{}` | Implemented |
| 404 | `NOT_FOUND` | Missing, not visible to the public, or owned by someone else | `{}`, or `{ "resource": "..." }` when an id in the body was not found | Implemented |
| 409 | `INSUFFICIENT_STOCK` | Checkout: at least one cart line cannot be bought, and every such line fails only on stock. Cart write: the product is sold out (D-026, OQ-28) | `items` ([section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought)) | Implemented |
| 409 | `PRODUCT_UNAVAILABLE` | Checkout: at least one cart line cannot be bought for a reason other than stock. Cart write: the product is from the caller's own store (BR-16), or a quantity change on a line whose product is hidden (BR-38; [section 5.4](#54-cart)) | `items` ([section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought)) | Implemented |
| 409 | `CART_EMPTY` | Checkout with no cart, or a cart with no lines (D-023 point 3) | `{}` | Implemented (T-032) |
| 409 | `INVALID_STATE_TRANSITION` | A status change that the state tables do not allow from the current state, including one that lost a race to another request (D-024) | `{}` | Implemented |
| 409 | `CONFLICT` | Any other conflict with existing data; the cases are listed below | `{ "reason": "..." }` | Implemented |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body over the endpoint's limit (100 KiB unless its entry states another), or a `Content-Length` that exceeds it or is not a plain decimal number; upload over the limit | `{}` | Implemented |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Mutation sent with a content type the endpoint does not accept, or with none; upload whose type or content is not allowed | `{}` | Implemented |
| 422 | `ORDER_LIMIT_EXCEEDED` | Checkout grand total above the BR-04 cap; no order, no stock change | `{}` | Implemented |
| 429 | `RATE_LIMITED` | Includes `Retry-After` (whole seconds) | `{}` | Implemented |
| 500 | `INTERNAL_ERROR` | Unexpected; no internals disclosed | `{}` | Implemented |

`CONFLICT` always carries `details.reason`, and nothing else in `details`. The helper `conflict(reason)` in `src/server/errors.ts` requires the reason (code-review finding CR-02): a call without one, or with one that is not upper-case words joined by `_`, is a programming error and never produces a response without a reason. The list below is not in the code yet (item 8.2-10). The reason is one of:

| `reason` | Where |
| --- | --- |
| `DUPLICATE_SKU` | Creating or editing a product with a SKU another live product of the same store has |
| `OPEN_APPLICATION` | Submitting a seller application while one is `PENDING` |
| `DUPLICATE_REVIEW` | A second review for one order item |
| `NOT_DELIVERED` | A review for an item whose seller order is not `DELIVERED` (BR-11) |
| `UPLOAD_IN_USE` | Attaching a picture that is already attached to another product |
| `STALE_REVISION` | An admin moderation decision whose `contentRevision` is not the product's current one ([section 5.9.3](#593-product-moderation-and-contentrevision)) |
| `NEGATIVE_STOCK` | A stock adjustment that would take stock below zero |
| `STOCK_LIMIT` | A stock adjustment that would take stock above 1,000,000 (D-026, OQ-40) |
| `CATEGORY_INACTIVE` | Creating a product in, or moving a product to, a category that is switched off (D-026, OQ-39) |
| `CATEGORY_HAS_PRODUCTS` | Deleting a category that any product references |
| `SELF_DEACTIVATION` | An admin deactivating their own account |
| `LAST_ADMIN` | Deactivating the last active admin |
| `APPLICANT_NOT_CUSTOMER` | Approving an application whose applicant no longer has role `CUSTOMER` |
| `APPLICANT_INACTIVE` | Approving an application whose applicant's account is deactivated (`isActive = false`); the application stays `PENDING` (D-040 point 1) |
| `STORE_NAME_TAKEN` | A store name whose key (NFKC, case folding, white space; DATA_MODEL.md section 21.7) another store already has: submitting a seller application, approving one (the application stays `PENDING`), or renaming a store (SEC-058, D-041 point 1) |
| `STORE_NAME_RESERVED` | A store name whose key, punctuation and symbols removed, contains a reserved name (the marketplace's name, "admin", "official", and the others in `RESERVED_STORE_NAMES`) anywhere: the same three writes (SEC-058, D-041 point 3, widened by D-042 point 1) |
| `CART_LINE_LIMIT` | `POST /cart/items` that would create a new line in a cart already holding 50 lines, and `POST /checkout` of a cart holding more than 50 lines ([section 5.4](#54-cart); SEC-053, owner decision 2026-10-22) |
| `ADDRESS_LIMIT` | `POST /me/addresses` by a user who already holds 50 addresses ([section 5.3.1](#531-as-built-t-030-backend-2026-10-13); D-044 point 4) |

A code or reason that is not in these tables is a contract change ([section 10](#10-change-process)).

## 3. Shared values and state

Names and values are exactly those of DATA_MODEL.md section 3. Anything not listed in a state table is rejected with `409 INVALID_STATE_TRANSITION` and changes nothing.

| Field | Values | On |
| --- | --- | --- |
| `role` | `CUSTOMER`, `SELLER`, `ADMIN` | user |
| application `status` | `PENDING`, `APPROVED`, `REJECTED` | seller application |
| store `status` | `APPROVED`, `SUSPENDED` | store. **No `PENDING` and no `REJECTED`** (finding B3) |
| product `status` | `DRAFT`, `PUBLISHED`, `ARCHIVED` | product: the seller's own switch |
| `moderationStatus` | `PENDING`, `APPROVED`, `REJECTED`, `TAKEN_DOWN` | product: the admin's decision. `TAKEN_DOWN` is where a takedown leads (finding S5) |
| `paymentStatus` | `PENDING`, `PAID`, `FAILED` | order. **There is no `REFUNDED` value**: the system records no refund (BR-21) |
| `payment.provider` | `MOCK` | order payment: a mock payment |
| `fulfilmentStatus` | `PENDING`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED` | seller order |

No response in this contract can contain `REFUNDED`: DATA_MODEL.md section 3 has no such value in schema v1.

### 3.1 Payment status (per order)

| From | To | Trigger |
| --- | --- | --- |
| (new order) | `PENDING` | Checkout |
| `PENDING` | `PAID` | The mock provider confirms |
| `PENDING` | `FAILED` | The mock provider declines (a simulated failure), or the order was still `PENDING` 15 minutes after it was created (D-023 point 6; D-028) |

`PAID` and `FAILED` are final. **No endpoint pays, retries, reopens, or refunds an order**, and no client-callable endpoint sets a payment status (SECURITY.md TM-12).

### 3.2 Fulfilment status (per seller order)

| From | To | Who | Condition and effect |
| --- | --- | --- | --- |
| (new) | `PENDING` | Checkout | |
| `PENDING` | `PROCESSING` | Seller | Only when the order's `paymentStatus` is `PAID` |
| `PROCESSING` | `SHIPPED` | Seller | Creates the shipment; `carrierName` and `trackingNumber` are optional and seller-entered. Simulated: no carrier is contacted |
| `SHIPPED` | `DELIVERED` | Seller or admin | The only exit from `SHIPPED` (BR-29). Simulated: no carrier confirmation |
| `PENDING`, `PROCESSING` | `CANCELLED` | Seller or admin | Restores stock once. Allowed when the order is already `PAID` (BR-21). A seller can cancel only a seller order whose order is `PAID`, because a seller does not see one before that (BR-35; [section 5.7.3](#573-seller-orders)); an admin can cancel whatever the payment status |
| `PENDING` | `CANCELLED` | System | The order's payment failed ([section 5.5.4](#554-failed-payment)) |

`DELIVERED` and `CANCELLED` are final. Customers have no cancel endpoint (REQUIREMENTS Q4).

**`cancellationKind`** is a field on every seller order in every response. It is **derived, not stored** (DATA_MODEL.md section 4.4), and is `null` unless `fulfilmentStatus` is `CANCELLED`:

| `fulfilmentStatus` | `paymentStatus` | `cancellationKind` | Meaning |
| --- | --- | --- | --- |
| `CANCELLED` | `PAID` | `REFUND_OUTSIDE_SYSTEM` | Shown as "ยกเลิกแล้ว คืนเงินนอกระบบ". The payment stays `PAID`; no refund record, amount, or status exists (BR-21) |
| `CANCELLED` | `FAILED` | `PAYMENT_FAILED` | The payment failed; nothing was charged |
| `CANCELLED` | `PENDING` | `BEFORE_PAYMENT` | Cancelled by an admin before the payment finished; a seller cannot (BR-35) |

**Stock is restored at most once per order item** across payment failure, seller cancel, and admin cancel (BR-15, D-023; finding B5). Consequences for callers:

- A cancel request on a seller order that is already `CANCELLED` (for example because its payment failed) is `409 INVALID_STATE_TRANSITION` for an admin and changes no stock. For a seller the same request is `404 NOT_FOUND`, because a seller cannot see the seller orders of a failed order at all (BR-20).
- When a cancel and a payment failure race, exactly one of them moves the seller order; the other gets the response above. Stock ends at its starting value, never above.

### 3.3 Product status and moderation

Two independent fields. Approval is always required and cannot be switched off: no setting, parameter, or request makes a product visible without an admin approving it (BR-17).

`status`, changed only by the seller's endpoints in [section 5.7.2](#572-products):

| From | To | Endpoint |
| --- | --- | --- |
| (new) | `DRAFT` | create |
| `DRAFT` | `PUBLISHED` | publish |
| `PUBLISHED` | `DRAFT` | unpublish |
| `DRAFT`, `PUBLISHED` | `ARCHIVED` | archive, or delete of a product that an order references (BR-12) |

`ARCHIVED` is final.

`moderationStatus`:

| From | To | Trigger |
| --- | --- | --- |
| (new) | `PENDING` | Product created |
| `PENDING` | `APPROVED` | Admin approves. Only when `status` is `PUBLISHED` (D-028; [section 5.9.3](#593-product-moderation-and-contentrevision)) |
| `PENDING` | `REJECTED` | Admin rejects, reason required. Only when `status` is `PUBLISHED` (D-028; [section 5.9.3](#593-product-moderation-and-contentrevision)) |
| `APPROVED` | `TAKEN_DOWN` | Admin takes down, reason required. No condition on `status` |
| `APPROVED` | `PENDING` | The seller changes a moderated field (BR-18) |
| `REJECTED`, `TAKEN_DOWN` | `PENDING` | The seller saves a correction: a change to a moderated field or to the price (BR-19; D-026, OQ-36; D-028) |

- **Moderated fields** (BR-18): `title`, `description`, `categoryId`, and the **set** of pictures. A change to one of them on an `APPROVED` product returns it to `PENDING`, and it is not visible until approved again. A change to one of them raises `contentRevision` by one, whatever the product's `moderationStatus` ([section 5.9.3](#593-product-moderation-and-contentrevision)). A save in which none of them differs from the stored value changes nothing in moderation, apart from the price-only resubmission below.
- **Not moderated:** `priceSatang`, `stock`, `sku`, and `status`. A change applies at once and leaves the `moderationStatus` and the `contentRevision` of an `APPROVED` or `PENDING` product alone (for a `REJECTED` or `TAKEN_DOWN` product see "Resubmission" below). One request that changes a moderated field and the price does both: the price is stored and the product returns to `PENDING`.
- **No seller request sets `moderationStatus`.** The key is unknown in every seller body.
- **Picture order** (D-026, OQ-35). Changing only the **order** of a product's pictures, or which one is first, is **not** a picture change: `moderationStatus` stays as it is and the new order shows at once. Only adding, removing, or replacing a picture is a picture change. In terms of the request: an `imageKeys` array that holds the same keys as before in another order needs no approval; one that holds a different set of keys does. A pure reorder also leaves `contentRevision` and the product's place in the approval queue as they are (DATA_MODEL.md section 4.2).
- **Resubmission** (BR-19; D-026, OQ-36). There is **no separate "submit again" endpoint** and no request that resubmits a product unchanged. Saving a correction to a `REJECTED` or `TAKEN_DOWN` product through `PATCH /seller/products/{id}` returns it to `PENDING` automatically; a save in which nothing differs from the stored values does not. **What counts as a correction** (D-028): a change to `title`, `description`, `categoryId`, the set of pictures, or **`priceSatang`**. A change only to stock, to `sku`, or to the order of the pictures does **not** resubmit the product. The price is a correction only in this case: on an `APPROVED` product a price change still takes effect at once and needs no approval (BR-18). **Every resubmission raises `contentRevision` by one, also when only the price changed** (D-031 point 2; DATA_MODEL.md section 4.2; [section 5.9.3](#593-product-moderation-and-contentrevision)). The price is still not a moderated field; the revision rises because the save changes what the admin is asked to decide on, so that an approve sent from a screen opened before the rejection cannot put a price the admin never saw on sale.
- `moderationNote` holds the reason of the last rejection or takedown. The owning seller and admins can read it; it is cleared on approval.

### 3.4 Visibility and "can be bought"

One definition, from BR-05 and DATA_MODEL.md section 5, used by the catalog, the cart flags, and checkout. A product is **visible** when all five hold: `status` is `PUBLISHED`; `moderationStatus` is `APPROVED`; its store's `status` is `APPROVED`; the store owner's account is active (BR-27); its category is active (BR-23). A store page is public when the third and fourth hold.

- A product that is not visible appears in no public list, its public endpoints answer `404 NOT_FOUND`, and it cannot be added to a cart or bought.
- **Stock is not part of visibility.** A visible product with `stock` 0 is listed and readable, with `soldOut: true` (BR-24).
- A product **can be bought** in quantity `q` when it is visible and `stock >= q`.
- When a deactivated store owner is reactivated, or a switched-off category is switched on again, the store and its products come back by themselves (D-026, OQ-31): visibility reads the current state and no product row was changed.

## 4. How to read the endpoint tables

- Paths are relative to `/api/v1` unless they start with `/api/`.
- "Access" uses the values of [section 1.8](#18-access-levels-and-404-against-403).
- "No body" marks a mutation without a body ([section 1.2](#12-mutations-without-a-body)).
- "Paginated" marks a list ([section 1.7](#17-pagination)).
- "Else 404" is the reminder of the not-found rule of [section 1.8](#18-access-levels-and-404-against-403).
- Text limits that no requirement states (lengths of names, descriptions, reasons, comments, search text) are set in each module's schema when the endpoint is built and are then written into this document; they are `OPEN (technical)` until that task.
- An image is returned as `{ "key": "...", "url": "..." }`: `key` is the storage key ([section 5.8](#58-uploads-and-files)) and `url` is where to load it. `null` when there is none.

## 5. Endpoints

### 5.1 Auth

Implemented in T-015 (2026-10-13). Written into this section by the auth agent; the schemas in `src/modules/auth/schema.ts` are authoritative. The auth library (Better Auth 1.7.7) does the password hashing, the session tokens, and the cookie, but **its own HTTP handler is not mounted**: there is no `/api/auth/*` route. The four routes below are the application's own, under `/api/v1`, and every convention of section 1 applies to them (origin, content type, body size and JSON rules, envelopes, `Cache-Control: no-store`, `X-Request-Id`). The earlier paths `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out`, and `/api/auth/get-session` do not exist.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/auth/sign-up` | public | Body `{ name, email, password }`. Creates a `CUSTOMER` and signs it in (sets the session cookie; CR-57, D-036 item 3). Rate-limited per address (`sign-up`). |
| POST | `/auth/sign-in` | public | Body `{ email, password }`. Sets the session cookie. Rate-limited per address and per email. |
| POST | `/auth/sign-out` | user | No body. Deletes the session on the server and clears the cookie. |
| GET | `/auth/session` | public | The caller's actor, or `null`. Writes nothing. |

**`POST /auth/sign-up`.** Strict body (section 1.1): `name` (trimmed, 1 to 100 characters, the display-name rule `NAME_ALLOWED_TEXT`: see section 5.3.1 for the characters refused; at least one visible character; at most 3 combining marks or kept invisible characters U+200B to U+200D in a row; no combining mark twice in one such run; no two sara e U+0E40 in a row; no U+2800 or U+1D159, SEC-041, SEC-042, SEC-060, D-036 item 7, D-042 point 2), `email` (trimmed, at most 254 characters, a valid address; stored lower-cased), `password` (8 to 128 characters, checked on the server). Any other key, `role`, `isActive`, `phone`, `storeId`, `userId`, `emailVerified`, and `image` included, is `400 VALIDATION_ERROR` and nothing is created. The new user is an active `CUSTOMER`.

- `200 { "data": { "accepted": true } }` with one `Set-Cookie` line for the session cookie (name and attributes as at sign-in, SECURITY.md "Session and cookie settings"), **both** for a new email and for an email that already has an account (CR-57, D-036 item 3; SECURITY.md TM-03):
  - new email: the account is created and signed in; the cookie holds a real session.
  - email that already has an account: nothing is created or changed, and nobody is signed in, whatever password was sent (sign-up is not a second way to check a password). The cookie line has the same name, attributes, and value form (32 characters, a dot, a 44-character signature, URL-encoded) but its value is a decoy that is no session; it replaces any session cookie the browser held.
  - In both cases a session the request came with is ended on the server (rotation, as at sign-in), and the answer comes after the response floor (SEC-035).
  - The answer itself does not say which case happened. The client calls `GET /auth/session` next: an actor means the new account is signed in; `null` means the email was already registered (or the account could not be signed in), and the client shows the sign-in form with a generic message that does not state that the email exists (REQUIREMENTS REQ-C-01 "generic error"). The holder of the existing account signs in normally with `POST /auth/sign-in`.
  - If the sign-in after a successful creation fails unexpectedly, the answer is `500` and the account exists; a retry of the sign-up is then a duplicate, and the user signs in normally.
- `400 VALIDATION_ERROR`: the body fails the schema. `403 FORBIDDEN`, `415`, `413`, `429 RATE_LIMITED` as in section 1.8.

**`POST /auth/sign-in`.** Strict body: `email` (as above), `password` (1 to 128 characters; the length policy is not applied at sign-in).

- `200 { "data": { "userId": "...", "role": "CUSTOMER" } }` with `Set-Cookie` for the session cookie (SECURITY.md, "Session and cookie settings"). A session the request came with is ended (rotation).
- `401 UNAUTHENTICATED`, message `The email or password is incorrect.`, `details` `{}`, no cookie: the same for an unknown email, a wrong password, and a deactivated account (REQ-C-02, REQ-A-02).
- `400`, `403`, `413`, `415`, `429` as in section 1.8; a `429` does not say which of the two limits refused.

**`POST /auth/sign-out`.** No body, `Content-Type: application/json` (section 1.2). `200 { "data": { "signedOut": true } }` with a `Set-Cookie` that clears the cookie; the old cookie is refused from then on. `401 UNAUTHENTICATED` without a valid session. `403`, `415` as in section 1.8.

**`GET /auth/session`.** `200 { "data": { "userId": "...", "role": "SELLER", "storeId": "...", "storeStatus": "SUSPENDED" } }` for a valid session of an active user, read from the database on this request; `200 { "data": null }` otherwise (no cookie, a cookie with a bad signature, an expired session, a deactivated user). `storeId` and `storeStatus` are `null` for a user without a store.

**Order of checks on these routes** (section 1.8; SECURITY.md SR-05 item 5). Sign-up and sign-in are `public`, so steps 3 and 4 are skipped: 1 `Origin`, 2 `Content-Type`, 5 the per-address limit (`sign-up` or `sign-in-address`, on the SR-01 client address, before a byte of the body is read), 6 the body under the default limit of section 1.1, 7 the schema; for sign-in then the per-email limits (`sign-in-email` on the client address and the email, then `sign-in-account` on the email; the email trimmed, lower-cased, NFKC, counted the same whether or not an account has it; SEC-032), and only then the password. Sign-out: 1, 2, 3 (the session), then the deletion; no body is read. Those two are the only routes that check a password or create an account; with the library's handler unmounted no other route does (item 8.2-9, closed).

**No endpoint gives a user the `ADMIN` role** (BR-26; finding S9). Admins are created only by the bootstrap script; there is no promotion endpoint under `/admin`, and `role` is an unknown key in every body of this contract. The script may be run again to create further admins (D-026, OQ-37); that is still not an endpoint. The library is configured so that `role`, `isActive`, and `phone` can never be set through it either (a value at sign-up is replaced by the default; an update is refused).

No password-recovery endpoint exists: there is no email delivery (DECISIONS.md, "Pending decisions").

No endpoint returns the IP address or browser details stored with a session to anyone other than the signed-in user they belong to (SECURITY.md SR-07 item 7), and no endpoint returns server log lines (SR-06 item 4).

### 5.2 Catalog

All public. All return only what the visibility rule allows ([section 3.4](#34-visibility-and-can-be-bought)).

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/categories` | public | Paginated. Active categories only, ordered by `sortOrder`, then `id`. |
| GET | `/categories/{slug}` | public | The `categorySummary` of one active category. Unknown or inactive category: 404. |
| GET | `/products` | public | Paginated. Visible products only. Query below. |
| GET | `/products/{slug}` | public | A product that is not visible: 404. |
| GET | `/products/{slug}/reviews` | public | Paginated, newest first. Product not visible: 404. |
| GET | `/stores/{slug}` | public | Store not `APPROVED`, or owner deactivated: 404. |
| GET | `/stores/{slug}/products` | public | Paginated. Visible products of that store; same query as `/products`. Store not public: 404. |

Query of `GET /products` (and of the store's product list):

| Parameter | Type | Meaning |
| --- | --- | --- |
| `q` | string | Case-insensitive substring match on the product title (D-013) |
| `category` | string | A category **slug**. Unknown or inactive category: `404 NOT_FOUND` (REQ-C-07) |
| `minPriceSatang` | integer satang, 0 to 100,000,000 | Lowest price, inclusive (finding S13) |
| `maxPriceSatang` | integer satang, 0 to 100,000,000 | Highest price, inclusive. Lower than `minPriceSatang`: `400 VALIDATION_ERROR` |
| `sort` | `newest` (default), `price_asc`, `price_desc` | Any other value: `400 VALIDATION_ERROR` |
| `page`, `pageSize` | | [Section 1.7](#17-pagination) |

The earlier names `minPrice` and `maxPrice` no longer exist.

Shapes. The block below is a catalogue of the six shapes keyed by name, not one response; each endpoint returns the matching shape inside the envelope of [section 2.1](#21-success-envelope):

```json
{
  "category": { "id": "...", "name": "...", "slug": "...", "isSample": false },

  "categorySummary": { "name": "...", "slug": "..." },

  "productListItem": {
    "id": "...", "slug": "...", "title": "...",
    "priceSatang": 25900,
    "image": { "key": "...", "url": "..." },
    "soldOut": false,
    "isSample": false,
    "store": { "name": "...", "slug": "...", "isSample": false }
  },

  "productDetail": {
    "id": "...", "slug": "...", "title": "...", "description": "...",
    "priceSatang": 25900,
    "stock": 12,
    "soldOut": false,
    "images": [{ "key": "...", "url": "..." }],
    "category": { "name": "...", "slug": "..." },
    "store": { "name": "...", "slug": "...", "isSample": false },
    "reviewSummary": { "averageRating": 4.5, "count": 8 },
    "isSample": false
  },

  "store": {
    "id": "...", "name": "...", "slug": "...", "description": "...",
    "logo": { "key": "...", "url": "..." },
    "isSample": false
  },

  "review": { "id": "...", "rating": 5, "comment": "...", "createdAt": "2026-10-11T03:20:00.000Z" }
}
```

- `images` is ordered; the first one is the primary picture.
- `soldOut` is `stock == 0` (BR-24). The product detail carries `stock` so that a quantity selector can be capped (BR-30).
- `reviewSummary` is `null` when the product has no review (REQ-C-08). `averageRating` is not money.
- `comment` is plain text, or `null` when the reviewer wrote none. It is returned exactly as stored and must be rendered escaped (REQ-C-14).
- Public responses never contain a SKU, a moderation field, a store's contact phone, or an owner id.

#### 5.2.1 As built (T-020, 2026-10-13)

Implemented in `src/modules/catalog` (service, repository, the visibility rule in `visibility.ts`) and the handlers under `src/app/api/v1/categories`, `products`, and `stores`. The schemas in `src/modules/catalog/schema.ts` are authoritative; this subsection states what they decide beyond the table above.

**Access and order of checks.** All seven are `public` `GET`s: steps 1 to 6 of [section 1.8](#18-access-levels-and-404-against-403) do not apply, nothing is rate-limited, and a session cookie, a role, or a `storeId`, `userId`, or `role` in the query changes nothing. The path parameter is validated first, then the query (`400`), then the service answers (`404`, or `200`). Every response is `Cache-Control: no-store`. No catalog request writes anything (D-029 point 1); the integration tests compare a snapshot of every table and sequence before and after.

**Query parameters.**

| Rule | Detail |
| --- | --- |
| Numbers | `page`, `pageSize`, `minPriceSatang`, `maxPriceSatang` are decimal digits only. A sign, a blank, a fraction (`10.5`, `2.0`), an exponent (`1e3`), hexadecimal, or full-width digits are `400` |
| `page` | At least 1, at most 14 digits (so the offset stays a safe integer; code-review finding CR-84). A page beyond the last one is `200` with an empty `data` and the true `total` |
| `pageSize` | 1 to 50, default 20. `51` and above are `400` (field code `too_big`), never clamped |
| `minPriceSatang`, `maxPriceSatang` | 0 to 100,000,000; both inclusive. `maxPriceSatang` below `minPriceSatang` is `400` on the path `maxPriceSatang` (field code `custom`); equal bounds are allowed |
| `q` | Surrounding white space is removed. Blank (or empty) is the same as no `q`. At most **100 characters** after trimming (item 8.2-7 for this field). Matched case-insensitively as a substring of the title; `%`, `_`, and `\` are ordinary characters, not wildcards. U+0000 or a lone surrogate is `400` in the schema, but through a real query string a lone surrogate cannot arrive: the URL parser decodes bytes such as `%ED%A0%80` (the UTF-8 form of U+D800, invalid UTF-8) to U+FFFD characters, so the request answers `200` and searches the replacement text, not `400` (`src/app/api/v1/products/route.test.ts`, "never hands the service a lone surrogate"; the schema check is covered in `src/modules/catalog/schema.test.ts`) |
| `category` | A category slug, read like a path slug (below). Unknown or inactive: `404 NOT_FOUND` on both product lists |
| `sort` | `newest`, `price_asc`, `price_desc`; anything else, the empty string included, is `400` |
| A known parameter given twice | `400` (field code `invalid_type`); for example `page=1&page=2`. Unknown parameters are ignored, also when repeated |

**Ordering**, every one ending with `id`: `newest` is `createdAt` descending, then `id` descending; `price_asc` is `priceSatang` ascending, then `id` ascending; `price_desc` is `priceSatang` descending, then `id` ascending. Categories: `sortOrder`, then `id`, both ascending. Reviews: `createdAt` descending, then `id` descending.

**`{slug}` path parameter** ([section 1.4](#14-identifiers-slugs-and-order-numbers)). A value that contains `%` is percent-decoded once more by the schema (a generated slug never contains `%`, so a slug the framework already decoded is not changed). **Accepted double decoding** (code-review finding CR-90): the framework decodes the segment first, so a `%` that survives it is decoded again, and `/products/%2541` looks up the slug `A`. This is harmless and stays: the lookup is an exact match, it answers `200` only for a slug that exists and is visible, and that row is reachable by its plain slug anyway; a client must not rely on it. It is then normalised to NFC and matched exactly. After decoding it must be 1 to **200 characters** and contain no U+0000 and no lone surrogate. A broken escape (for example `%E0%B8`) is `400`; a well-formed slug that matches nothing visible is `404`.

**404.** Every refusal of a catalog read is `404 NOT_FOUND` with the default message and `details` `{}`: an unknown slug, a product hidden by any condition of [section 3.4](#34-visibility-and-can-be-bought), a suspended store, a store whose owner is deactivated, an unknown or inactive category. The answers are identical, so none says that a hidden row exists.

**Shapes**, beyond the catalogue above:

- `averageRating` is the mean of the integer ratings rounded to **one decimal place**, half away from zero (ratings 5, 4, 5 give `4.7`).
- `image` of a list item is the picture with the lowest `sortOrder`, or `null`. `images` of the detail is every picture in `sortOrder` order, at most **8** (`MAX_PRODUCT_IMAGES`, the per-product limit; the query takes no more even if more were stored), `[]` when there is none.
- `url` is `/api/files/` followed by the key percent-encoded as one path segment. The file endpoint exists since T-041 ([section 5.8.1](#581-as-built-t-041-2026-10-19)); a key that does not match its pattern (for example a seeded or test key) answers `404`.
- `store.description` is `null` when the seller wrote none; `logo` is `null` without a logo.
- The review shape carries no reviewer name or id.
- `GET /categories/{slug}` (added 2026-10-14 for code-review finding CR-T021-05, so the category page can name its category) returns `categorySummary`, the same `{ name, slug }` pair as `category` in the product detail; TypeScript type `CategorySummaryDto`, path schema `slugParamsSchema`, service `getCategory`. It carries no `id`, `isSample`, `isActive`, or `sortOrder`. One read by `slug` and `isActive = true`, no transaction. An unknown and an inactive category give the identical `404` above; a `{slug}` that fails the path rules is `400`. Query parameters are ignored.

**Consistency.** A list reads its `total` and its page as two statements, not in one transaction, so a write that commits between them can make `total` differ from the rows by that write. Reason: with Prisma 7.10 and `@prisma/adapter-pg`, the relation loads of one query run at the same time on a transaction's single connection, which `pg` 8.23 reports as deprecated and `pg` 9 removes (see `src/modules/catalog/repository.ts`). The consequence for the endpoints that must run in a transaction (CLAUDE.md rule 5) is item 8.2-14 in [section 8.2](#82-open-technical).

**Visibility as one definition.** `VISIBLE_PRODUCT_WHERE` and `PUBLIC_STORE_WHERE` in `src/modules/catalog/visibility.ts`, exported from `@/modules/catalog`, are the query form of [section 3.4](#34-visibility-and-can-be-bought); the cart flags and checkout (T-031, T-032) use them rather than restating the five conditions.

### 5.3 Account

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/me` | user | Profile, role, own store, own latest application. |
| PATCH | `/me` | user | Body: `name`, `phone` only. `email`, `role`, `isActive` are unknown keys. |
| GET | `/me/addresses` | user | Paginated. Own addresses only. |
| POST | `/me/addresses` | user | At most 50 addresses per user (D-044 point 4); the 51st is `409 CONFLICT` `ADDRESS_LIMIT`. |
| PATCH | `/me/addresses/{id}` | user | Owner only. Else 404. |
| DELETE | `/me/addresses/{id}` | user | No body. Owner only. Else 404. An address may be deleted even if orders used it: orders hold their own copy. |

`GET /me`:

```json
{
  "data": {
    "id": "...", "name": "...", "email": "...", "phone": null,
    "role": "SELLER",
    "store": { "id": "...", "name": "...", "slug": "...", "status": "SUSPENDED" },
    "sellerApplication": { "id": "...", "status": "APPROVED" }
  }
}
```

`store` is `null` for a user without a store (every `CUSTOMER`, every `ADMIN`). `sellerApplication` is the latest application or `null`.

Address fields, as named in DATA_MODEL.md section 6.2: `recipientName`, `phone`, `line1`, `subdistrict`, `district`, `province`, `postalCode` (exactly five digits), `isDefault` (boolean, default `false`).

**Setting the default address** (finding M11). There is no separate endpoint: send `"isDefault": true` in `POST /me/addresses` or `PATCH /me/addresses/{id}`. In the same transaction the user's previous default, if any, becomes `isDefault: false`, so there is at most one default per user (REQ-C-04). `"isDefault": false` clears it. Nothing makes an address the default automatically, and deleting the default leaves the user with none.

#### 5.3.1 As built (T-030 backend, 2026-10-13)

Implemented in `src/modules/profile` (schema, service, repository) and the handlers `src/app/api/v1/me/route.ts` (`GET`, `PATCH`), `src/app/api/v1/me/addresses/route.ts` (`GET`, `POST`), and `src/app/api/v1/me/addresses/[id]/route.ts` (`PATCH`, `DELETE`). The schemas in `src/modules/profile/schema.ts` are authoritative; this subsection states what they decide beyond the table above. **Status: the handlers and the unit tests exist; the integration tests in `tests/integration/profile/endpoints.test.ts` are written and have not been run** (no database was available).

**Access and order of checks** ([section 1.8](#18-access-levels-and-404-against-403)). All six are access `user`: every role (`CUSTOMER`, `SELLER` whatever its store status, `ADMIN`) reads and edits its own profile and holds its own addresses; no role is refused, so there is no `403` other than the origin check. Mutations: 1 `Origin` (`403`), 2 `Content-Type` (`415`, also for `DELETE`, which has no body), 3 the session (`401`), 6 the body (`413`; not for `DELETE`), 7 the path parameter and the body (`400`), then the service (`404`). `GET`: 3, then 7 for the query, then the service. Nothing is rate-limited ([section 6](#6-rate-limits-initial-values-tune-after-testing) lists none of these endpoints). Every response is `Cache-Control: no-store`. A `userId`, `storeId`, or `role` in the query string is ignored.

**Responses.**

| Endpoint | Success |
| --- | --- |
| `GET /me` | `200`, the profile shape above. `sellerApplication` is the application with the latest `createdAt` (then the highest `id`) |
| `PATCH /me` | `200`, the profile shape after the change |
| `GET /me/addresses` | `200`, the list envelope of address shapes. Ordered by `isDefault` (the default first), then `createdAt` descending, then `id` descending. Pagination as [section 1.7](#17-pagination) |
| `POST /me/addresses` | `201`, the new address |
| `PATCH /me/addresses/{id}` | `200`, the address after the change |
| `DELETE /me/addresses/{id}` | `200 { "data": { "deleted": true } }` |

The address shape is exactly `{ "id", "recipientName", "phone", "line1", "subdistrict", "district", "province", "postalCode", "isDefault" }`: no `userId` and no timestamps.

**Refusals.**

- `401 UNAUTHENTICATED`: no valid session, or a user deactivated between the guard and the query of `GET /me` or `PATCH /me`.
- `409 CONFLICT`, default message, `details` exactly `{ "reason": "ADDRESS_LIMIT" }`: `POST /me/addresses` by a caller who already holds 50 addresses (`MAX_ADDRESSES_PER_USER` in `src/modules/profile/schema.ts`; D-044 point 4). Nothing is written: the check comes before the previous default is cleared. It follows steps 1 to 7, so an invalid body is `400` and a caller without a session `401` even at the cap. The same for every role.
- `404 NOT_FOUND`, default message, `details` `{}`: `PATCH` or `DELETE` of an address the caller does not own. Ownership is part of the statement (`WHERE id = :id AND "userId" = :actor`), so an id of another user and an id that does not exist get the same answer and nothing is changed (REQ-C-04). A second `DELETE` of the same address is also `404`.
- `400 VALIDATION_ERROR`: the rules below; and, on every body, an unknown key (`unrecognized_keys`, path `""`). Unknown keys include `id`, `userId`, `email`, `role`, `isActive`, `storeId`, and the timestamps: `PATCH /me` never changes the email, the role, or the active flag (REQ-C-03), and an address cannot be created for, or moved to, another user.

**Fields** (item 8.2-7 settled for these endpoints).

| Field | Rule |
| --- | --- |
| `name` (`PATCH /me`) | Trimmed, 1 to 100 characters, the display-name rule of sign-up (`NAME_ALLOWED_TEXT` in `src/modules/auth/schema.ts`: no control, format, bidirectional, line-separator, private-use, unassigned, or default-ignorable character except U+200B to U+200D and the emoji variation selectors; no blank look-alike U+2800 (braille pattern blank) or U+1D159 (musical symbol null notehead); at least one visible character; at most 3 combining marks or U+200B to U+200D in a row; no combining mark twice within one such run, adjacent or not (a Thai tone mark typed twice); no two Thai sara e U+0E40 in a row, also with U+200B to U+200D between them (drawn like sara ae U+0E41); SEC-033, SEC-037, SEC-039, SEC-041, SEC-042, SEC-060 under D-042 point 2. The same rule applies to every field that uses `NAME_ALLOWED_TEXT`: sign-up name, profile name, address fields, store name, and store description lines) |
| `phone` (`PATCH /me`, address) | A string of at most 32 characters. Surrounding white space, inner spaces, and hyphens are removed; what is left must be a Thai number: `0`, a digit 1 to 9, and 7 or 8 more digits (`021234567`, `0812345678`), or `+66`, a digit 1 to 9, and 7 or 8 more digits (`+66812345678`). ASCII digits only. **The stored and returned value is the form without separators**: `081-234-5678` is stored as `0812345678`. On `PATCH /me`, `null` clears the phone; on an address the phone is required and `null` is `400` |
| `recipientName` | Trimmed, 1 to 100 characters, the display-name rule |
| `line1` | Trimmed, 1 to 200 characters, the display-name rule (so no line break) |
| `subdistrict`, `district`, `province` | Trimmed, 1 to 100 characters each, the display-name rule |
| `postalCode` | Surrounding white space removed, then exactly five ASCII digits (REQ-C-04; the database check `Address_postalCode_check` is the backstop). Four or six digits, a letter, an inner space, Thai or full-width digits, and a JSON number are `400` |
| `isDefault` | Boolean. `POST`: optional, default `false`. `PATCH`: optional |
| `{id}` path parameter | An opaque id ([section 1.4](#14-identifiers-slugs-and-order-numbers)): 1 to 200 characters, no U+0000, no lone surrogate. Form only; whether it exists is the service's `404` |

`POST /me/addresses` requires every field except `isDefault`. `PATCH /me` and `PATCH /me/addresses/{id}` take any of their fields but **at least one**: an empty object is `400` with one field error at path `""`, code `custom`. A field that is not sent is not changed.

**Default address, as built.** Every address write is one transaction. A write that makes an address the default first locks the caller's `User` row (`SELECT ... FOR NO KEY UPDATE`), then sets the caller's other default to `false`, then writes. Two concurrent default switches of one user therefore run one after the other; both answer `200`, and the user ends with exactly one default, the one written last (DATA_MODEL.md section 6.2; code-review finding CR-22 a). `NO KEY UPDATE` does not wait for, or block, a foreign-key check that references the user elsewhere. A `PATCH` with `isDefault: false`, or without `isDefault`, takes no lock; every `POST` takes it (below).

**Address cap, as built** (D-044 point 4). A user holds at most 50 addresses. Every `POST /me/addresses` runs in one transaction that first locks the caller's `User` row (the same `FOR NO KEY UPDATE` as the default switch), then counts the caller's addresses (reading at most 50 ids), and refuses with `409 CONFLICT` `ADDRESS_LIMIT` when the count is 50 or more; only then is the previous default cleared (when `isDefault` is `true`) and the address inserted. Concurrent creates of one user therefore run one after the other and cannot pass the cap together. `PATCH` and `DELETE` are never refused for it, and a user who holds more than 50 (rows written before the cap) keeps them all and can create none until below 50. Checkout lists the first 50 addresses (D-044 point 4), which is every address a user can hold. No rate limit applies to these endpoints.

### 5.4 Cart

Login is required; there is no guest cart (REQUIREMENTS Q5). A guest gets `401 UNAUTHENTICATED` and nothing is stored.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/cart` | user | The caller's cart: lines grouped by store, live prices, flags, server-computed totals. An empty cart is an empty `stores` array, not an error. |
| POST | `/cart/items` | user | Body `{ productId, quantity }`. Adds to the existing line for that product, if there is one. |
| PATCH | `/cart/items/{itemId}` | user | Body `{ quantity }`. Own line only. Else 404. |
| DELETE | `/cart/items/{itemId}` | user | No body. Own line only. Else 404. |

Rules for the two writes:

- `quantity` is an integer from 1 to 99 (BR-03); anything else is `400 VALIDATION_ERROR`. Adding to an existing line so that its quantity would pass 99 is rejected the same way (field `quantity`) and the line is unchanged, because REQ-C-10 rejects any quantity outside 1 to 99.
- A `productId` that does not exist, or whose product is not visible, is `404 NOT_FOUND`; no line is created. A hidden product is answered exactly like a missing one. A product hard delete does not wait for the cart write and removes the product's lines with it, so a product deleted while a write runs is answered as missing too, never as `500`: `POST /cart/items` gives this `404` (`details.resource` `"product"`), and `PATCH /cart/items/{itemId}` on a line removed that way gives the line's `404` with `details` `{}`; nothing is stored (CR-T031-02).
- A product from the caller's own store is `409 PRODUCT_UNAVAILABLE` with one entry in `details.items` whose `reason` is `OWN_STORE` and whose `cartItemId` is `null`; no line is created (BR-16; finding S14). `cartItemId` is `null` on this add also when the caller already holds a line for that product (one added before the caller's store existed); that line is unchanged and is reported by `GET /cart` (CR-T031-03). On `POST /cart/items`, `requestedQuantity` in every refusal entry (`OWN_STORE`, `INSUFFICIENT_STOCK`) has one meaning, the same as in the success response below: the resulting quantity, that is the line's earlier quantity plus the quantity sent (CR-T031-04). On `PATCH` it is the quantity sent.
- **A line whose product is hidden refuses a quantity change** (BR-38; D-028). `PATCH /cart/items/{itemId}` on the caller's own line whose product is not visible ([section 3.4](#34-visibility-and-can-be-bought)) is `409 PRODUCT_UNAVAILABLE`, and the line is unchanged. `details.items` has one entry in the shape of [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought): `{ "cartItemId": the line id, "productId": "...", "reason": "NOT_AVAILABLE", "requestedQuantity": 2, "availableStock": null }`, where `requestedQuantity` is the quantity sent. The answer says no more than the cart read says about that line (`unbuyableReason: "NOT_AVAILABLE"`, below): not which condition hides the product, and not its stock or its price. It is the same answer when the hidden product also has no stock, so a hidden line is never answered as sold out. It is not `404`, because the line is the caller's own and the caller already sees it in the cart; `DELETE /cart/items/{itemId}` on it always succeeds. The `quantity` is validated first: a value outside 1 to 99 is `400` ([section 1.8](#18-access-levels-and-404-against-403)). `POST /cart/items` names a product, not a line, so for a hidden product it stays `404 NOT_FOUND` as above, also when the caller already has a line for that product; the line is unchanged.
- **A sold-out product is refused** (D-026, OQ-28; finding M11). Adding a visible product whose stock is 0, or setting the quantity of a line whose product is sold out, is `409 INSUFFICIENT_STOCK`; no line is created and an existing line is unchanged. `details.items` has one entry in the shape of [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought): `{ "cartItemId": null or the line id, "productId": "...", "reason": "INSUFFICIENT_STOCK", "requestedQuantity": 2, "availableStock": 0 }`. Sold out has two names on purpose, and nothing is renamed: a refusal says `reason: "INSUFFICIENT_STOCK"` with `availableStock: 0`, in the vocabulary of the checkout refusal, and the cart read says `unbuyableReason: "SOLD_OUT"`. A client treats the two as the same condition and shows the sold-out text for both.
- **More than is in stock is lowered, not refused** (D-026, OQ-28). When the resulting quantity of the line (the quantity sent, plus what the line already holds for an add) is above the product's stock and the stock is at least 1, the request **succeeds**, the line is stored with a quantity equal to the stock, and the response says so with `quantityLowered: true`.
- **A cart holds at most 50 distinct lines** (SEC-053; owner decision 2026-10-22; `MAX_CART_LINES` in `src/modules/cart/schema.ts`). `POST /cart/items` for a product the cart has no line for, when the cart already holds 50 lines (or more, see below), is `409 CONFLICT` with `details` exactly `{ "reason": "CART_LINE_LIMIT" }`; nothing is created or changed. It is checked last, after the `404`, `OWN_STORE`, `400`, and sold-out refusals above, inside the cart lock, so two concurrent adds of one user cannot both pass it. An add to a line the cart already has, a `PATCH`, and a `DELETE` are never refused for it, so a full cart can always be changed and emptied. A cart can hold more than 50 lines only when items of a failed payment come back to it ([section 5.5.4](#554-failed-payment); the return is not capped by line count); such a cart refuses every new line, and checkout refuses it ([section 5.5.5](#555-as-built-t-032-2026-10-14)) until the customer removes lines. The Thai text for this refusal is for product-requirements and frontend (`src/i18n/th.ts`).
- **An add sums the stored quantity, not the lowered one** (CR-T031-05). `GET /cart` lowers a line to the stock at read time only and stores nothing, so `POST /cart/items` adds the quantity sent to the quantity still stored. Example: stored 95, stock 2, `GET /cart` shows `quantity: 2` with `quantityLowered: true`; adding 5 asks for 100 and is `400 VALIDATION_ERROR` on `quantity`, and the line stays at 95. The 1 to 99 check comes before the stock (BR-31 (3)). A client that wants to change such a line sends `PATCH /cart/items/{itemId}` with the new quantity, which stores it. The Thai text for this case is for product-requirements and T-034.

Response of both writes: `201` when `POST /cart/items` created a line, `200` otherwise. `data` is the line in the shape of an item of `GET /cart` below, plus `requestedQuantity`:

```json
{
  "data": {
    "id": "...", "productId": "...", "slug": "...", "title": "...",
    "image": { "key": "...", "url": "..." },
    "unitPriceSatang": 25900, "quantity": 3, "lineTotalSatang": 77700,
    "stock": 3,
    "buyable": true, "unbuyableReason": null,
    "requestedQuantity": 5,
    "quantityLowered": true
  }
}
```

`requestedQuantity` is the resulting quantity the request asked for (5 here: for an add, the line's earlier quantity plus the quantity sent); `quantity` is what was stored. They are equal and `quantityLowered` is `false` when nothing was lowered. The Thai message shown to the customer is fixed by D-026 OQ-46 and lives in `src/i18n/th.ts`; `stock` is its `{available}` value.

`GET /cart`:

```json
{
  "data": {
    "stores": [
      {
        "store": { "name": "...", "slug": "...", "isSample": false },
        "items": [
          {
            "id": "...", "productId": "...", "slug": "...", "title": "...",
            "image": { "key": "...", "url": "..." },
            "unitPriceSatang": 25900, "quantity": 3, "lineTotalSatang": 77700,
            "stock": 3,
            "buyable": true, "unbuyableReason": null,
            "quantityLowered": true
          }
        ],
        "itemsSubtotalSatang": 77700,
        "shippingFeeSatang": 4000,
        "shippingFeeIsSimulated": true
      }
    ],
    "itemsSubtotalSatang": 77700,
    "shippingTotalSatang": 4000,
    "grandTotalSatang": 81700,
    "canCheckout": true
  }
}
```

- No price is stored in the cart; `unitPriceSatang` is the product's current price and every total is computed by the server (REQ-C-10).
- `shippingFeeSatang` is the current flat fee from the settings, once per store group; it is a **simulated flat rate** (BR-08). `shippingTotalSatang` is the fee multiplied by the number of store groups that have at least one buyable line.
- `buyable` is `false`, and the line **blocks checkout** (BR-22), in two cases, told apart by `unbuyableReason`: `"SOLD_OUT"` (the product is visible and its stock is 0) and `"NOT_AVAILABLE"` (the product is hidden: unpublished, archived, awaiting approval, rejected, taken down, its store suspended, its owner deactivated, or its category switched off; the response does not say which). `unbuyableReason` is `null` on a buyable line. The names differ from the `reason` values of a refused cart write or checkout on purpose ([section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought)), and a client maps them like this: `"SOLD_OUT"` here is `reason: "INSUFFICIENT_STOCK"` with `availableStock: 0` there; `"NOT_AVAILABLE"` is `reason: "NOT_AVAILABLE"` in both; and `INSUFFICIENT_STOCK` with an `availableStock` of 1 or more is not an unbuyable line at all but a lowered one (`quantityLowered`). For a `NOT_AVAILABLE` line `unitPriceSatang`, `lineTotalSatang`, and `stock` are `null`; the title stays so the customer can recognise the line and remove it.
- **A line that cannot be bought stays in the cart** (D-026, OQ-29, for a sold-out product; D-028, for a hidden one, which is treated the same way). It is returned with `buyable: false` and its `unbuyableReason`, is **not counted in any total**, cannot be bought, and stays until the customer removes it. Nothing removes it automatically, and it becomes buyable again by itself if the product comes back.
- `canCheckout` is `true` only when the cart has at least one line and every line is buyable.
- **Quantity above stock** (BR-30; D-026, OQ-30). When a line's stored quantity is above the product's stock and the stock is at least 1, the cart response carries the lowered quantity (equal to the stock), the totals use it, and `quantityLowered` is `true` so the customer is told on the cart page. A client is never shown a quantity above stock without `quantityLowered`.
- **`GET /cart` never stores anything** (D-029 point 1; SECURITY.md TM-16). The lowered quantity in a cart response is derived at read time from the stored quantity and the stock; the stored quantity is unchanged by the read, so `quantityLowered` stays `true` on every read until a mutation stores the lower value. The mutations that store it are `PATCH /cart/items/{itemId}`, `POST /cart/items` on that line, and `POST /checkout` ([section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought)).
- A product that nobody ever ordered and that its seller deletes disappears from carts without a message; accepted for the MVP (D-026, OQ-43).

### 5.5 Checkout and orders

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/checkout` | user | Header `Idempotency-Key` (required, [section 1.3](#13-the-idempotency-key-header)). Rate-limited. Details below. |
| GET | `/orders` | user | Paginated, newest first. The caller's own orders only. |
| GET | `/orders/{id}` | user | Owner only. Else 404. |
| POST | `/orders/{id}/items/{itemId}/review` | user | [Section 5.6](#56-reviews). |

There is **no** endpoint to pay, retry, cancel, or refund an order as a customer.

#### 5.5.1 Request

```json
{ "addressId": "...", "paymentMethod": "MOCK", "mockOutcome": "SUCCESS" }
```

- `addressId`: one of the caller's own addresses. Any other id is `404 NOT_FOUND` with `details.resource` `"address"`, and no order is created.
- `paymentMethod`: `"MOCK"` is the only value. It selects the provider and is recorded as `payment.provider`; it is not a separate stored field (finding M1). **This is a mock payment: no money moves.**
- `mockOutcome`: optional, `"SUCCESS"` (default) or `"FAIL"`. It exists only to exercise the failure path of the mock provider. The mock is the only provider (`getPaymentProvider` in `src/modules/payments/provider.ts`) and **it is refused when `NODE_ENV` is `production`** (SECURITY.md SEC-056; owner decision 2026-10-22): there, every `POST /checkout` that reaches the service is `500 INTERNAL_ERROR` with the fixed message and `details` `{}`, before anything is locked or written, so no order, no stock change, and no charge exist ([section 5.5.5](#555-as-built-t-032-2026-10-14)). No setting switches the mock back on in production. In development and test the mock is used and `mockOutcome` is accepted. Rejection of `mockOutcome` when a real provider is configured is Planned, with the real provider.
- Any other key, including any price, total, discount, fee, quantity, `storeId`, or `userId`, is an unknown key: `400 VALIDATION_ERROR`, and nothing is created or changed (D-031 point 3; [section 1.1](#11-transport)). A client amount is never used, and a request that carries one is refused, not accepted at the server's amounts. What is bought is the caller's cart as the server reads it.

**A checkout that succeeds is atomic** (CLAUDE.md rule 5; D-023). In one database transaction it locks the caller's cart, returns the existing order if the key was used before, refuses an empty cart, takes stock for every line with a statement that also requires the line to be buyable and returns the price charged, computes the totals from those prices and the current settings, refuses a total above the cap, writes the order with one seller order per store and the copies listed in [section 5.5.2](#552-response), and empties the cart. Either all of that is committed or none of it is: there is never an order without its stock taken, and never stock taken without an order. The payment is then completed in a second guarded transaction.

**A checkout that is refused promises an outcome, not a mechanism** (D-029 point 2; D-031 point 5). In every refusal no order exists, this request has left the stock unchanged, and nothing was charged. The cart is as it was, with one exception: a checkout refused because a quantity is above the stock stores the lowered quantity ([section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought)). How the server reaches that outcome, including how many transactions it uses, is not part of this contract and no client or test may rely on it; it is validated in T-013 and chosen in T-032 ([section 8.2](#82-open-technical), item 8.2-2).

The first four rows are in the order of [section 1.8](#18-access-levels-and-404-against-403). The rows after them are outcomes of the service and are not listed in the order in which they are evaluated.

| Case | Response |
| --- | --- |
| Guest | `401 UNAUTHENTICATED` |
| Over the rate limit | `429 RATE_LIMITED` |
| Missing or malformed `Idempotency-Key` | `400 VALIDATION_ERROR`, `invalid_header` |
| Invalid body | `400 VALIDATION_ERROR` |
| `addressId` not the caller's | `404 NOT_FOUND` |
| No cart, or no lines (finding M11). This is also what the second of two checkouts of one cart with different keys receives | `409 CART_EMPTY` |
| More than 50 lines in the cart (SEC-053) | `409 CONFLICT`, `details` `{ "reason": "CART_LINE_LIMIT" }`; no stock statement runs |
| `NODE_ENV=production` (the mock provider is refused, SEC-056) | `500 INTERNAL_ERROR`; nothing locked or written |
| A line cannot be bought (BR-22) | `409 PRODUCT_UNAVAILABLE` or `409 INSUFFICIENT_STOCK`, [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought) |
| Grand total above 2,000,000,000 satang (BR-04) | `422 ORDER_LIMIT_EXCEEDED` |

No status or code exists for an answer that asks the client to try the same checkout again, and none is needed: the mechanism chosen in T-032 never gives one (item 8.2-3 closed; [section 5.5.5](#555-as-built-t-032-2026-10-14)).

#### 5.5.2 Response

`201` when this request created the order; `200` when the idempotency key matched an order that already exists. The body is the order in both cases, **whatever its payment status**: a failed payment is not an error envelope ([section 5.5.4](#554-failed-payment)).

```json
{
  "data": {
    "id": "...",
    "orderNumber": "OD2610110000042",
    "createdAt": "2026-10-11T03:20:00.000Z",
    "paidAt": "2026-10-11T03:20:01.000Z",
    "paymentStatus": "PAID",
    "payment": { "provider": "MOCK", "isSimulated": true, "failureReason": null },
    "itemsSubtotalSatang": 77700,
    "shippingTotalSatang": 4000,
    "grandTotalSatang": 81700,
    "shippingAddress": {
      "recipientName": "...", "phone": "...", "line1": "...",
      "subdistrict": "...", "district": "...", "province": "...", "postalCode": "10110"
    },
    "sellerOrders": [
      {
        "id": "...",
        "storeName": "...",
        "storeSlug": "...",
        "fulfilmentStatus": "PENDING",
        "cancellationKind": null,
        "itemsSubtotalSatang": 77700,
        "shippingFeeSatang": 4000,
        "shippingFeeIsSimulated": true,
        "shipment": null,
        "items": [
          {
            "id": "...", "productId": "...",
            "productTitle": "...", "productSku": "...",
            "image": { "key": "...", "url": "..." },
            "unitPriceSatang": 25900, "quantity": 3, "lineTotalSatang": 77700,
            "review": null
          }
        ]
      }
    ]
  }
}
```

The same shape is the item of `GET /orders` and the body of `GET /orders/{id}`.

- **Copies taken at purchase** (BR-09). `productTitle`, `productSku`, `unitPriceSatang`, and `image` on an item; `shippingAddress` on the order; `storeName`, `shippingFeeSatang`, and the commission rate on a seller order. A later edit of the product, the address, the store name, or the settings never changes them. `storeName` is the store's name **as it was at purchase** (D-025, OQ-18); `storeSlug` is for linking only and never changes.
- **An order's picture cannot be deleted** (finding S7). `image` is the picture that was the product's primary one at purchase. Editing a product's pictures, or deleting or archiving the product, never removes that file: no endpoint deletes an upload, and the cleanup of [section 5.8](#58-uploads-and-files) cannot touch one an order item references. `image` is `null` only when the product had no picture at purchase.
- `payment.isSimulated` is derived from `payment.provider` (finding M1). `payment.failureReason` is `null` unless the payment failed; then it is one of exactly two codes: `SIMULATED_DECLINE` (the mock provider declined) and `TIMEOUT` (the order was still `PENDING` after the payment timeout, 15 minutes). **The list is closed** on the API side since T-032 (item 8.2-5): `PAYMENT_FAILURE_REASONS` in `src/modules/payments/provider.ts` is the only source of a written value, and a stored value outside it is answered as `null`. The column stays plain text; a check constraint is the database agent's choice. A client should still treat an unknown value as a failed payment with no specific reason, so that a later provider can add one.
- `paidAt` is the time the payment became `PAID` (BR-39; D-033 point 4, which answers item 8.1-1 for the customer's order). It is `null` while the payment is `PENDING` and for ever when it is `FAILED`; no other time stands in for it. It is set once, from the database clock, and never changes, also after a seller order is cancelled. `cartReturn` is `null` here and is described in [section 5.5.4](#554-failed-payment).
- `shippingTotalSatang` equals the flat fee multiplied by the number of seller orders (BR-08). `grandTotalSatang` is `itemsSubtotalSatang + shippingTotalSatang`.
- The commission rate is recorded on each seller order but is **not** in the customer's response; the seller's and the admin's views carry `commissionRateBps` ([section 5.7.3](#573-seller-orders)). Nothing is deducted from any amount (BR-13).
- `shipment` is `null` until the seller order is `SHIPPED`; then `{ "carrierName": "...", "trackingNumber": "...", "isSimulated": true, "shippedAt": "...", "deliveredAt": null }`, with `carrierName` and `trackingNumber` `null` when the seller entered none.
- `review` is the caller's review of that item, `{ "id", "rating", "comment", "createdAt" }`, or `null`.
- `paymentStatus` in a checkout response is normally `PAID` or `FAILED`. It is `PENDING` only when the provider did not answer, or when the provider answered but its outcome could not be recorded after the order was placed (the payment transaction failed, for example on a lock timeout). In both cases the order exists and the answer is still `201` with the order, never `500` (SEC-055; [section 5.5.5](#555-as-built-t-032-2026-10-14)); a repeat with the same key then returns the same order and does not charge again. An order still `PENDING` 15 minutes after it was created is failed (D-028; D-023 point 6).

#### 5.5.3 Checkout refused because a line cannot be bought

No partial purchase (BR-22; D-025, OQ-09; finding S4). If **any** line of the cart cannot be bought, the whole checkout is refused, also when only one line of several is affected and when it belongs to a different store from the others. The response names **every** such line:

```json
{
  "error": {
    "code": "PRODUCT_UNAVAILABLE",
    "message": "One or more items can no longer be purchased.",
    "details": {
      "items": [
        { "cartItemId": "...", "productId": "...", "reason": "NOT_AVAILABLE", "requestedQuantity": 1, "availableStock": null },
        { "cartItemId": "...", "productId": "...", "reason": "INSUFFICIENT_STOCK", "requestedQuantity": 5, "availableStock": 3 }
      ],
      "totals": { "itemsSubtotalSatang": 77700, "shippingTotalSatang": 4000, "grandTotalSatang": 81700 }
    },
    "requestId": "..."
  }
}
```

| `reason` | Meaning | `availableStock` |
| --- | --- | --- |
| `NOT_AVAILABLE` | The product is not visible ([section 3.4](#34-visibility-and-can-be-bought)). The response does not say which condition failed | `null` |
| `INSUFFICIENT_STOCK` | Visible, but its stock is below the line's quantity; 0 when sold out. With `availableStock: 0` this is the condition the cart read calls `unbuyableReason: "SOLD_OUT"` ([section 5.4](#54-cart)); the two names are deliberate and a client treats them as the same | the current stock |
| `OWN_STORE` | The product belongs to the caller's own store (BR-16) | `null` |

The `code` is `INSUFFICIENT_STOCK` when every listed line has the reason `INSUFFICIENT_STOCK`, and `PRODUCT_UNAVAILABLE` otherwise. Both are `409` and both carry the same `details.items`. This settles the shape of `details.items` that the earlier version left open.

**Checkout stops so the customer confirms again** (D-026, OQ-30; D-029 point 2). When a line's quantity is found to be above the stock at the moment the order is placed, the order is **not** placed with a lowered quantity. The checkout is refused as above: no order is created, the stock is left unchanged, and nothing is charged. It does one thing: **for every `INSUFFICIENT_STOCK` line whose `availableStock` is at least 1, the refused request itself stores that lower quantity on the cart line.** This is the only state a refused checkout changes; lines that cannot be bought at all (sold out, `NOT_AVAILABLE`, `OWN_STORE`) are left as they are. By the time the refusal is sent, the lowered quantities are stored.

That is the whole promise, and it is an outcome (D-029 point 2). **The mechanism is not part of this contract** (D-031 point 5): whether the server validates before it takes stock, uses a savepoint, or runs an attempt and then a separate refusal transaction (DATA_MODEL.md section 7.1) was validated in T-013, and T-032 chose the savepoint ([section 5.5.5](#555-as-built-t-032-2026-10-14)). No client or test may rely on it; the outcome above holds and a checkout that succeeds stays atomic ([section 5.5.1](#551-request)).

The refusal carries what the customer must see before confirming:

- for each such line, `requestedQuantity` is what the line held and `availableStock` is the **new quantity** now stored on it (0 means sold out: nothing was stored and the line must be removed);
- `details.totals` is the **new total**: exactly what `GET /cart` returns after this request, with the lowered quantities and with every line that cannot be bought left out. It is information for the confirmation screen, not a price the client sends back.

**To confirm, the customer submits checkout again**: the client shows the new quantities and total and, on the customer's action, sends `POST /checkout` once more. No `PATCH` is needed for a lowered line, because the refused request already stored it. Lines that cannot be bought at all still block checkout (BR-22) and must be removed with `DELETE /cart/items/{itemId}` first. The server computes the charge afresh; if stock moved again in between, the checkout is refused again in the same way.

**The `Idempotency-Key` across the refused and the confirming request.** A refused checkout creates no order, so its key is not recorded anywhere: a key is only ever tied to an order.

- The confirming request is a new customer decision and **should carry a new key**. The server also accepts the old one, because it cannot tell them apart.
- A repeat of the refused request with the same key is therefore **not** answered with the same refusal: it is a fresh checkout of the cart as it now is, and it can succeed with the quantities the first attempt lowered.
- For that reason a client **must not resend a checkout automatically** after a `409`, and must treat a checkout whose response was lost as unknown: it reads `GET /cart` first. An empty cart means the order was placed, and resending with the same key returns it. A cart with `quantityLowered` lines or changed totals means the attempt was refused, and the customer must be shown the cart before anything is sent again.
- `OPEN (technical)`, item 8.2-1 of [section 8.2](#82-open-technical), for backend-api and security to rule on before T-032 starts (D-031 point 6): nothing on the server distinguishes a blind resend of a refused checkout from the customer's confirmation, so the rule above is kept by the client only, and a client that breaks it can place an order for a quantity the customer has not seen. A guard on the server would need something stored (the refusal itself, a revision of the cart, or a confirmation value the client sends back), which is an additive migration and a contract change. **No outcome is decided**: neither whether there will be a guard, nor what a blind resend would then be answered with. Until the ruling, the three bullets above describe what the server does.

#### 5.5.4 Failed payment

Finding M11 asked for this shape; finding B5 for what happens to the seller orders. Source: BR-20, D-025 OQ-07, D-026 OQ-25 to OQ-27, DATA_MODEL.md section 7.2.

When the mock provider declines (`mockOutcome: "FAIL"`, **a simulated failure**), the order **exists** and the response is the order, `201`, with these values:

```json
{
  "data": {
    "id": "...",
    "orderNumber": "OD2610110000043",
    "paymentStatus": "FAILED",
    "payment": { "provider": "MOCK", "isSimulated": true, "failureReason": "SIMULATED_DECLINE" },
    "sellerOrders": [
      { "id": "...", "fulfilmentStatus": "CANCELLED", "cancellationKind": "PAYMENT_FAILED", "shipment": null }
    ],
    "cartReturn": {
      "capped": true,
      "items": [
        { "productId": "...", "orderedQuantity": 3, "cartQuantity": 4, "capped": true }
      ]
    }
  }
}
```

(Fields not shown are as in [section 5.5.2](#552-response).) A client must read `paymentStatus`; a `201` alone does not mean the order was paid.

**`cartReturn`** tells the customer how the items came back (D-026, OQ-26). One entry per returned item: `orderedQuantity` is what the failed order held, `cartQuantity` is the quantity of that product's cart line afterwards, and `capped` is `true` when the line ended lower than the line's earlier quantity plus `orderedQuantity`. The top-level `capped` is `true` when any entry is.

- When the cart already has a line for the same product, the quantities are **added together, capped at 99 and at the available stock** (the stock after the order's stock was restored).
- An item of a store's part that was **already cancelled before the payment failed does not return to the cart** and has no entry (D-028; it narrows BR-20's "every item"). Only the parts not already cancelled return.
- `cartReturn` is read from what the failure stored on each order item (DATA_MODEL.md section 6.12: `cartQuantityBeforeReturn`, `cartQuantityAfterReturn`), so it is **the same in every response that carries this failed order**: the checkout request during which the payment failed, a repeat with the same key, `GET /orders`, `GET /orders/{id}`, and the admin's views, and also after a timeout failure. `cartQuantity` is the line's quantity just after the return, not the cart's current quantity. `cartReturn` is `null` on an order whose payment did not fail.
- The cart read does not carry this notice. No later notice is required (D-028): after a timeout failure it is enough that the cart shows the quantity it really holds; a client that wants to explain it reads `cartReturn` from the failed order.

What has happened by the time the response is sent, in one transaction:

1. The order is `FAILED`, permanently. No request pays, retries, or reopens it.
2. Every seller order of it is `CANCELLED` by the system, so none is left in a state anyone can act on.
3. Stock is restored for its items, once.
4. The items are back in the customer's cart. The customer buys them by checking out again with a **new** `Idempotency-Key`, which creates a new order.

Repeating the request with the **same** key returns this same failed order with `200`, creates nothing, and does not call the provider again.

Who sees a failed order:

- **Sellers never do** (BR-20): its seller orders are in no seller list, a seller's request for one by id is `404 NOT_FOUND`, and they count in no seller figure.
- **The customer and the admin do** (D-026, OQ-25). The failed order stays in `GET /orders` and `GET /orders/{id}` for the customer and in the admin's order endpoints, marked as payment failed: `paymentStatus: "FAILED"`, and each of its seller orders `CANCELLED` with `cancellationKind: "PAYMENT_FAILED"`. No further action is possible on it for anyone.

**Timeout** (D-026, OQ-27; D-028). An order that fails because the payment provider never answered, which happens once it has been `PENDING` for 15 minutes, returns its items to the cart in exactly the same way, with the same merge and caps. That failure does not happen inside a checkout request: the customer sees it on the next read of the order (`paymentStatus: "FAILED"`, `failureReason: "TIMEOUT"`) and of the cart.

**Texts.** The Thai wording is fixed by D-028 and D-026 OQ-46 and lives only in `src/i18n/th.ts`. The API carries the facts that select a text, never the text:

| Text (see D-028, D-026) | Selected by |
| --- | --- |
| Mark on an order whose payment failed | `paymentStatus: "FAILED"` |
| Adding a sold-out product was refused | `409 INSUFFICIENT_STOCK` from a cart write ([section 5.4](#54-cart)) |
| A returned quantity was cut | `cartReturn.items[].capped`; `{quantity}` is that entry's `cartQuantity` |
| A quantity was lowered to the stock | `quantityLowered` on a cart line or cart write; `{available}` is `stock` |

#### 5.5.5 As built (T-032, 2026-10-14)

Code: `src/modules/checkout/` (schema, pricing, repository, service), `src/modules/orders/` (state tables, order shape, the two payment transactions, the timeout sweep), `src/modules/payments/` (the mock provider), and the handlers `src/app/api/v1/checkout/route.ts`, `src/app/api/v1/orders/route.ts`, `src/app/api/v1/orders/[id]/route.ts`. The Zod schemas and types in `src/modules/checkout/schema.ts` and `src/modules/orders/schema.ts` are authoritative. Unit and route tests cover these endpoints, and `tests/integration/checkout/` plus `tests/security/t032-sec055-recheck.itest.ts` ran against real PostgreSQL (2026-10-14: 32 passed, then 34 passed with the re-check file; agent and orchestrator reports in STATUS.md). The concurrency race tests are T-033 and have not run.

- **Order of checks of `POST /checkout`** ([section 1.8](#18-access-levels-and-404-against-403)): `Origin` (403), `Content-Type` (415), the session (401), the `checkout` rate limit on the session's user id (429 with `Retry-After`, before the body is read; a refusal is written as a throttled security event, SR-04), the body (413), the `Idempotency-Key` header (400 `invalid_header`), the body's schema (400), then the service. Access `user`: every role may check out.
- **Order of the service's outcomes.** First, before any transaction, the payment provider is resolved: with `NODE_ENV=production` the mock is refused (`MockPaymentProviderInProductionError`, answered `500 INTERNAL_ERROR`; the log line names the class only), so nothing is locked or written, and a repeat with a used key is refused the same way (SEC-056, owner decision 2026-10-22). Then, all inside the cart lock: an order with this key (200, nothing else is looked at); the address (404 `resource: "address"`); no cart or no line (409 `CART_EMPTY`); more than 50 lines (409 `CONFLICT` `CART_LINE_LIMIT`, before the savepoint and the first stock statement, so no `Product` row is locked; SEC-053, owner decision 2026-10-22); a line that cannot be bought (409, [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought)); the total above BR-04 (422). A repeat with a used key is therefore answered with its order even when the address has since been deleted or the cart has since grown above 50 lines.
- **Mechanism of a refused checkout (item 8.2-2 closed): the savepoint** of DATA_MODEL.md section 21.6. One transaction holds the cart lock throughout. The stock statements run inside `SAVEPOINT checkout_attempt`; when one affects no row, the transaction rolls back to the savepoint (no decrement survives), reads every line's state, stores the lowered quantities with the guarded lowering statement, reads every line again, commits, and the refusal is answered. The answer is built from the read after the lowering (CR-T032-07): a line the lowering changed is always listed, with `availableStock` equal to the quantity it stored, even when stock moved between the first read and the lowering; `details.totals` is computed from the lines as stored. The rollback also releases the savepoint, so every attempt sets a fresh one (CR-T032-05). If a read finds every line buyable after all and nothing was lowered (stock or a status changed in between), the stock is tried again, at most 3 times in one request; a request that still cannot settle is `500 INTERNAL_ERROR` with nothing stored. **No "try again" answer exists** (item 8.2-3 closed). The savepoint relies on Prisma 7.10 behaviour that Prisma does not document; a Prisma upgrade must repeat the T-013 check.
- **Own-store lines.** A cart line of the caller's own store (one added before the store existed; `GET /cart` shows it as buyable) refuses the checkout with `reason: "OWN_STORE"`: the stock statement itself carries `s."ownerId" <> :buyer` (BR-16).
- **Totals above 32 bits.** The totals are computed in exact integers before anything is written; a grand total above 2,000,000,000 satang is `422` and rolls back the stock taken, so no 32-bit column ever receives a larger value (T-031 security review).
- **Payment.** After the order commits, the mock provider is asked; `PAID` is written by a guarded transaction that also sets `paidAt` from the database clock and the reference `MOCK-<uuid>` on the payment row; a decline runs the failure transaction of [section 5.5.4](#554-failed-payment) (DATA_MODEL.md section 7.2, every step). The decline reason written is the one the provider reported (CR-T032-04). If the provider throws, the order is answered `PENDING` and one warn line is written. **If the provider answered but the guarded payment transaction then fails** (a lock timeout, a lost connection; SEC-055 item 2, CR-T032-03), that transaction is rolled back, one error line is written with the error's class only, and the request still answers `201` with the order as the database holds it, normally `PENDING`. Either way the timeout sweep fails the order later (reason `TIMEOUT`, items back in the cart). Only a failure of the final read of the order is still `500`; the order exists and a repeat with the same key returns it. A guarded transaction that loses to another path (the sweep, or a repeat) changes nothing.
- **Transaction limits.** Checkout's interactive transaction waits at most 5 s for a connection and runs at most 15 s (`CHECKOUT_TRANSACTION_OPTIONS`); past that it is rolled back and answered `500`. The two payment transactions wait at most 5 s for a connection and run at most 20 s (`PAYMENT_TRANSACTION_OPTIONS`, CR-T032-02), so a decline that waits for the cart lock of a concurrent checkout of the same user outlasts it (DATA_MODEL.md section 21.5). Not measured under load yet (T-033).
- **Lock order.** Checkout takes `Product` rows in the byte order of the product id (`COLLATE "C"`), and the failure transaction restores stock in the same order, whatever the database's default collation (CR-T032-06). The primary picture of every product is read in one statement, and the number of stock statements of one checkout is bounded by the 50-line cart limit (CR-T032-12, closed 2026-10-22 with SEC-053): at most 50 `Product` rows are locked per attempt. The stock statements are still one per line, awaited one after the other inside the savepoint.
- **Timeout sweep.** `failOverdueOrders(timeoutMinutes)` and `startPaymentTimeoutSweepSchedule` exist in `src/modules/orders/`; the schedule runs once a minute, at most 100 orders per run, judging age by the database clock. An order whose failure transaction throws is counted (`errored`), logged with the error's class and code only, and skipped; the run goes on with the next order, and the skipped order is tried again by the next run (CR-T032-01). **It is started by the start-up hook** `src/instrumentation.ts` (commit `35903a1`) with `PAYMENT_TIMEOUT_MINUTES`: in the Node.js runtime of a running server only, not during `next build`, not with `NODE_ENV=test`. Not yet observed on a deployment (see DEPLOYMENT.md "Scheduled work"). In any process where the hook does not run it, an unpaid order stays `PENDING` (DATA_MODEL.md section 19.5).
- **`GET /orders`** is ordered by `createdAt` descending, then `id` descending; `pageSize` 1 to 50, default 20. **`GET /orders/{id}`**: an id of 1 to 200 characters without U+0000 or a lone surrogate, else 400; another user's order is 404 with `details` `{}`.
- **Not built, on purpose:** a server guard against the blind resend of a refused checkout (item 8.2-1, still not ruled; the three client rules of [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought) describe what the server does); any change to the `checkout` rule's capacity (SEC-052, owner decision open); a line cap on the items a failed payment returns to the cart ([section 5.4](#54-cart): such a cart can pass 50 lines and is then refused by checkout until lines are removed).
- **Tests of the 2026-10-22 changes** (backend-api): unit `src/modules/cart/service.test.ts`, `src/modules/cart/repository.test.ts`, `src/modules/checkout/service.test.ts`, `src/modules/payments/provider.test.ts`; integration against real PostgreSQL `tests/integration/cart/line-limit.test.ts` and `tests/integration/checkout/sec053-sec056.test.ts`.

### 5.6 Reviews

`POST /orders/{id}/items/{itemId}/review`, access `user`, rate-limited. Body `{ "rating": 1..5 (integer), "comment"?: string }`. Response `201` with the review.

| Case | Response |
| --- | --- |
| `rating` outside 1 to 5, or not an integer | `400 VALIDATION_ERROR` |
| The order is not the caller's, or the item is not in that order | `404 NOT_FOUND` |
| The item's seller order is not `DELIVERED` (BR-11) | `409 CONFLICT`, reason `NOT_DELIVERED` |
| The item already has a review | `409 CONFLICT`, reason `DUPLICATE_REVIEW` |

The product and the reviewer are taken from the order item and the session, never from the request. `comment` is stored as plain text and returned unchanged; it is never interpreted as markup. There is no edit or delete endpoint.

### 5.7 Seller

#### 5.7.1 Application and store

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/seller/application` | customer-role | Body `{ storeName, description, contactPhone }`. Rate-limited. A `SELLER` already owns a store and an `ADMIN` cannot become a seller: both get `403 FORBIDDEN` (BR-06). A second application while one is `PENDING`: `409 CONFLICT`, reason `OPEN_APPLICATION`. A rejected applicant may apply again (a new application). A `storeName` that is reserved or that an existing store already has: `409 CONFLICT`, reason `STORE_NAME_RESERVED` or `STORE_NAME_TAKEN` ([section 5.7.1.1](#5711-as-built-t-040-2026-10-14), "Store names"). |
| GET | `/seller/application` | user | The caller's latest application: `{ id, storeName, description, contactPhone, status, reviewNote, reviewedAt, createdAt }`. `reviewNote` is the rejection reason. Never applied: `404 NOT_FOUND`. |
| GET | `/seller/store` | seller (any store status) | Own store: `{ id, name, slug, description, logo, contactPhone, status, statusReason, isSample }`. `statusReason` is the reason of the last suspension or reinstatement. |
| PATCH | `/seller/store` | seller | Body: any of `name`, `description`, `contactPhone`, `logoKey` (a storage key of the caller's store, or `null` to remove the logo; [section 5.8](#58-uploads-and-files)). A seller may change the contact phone, and no change here needs approval (D-028). The slug does not change on a rename. Existing orders keep the old name ([section 5.5.2](#552-response)). A `name` that is reserved or that another store already has: `409 CONFLICT`, reason `STORE_NAME_RESERVED` or `STORE_NAME_TAKEN`, nothing changes. Every rename is recorded in `AuditLog` (D-041 point 2). |
| GET | `/seller/summary` | seller (any store status) | [Section 5.7.4](#574-dashboard-summary). |

"`seller (any status)`" in the earlier version described users whose role was still `CUSTOMER` (finding B3). The two application endpoints are what such a user has; everything else under `/seller` needs role `SELLER`.

##### 5.7.1.1 As built (T-040, 2026-10-14)

Implemented: `POST` and `GET /seller/application`, `GET` and `PATCH /seller/store`, in `src/modules/sellers` (schema, state tables, slug generator, repository, service) and the handlers `src/app/api/v1/seller/application/route.ts` and `src/app/api/v1/seller/store/route.ts`. The schemas and types in `src/modules/sellers/schema.ts` are authoritative. `GET /seller/summary` is built by T-043 in the orders module ([section 5.7.3.1](#5731-as-built-t-043-2026-10-20)). Unit tests, route tests, and `tests/integration/sellers/` (against PostgreSQL) cover these endpoints. Security-reviewed: [reviews/T-040-security.md](reviews/T-040-security.md) (2026-10-15; no Critical, High, or Medium finding; SEC-058 raised), SEC-058 re-checked after [D-041](DECISIONS.md) in [reviews/SEC-058-recheck.md](reviews/SEC-058-recheck.md), SEC-059 and SEC-060 re-checked after [D-042](DECISIONS.md) in [reviews/SEC-059-060-recheck.md](reviews/SEC-059-060-recheck.md). Open findings on store names are in [SECURITY.md](SECURITY.md). Both routes are on the route list guard in `tests/security/t020-t018-catalog-shell.test.ts`.

**Order of checks** ([section 1.8](#18-access-levels-and-404-against-403)); every response is `Cache-Control: no-store`; a `userId`, `storeId`, or `id` in the query is ignored.

| Endpoint | Access | Steps |
| --- | --- | --- |
| `POST /seller/application` | customer-role | 1 `Origin` (403), 2 `Content-Type` (415), 3 session (401), 4 role `CUSTOMER` (403 `FORBIDDEN` for a seller of any store status and for an admin), 5 `seller-application` on the session's user id (429 with `Retry-After`; a refusal is a throttled security event, SR-04), 6 body (413), 7 schema (400), then the service (409) |
| `GET /seller/application` | user | 3 session (401), then the service (404) |
| `GET /seller/store` | seller (any store status) | 3 session (401), 4 role `SELLER` (403 `FORBIDDEN` for a customer, a pending or rejected applicant included, and for an admin), then the service |
| `PATCH /seller/store` | seller | 1, 2, 3, 4 role `SELLER` then store `APPROVED` (403 `FORBIDDEN`, or 403 `SELLER_NOT_APPROVED` for a suspended store, before the body is read), 6, 7, then the service (403 `SELLER_NOT_APPROVED` again, 404 `upload`). No rate limit |

**Responses.**

| Endpoint | Success | Refusals beyond the steps |
| --- | --- | --- |
| `POST /seller/application` | `201`, the application shape | `409 CONFLICT` reason `OPEN_APPLICATION` when a `PENDING` application exists (also when two submissions race: one `201`, the other `409`); nothing is created. Then `409 CONFLICT` reason `STORE_NAME_RESERVED` or `STORE_NAME_TAKEN` (see "Store names" below); nothing is created. A role that changed after the session was read is `403 FORBIDDEN` |
| `GET /seller/application` | `200`, the caller's latest application (latest `createdAt`, then highest `id`), whatever the caller's role | `404 NOT_FOUND`, `details` `{}`, when the caller never applied |
| `GET /seller/store` | `200`, the store shape | `404` only for a seller without a store row, which the data model does not allow |
| `PATCH /seller/store` | `200`, the store shape after the change | `409 CONFLICT` reason `STORE_NAME_RESERVED` or `STORE_NAME_TAKEN` for a new `name` (see "Store names" below); nothing of the request changes, the other fields sent with it included. `404 NOT_FOUND` with `details.resource` `"upload"` for a `logoKey` that is not an upload of the caller's store (unknown and another store's key give the identical answer; nothing changes) |

Shapes, exactly these keys:

- Application: `{ id, storeName, description, contactPhone, status, reviewNote, reviewedAt, createdAt }`. `reviewNote` is the rejection reason, and `null` unless `status` is `REJECTED`. `reviewedAt` is `null` while `PENDING`. TypeScript type `SellerApplicationDto`.
- Store: `{ id, name, slug, description, logo, contactPhone, status, statusReason, isSample }`. `logo` is `{ key, url }` or `null` (section 4; the file URL is served since T-041, section 5.8.1). No owner id and no upload id. TypeScript type `SellerStoreDto`.

**Fields** (item 8.2-7 settled for these endpoints).

| Field | Rule |
| --- | --- |
| `storeName` (application), `name` (store) | Trimmed, 1 to 100 characters, the display-name rule of [section 5.3.1](#531-as-built-t-030-backend-2026-10-13) (`NAME_ALLOWED_TEXT`; no line break) |
| `description` | Multi-line text, 1 to 2000 characters after normalisation: CR LF and a lone CR become LF, trailing white space of every line and surrounding white space of the whole text are removed, and every line that is not empty must satisfy `NAME_ALLOWED_TEXT`. LF is therefore the only control character that can be stored; a tab, U+2028, U+2029, bidirectional controls, and invisible characters are `400` on any line. Required on the application; on `PATCH /seller/store`, `null` clears it |
| `contactPhone` | The phone rule of section 5.3.1; stored without separators. Required on the application; not nullable |
| `logoKey` | A string of 1 to 200 characters without U+0000 or a lone surrogate, or `null` to remove the logo (the upload stays). The key pattern of generated keys is T-041's (section 5.8.1, provisional with item 8.2-8); this field does not apply it, and a key that is not an upload of the caller's store is `404 upload` either way |

`PATCH /seller/store` takes any of `name`, `description`, `contactPhone`, `logoKey`, **at least one** (an empty object is `400`, path `""`, code `custom`). A field that is not sent is not changed. Every other key, `slug`, `status`, `statusReason`, `storeId`, `ownerId`, `logoUploadId`, and `isSample` included, is `400 unrecognized_keys`. The slug never changes on a rename.

**Mechanism.** Submitting runs one transaction: the user row is locked (`FOR NO KEY UPDATE`) and its role and store are read again, then the open application is looked for, then the row is inserted; the partial unique index `SellerApplication_userId_pending_key` is the backstop (its violation is the same `409`). A store write runs one transaction: the store row is locked with its owner in the `WHERE`, its status is judged (`SELLER_NOT_APPROVED` before the upload is looked up), the upload is resolved by key **and** store, and the update carries `status = 'APPROVED'` itself (DATA_MODEL.md section 7.7).

**Approval of a deactivated applicant** (D-040 point 1, 2026-10-14). The admin approval ([section 5.9.2](#592-applications-and-stores)) refuses an application whose applicant has `isActive = false` with `409 CONFLICT`, reason `APPLICANT_INACTIVE` (a new reason under the existing `CONFLICT` code, section 2.3; no error code fitted better: the refusal is a conflict with the applicant's current data, like `APPLICANT_NOT_CUSTOMER`). Nothing is created, the role does not change, no audit row is written, and the application stays `PENDING` so an admin can reject it. The applicant's user row is locked inside the approval transaction, so a deactivation that commits first is seen.

**Store names** (SEC-058, D-041, 2026-10-15). Two new reasons under the existing `CONFLICT` code (section 2.3), on `POST /seller/application`, `PATCH /seller/store`, and the admin approval (section 5.9.2):

- `STORE_NAME_TAKEN`: the name has the same **key** as an existing store's name. The key is computed by the database (`store_name_key`, DATA_MODEL.md section 21.7): NFKC, full case folding, invisible characters removed, runs of white space made one space, trimmed. So `Sunrise Mart`, `  SUNRISE   mart `, and the full-width form are one name. Punctuation and look-alike letters of other scripts are not folded (accepted residual risk, D-041 point 1). Pending applications are not compared with each other; when two hold one name, the second approval is refused.
- `STORE_NAME_RESERVED`: the name's key, with punctuation and symbols (`\p{P}`, `\p{S}`) removed, contains the same text of an entry of `RESERVED_STORE_NAMES` (`src/modules/sellers/store-name.ts`, exported from `@/modules/sellers`): the marketplace's own name (`th.site.name`), `admin`, `administrator`, `official`, `support`, `ผู้ดูแลระบบ`, `แอดมิน`, `ทางการ`, `ร้านค้าทางการ`. **Contained match** (SEC-059, D-042 point 1): a name is refused when the entry appears anywhere in it, so `Admin.`, `A.d.m.i.n`, `<site name> Official`, `Official Support`, `Official Goods Thailand`, and `ร้านแอดมินขายดี` are all `409`. It is a substring match, not a word match (Thai has no spaces between words), so names that hold an entry by accident are refused too, for example `Badminton Pro`, `Unofficial Fan Shop`, and `ผลผลิตทางการเกษตร`; the owner accepted this and may trim the list. White space is kept: a one-word entry does not match across a space (`Pad Mint` is accepted, `Pad.Mint` is not); an entry that holds a space is compared with spaces removed on both sides. The owner may extend or trim the list (D-041 point 3, D-042 point 1).
- Order: on the application, after `OPEN_APPLICATION`; `STORE_NAME_RESERVED` is judged before `STORE_NAME_TAKEN`. On `PATCH /seller/store`, after the store-status refusal and only when `name` differs from the current name; a name sent unchanged is never refused.
- Mechanism: the application compares the key in a `SELECT` inside its transaction (a store approved after that is caught at approval). Approval and rename are refused by the unique index `Store_nameKey_key`; the error is never logged with its details and the response carries only the reason. A refused approval writes nothing and leaves the application `PENDING`, so an admin can reject it. A rename that sends `name` locks the store row `FOR UPDATE`.
- **Rename audit** (D-041 point 2). A `PATCH /seller/store` whose `name` differs from the current name, character for character (a change of case only counts), writes one `AuditLog` row in the same transaction: `actorId` the seller, action `SELLER_STORE_RENAMED`, target type `Store`, target id the store id, `metadata` `{ before: { name }, after: { name } }`; `createdAt` is the time. A refused change writes no row. T-050 shows the history to admins.
- No rate limit on renames (D-041 point 4; section 6 unchanged).

**For later tasks** (not endpoints): `requireApprovedStoreForWrite(tx, actor)` in `@/modules/sellers`, called first inside the transaction of a seller write (T-041 uploads, T-042 products and stock), refuses a caller who is not a seller with an `APPROVED` store and takes a share lock on the store row while it is `APPROVED` and owned by the actor, so a suspension waits until that write commits (step 8 of section 1.8). The lock is `FOR SHARE`: the caller must not update or delete that `Store` row later in the same transaction, because two such transactions on one store deadlock and one fails with `500` (CR-T040-04). Writes to tables that only reference the store are safe. A seller write that updates the `Store` row itself calls `requireApprovedStoreForStoreRowWrite(tx, actor, { changesUniqueKey })` instead (CR-T040-06, 2026-10-19): the same refusals, with the row locked `FOR NO KEY UPDATE`, or `FOR UPDATE` when the write changes `name` (and so the unique `nameKey`), so two such writers queue instead of deadlocking. `PATCH /seller/store` predates it and takes the same two locks itself. `generateSlug(text)` is the slug generator of DATA_MODEL.md section 9 for products.

#### 5.7.2 Products

Every query is scoped by the store that belongs to the session. Another store's product id: 404 on every endpoint below.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/seller/products` | seller (any store status) | Paginated. Own products. Filters: `status`, `moderationStatus`, `lowStock=true`, `soldOut=true`. |
| POST | `/seller/products` | seller | Creates with `status: "DRAFT"` and `moderationStatus: "PENDING"`. |
| GET | `/seller/products/{id}` | seller (any store status) | Else 404. |
| PATCH | `/seller/products/{id}` | seller | Else 404. Not allowed on an `ARCHIVED` product: `409 INVALID_STATE_TRANSITION`. |
| POST | `/seller/products/{id}/publish` | seller | No body. `DRAFT` to `PUBLISHED`. Else 404. |
| POST | `/seller/products/{id}/unpublish` | seller | No body. `PUBLISHED` to `DRAFT`. Else 404. |
| POST | `/seller/products/{id}/archive` | seller | No body. `DRAFT` or `PUBLISHED` to `ARCHIVED`; final. Else 404. |
| DELETE | `/seller/products/{id}` | seller | No body. Else 404. Deletes the product when no order references it; **archives it instead** when one does (BR-12). Response `200` with `{ "outcome": "DELETED" }` or `{ "outcome": "ARCHIVED" }`. Never removes a file an order uses. |
| PATCH | `/seller/products/{id}/stock` | seller | Body `{ "set": n }` **or** `{ "adjust": n }`, exactly one. Else 404. |

Create body: `title`, `description`, `sku`, `categoryId`, `priceSatang` (integer, 100 to 100,000,000), `stock` (integer, 0 to 1,000,000; D-026, OQ-40), `imageKeys` (optional array of at most 8 storage keys of the caller's store, in display order). Edit body: any of `title`, `description`, `sku`, `categoryId`, `priceSatang`, `imageKeys`; stock is changed only through the stock endpoint. `status`, `moderationStatus`, `moderationNote`, `contentRevision`, `slug`, `storeId`, and `isSample` are unknown keys.

Product as its seller sees it:

```json
{
  "data": {
    "id": "...", "slug": "...", "title": "...", "description": "...", "sku": "...",
    "category": { "id": "...", "name": "...", "isActive": true },
    "priceSatang": 25900, "stock": 4, "lowStock": false, "soldOut": false,
    "status": "PUBLISHED",
    "moderationStatus": "TAKEN_DOWN",
    "moderationNote": "...",
    "images": [{ "key": "...", "url": "..." }],
    "isSample": false,
    "createdAt": "...", "updatedAt": "..."
  }
}
```

- A product is on the storefront only when `status` is `PUBLISHED` **and** `moderationStatus` is `APPROVED` and the other conditions of [section 3.4](#34-visibility-and-can-be-bought) hold. Publishing a product that is not approved is allowed and does not make it visible.
- Editing, moderation, and resubmission follow [section 3.3](#33-product-status-and-moderation). The response of every write carries the resulting `moderationStatus`.
- A SKU must be unique among the store's products that are not archived: `409 CONFLICT`, reason `DUPLICATE_SKU`. An archived product's SKU may be used again.
- `imageKeys` replaces the whole ordered set of pictures. More than 8: `400 VALIDATION_ERROR` (REQ-S-05). A key that is not an upload of the caller's store: `404 NOT_FOUND` with `details.resource` `"upload"`, the same whether the key is unknown or another store's. A key attached to another product: `409 CONFLICT`, reason `UPLOAD_IN_USE`. Removing a picture from a product never deletes the file.
- **Low stock and sold out** (BR-25; D-026, OQ-33; D-028). `lowStock` is `true` when the product is on sale and its stock is **1 to 5**. `soldOut` is `true` when the product is on sale and its stock is **0**; it is a separate figure, never part of low stock. **On sale** means `status` is `PUBLISHED` **and** `moderationStatus` is `APPROVED`, read from the product's own two fields only. So both are `false` for a draft, an archived, a rejected, or a taken-down product, and for a published product still awaiting approval (D-028). A published, approved product **is still counted while it is hidden** because its store is suspended or its category is switched off (D-028). The filters `lowStock=true` and `soldOut=true` and the two counts of the summary use exactly these definitions. The number 5 is one constant in the seller product module, not a setting. (The public `soldOut` of [section 5.2](#52-catalog) is only ever seen on visible products and is simply `stock == 0`.)
- **Stock** (REQ-S-06; D-026, OQ-40). The largest stock a seller may enter is **1,000,000**. `set` is the new absolute value: an integer from 0 to 1,000,000, otherwise `400 VALIDATION_ERROR`. `adjust` is a delta: a non-zero integer from -1,000,000 to 1,000,000, otherwise `400 VALIDATION_ERROR`. A result below zero is `409 CONFLICT`, reason `NEGATIVE_STOCK`; an increase whose result would be above 1,000,000 is `409 CONFLICT`, reason `STOCK_LIMIT`; both change nothing. A stock change applies at once and never touches moderation. Stock given back by a cancellation or a failed payment is not a seller entry and is never refused.
- **Switched-off category** (D-026, OQ-39). Creating a product with a `categoryId` whose category is inactive, or changing a product's `categoryId` to one, is refused with `409 CONFLICT`, reason `CATEGORY_INACTIVE`, and changes nothing. A product that is already in a category that was switched off later can still be edited as long as its `categoryId` is not changed to another inactive one. An unknown `categoryId` is `404 NOT_FOUND` with `details.resource` `"category"`.
- **Product limit per store** (D-043 item 1; SECURITY.md SEC-068 item 2, SEC-069). A store may hold at most **1,000 products whose `status` is not `ARCHIVED`** (`MAX_LIVE_PRODUCTS_PER_STORE`). A create beyond it is `409 CONFLICT`, reason `PRODUCT_LIMIT`, and nothing is written (no product, no picture link). Archiving or deleting a product frees a place (`ARCHIVED` is final). Edits, publishes, unpublishes, and stock changes of a store at the limit are not affected. The answer does not say how many products the store holds.
- **Suspended store: view only, apart from orders** (REQ-S-09; BR-14; D-028). A seller whose store is `SUSPENDED` may use exactly these endpoints: `GET /seller/store`, `GET /seller/summary`, `GET /seller/products`, `GET /seller/products/{id}`, the three order endpoints of [section 5.7.3](#573-seller-orders) (`GET /seller/orders`, `GET /seller/orders/{id}`, `POST /seller/orders/{id}/status`), and `GET /seller/application`. Every other seller endpoint is refused with `403 SELLER_NOT_APPROVED` until the store is reinstated: creating, editing, publishing, unpublishing, archiving, and deleting a product, adjusting stock, editing the store (`PATCH /seller/store`), and uploading (`POST /seller/uploads`). Deleting a product, editing the store, and uploading are not named one by one in D-028; they are refused because they are not views.

##### 5.7.2.1 As built (T-042, 2026-10-20)

Implemented: the nine endpoints of the table above, in `src/modules/inventory` (schema, state table, errors, repository, service; public surface `@/modules/inventory`) and the handlers under `src/app/api/v1/seller/products/` (`route.ts`, `[id]/route.ts`, `[id]/stock/route.ts`, `[id]/publish/route.ts`, `[id]/unpublish/route.ts`, `[id]/archive/route.ts`). The schemas, constants, and types in `src/modules/inventory/schema.ts` are authoritative: `createProductBodySchema`, `updateProductBodySchema`, `stockBodySchema`, `listSellerProductsQuerySchema`, `productIdParamsSchema`, the response types `SellerProductDto` and `DeleteProductDto`, and the constants `MIN_PRICE_SATANG`, `MAX_PRICE_SATANG`, `MAX_SELLER_STOCK`, `LOW_STOCK_THRESHOLD`, `PRODUCT_TITLE_MAX`, `PRODUCT_DESCRIPTION_MAX`, `PRODUCT_SKU_MAX`. The state table is `PRODUCT_TRANSITIONS` and the moderation effect of a save is `classifySave`, both in `src/modules/inventory/state.ts`. Unit tests next to the module and the routes; `tests/integration/inventory/endpoints.test.ts` against PostgreSQL. **Not security-reviewed and not code-reviewed.** The six route files are not yet on the route list guard of `tests/security/t020-t018-catalog-shell.test.ts` (security adds them), so `pnpm test` fails on that one case until then. No endpoint here is rate-limited (section 6 lists none).

**Order of checks** ([section 1.8](#18-access-levels-and-404-against-403)); every response is `Cache-Control: no-store`.

| Endpoint | Access | Steps |
| --- | --- | --- |
| `GET /seller/products` | seller (any store status) | 3 session (401), 4 role `SELLER` (403 `FORBIDDEN`), 7 query (400), then the service |
| `GET /seller/products/{id}` | seller (any store status) | 3, 4 as above, 7 path parameter (400), then the service (404) |
| `POST /seller/products` | seller | 1 `Origin` (403), 2 `Content-Type` (415), 3 session (401), 4 role `SELLER` then store `APPROVED` (403 `FORBIDDEN`, or 403 `SELLER_NOT_APPROVED` before the body is read), 6 body (413), 7 schema (400), then the service |
| `PATCH /seller/products/{id}`, `PATCH /seller/products/{id}/stock` | seller | 1, 2, 3, 4 as above, 6 body, 7 path parameter and body, then the service |
| `DELETE /seller/products/{id}`, `POST .../publish`, `.../unpublish`, `.../archive` | seller, no body ([section 1.2](#12-mutations-without-a-body)) | 1, 2, 3, 4 as above, 7 path parameter, then the service. The body is never read |

**Inside the service** (one transaction per write). The first statement is `requireApprovedStoreForWrite` ([section 5.7.1.1](#5711-as-built-t-040-2026-10-14), "For later tasks"; share lock on the store row while it is the caller's and `APPROVED`), so a suspended store is `403 SELLER_NOT_APPROVED` before any product, category, or upload is looked up (step 8; "store state before ownership", section 1.8). The `Store` row is never updated or deleted after it (CR-T040-04). Then, in this order, the first failing check answers:

1. The product (not on create): locked `FOR UPDATE` by its id **and** the session's store and owner in one statement. An unknown id and another store's id are the same `404 NOT_FOUND`, `details` `{}`, and nothing changes.
2. A new `categoryId` (on create, or a change on edit): share-locked; none is `404 NOT_FOUND`, `details.resource` `"category"`. On edit the category named in the body is locked **before** the product row (lock order store, category, product, upload, picture links; CR-T042-01), but its `404` is still decided after the product's, so this order of answers holds.
3. `imageKeys`: each key resolved as an upload of the session's store only and key-share-locked (so the orphan cleanup of section 5.8.1 cannot delete it before the link is written); any unknown or foreign key is `404 NOT_FOUND`, `details.resource` `"upload"`, identical for both.
4. `409 INVALID_STATE_TRANSITION`: an edit or stock change of an `ARCHIVED` product, and a status move the table does not allow.
5. `409 CONFLICT`, in this order: `PRODUCT_LIMIT` (create only), `CATEGORY_INACTIVE`, `UPLOAD_IN_USE` (the upload is a picture of another product), `DUPLICATE_SKU`, `NEGATIVE_STOCK`, `STOCK_LIMIT`. `PRODUCT_LIMIT` is counted under the store's create lock (a transaction-level advisory lock keyed by the store id, taken right after the store row's share lock, no row lock), so parallel creates of one store count one after the other and the limit holds exactly; other stores are not held up.
6. The guarded write itself carries the store condition (DATA_MODEL.md section 7.7); zero rows because a suspension committed in between is `403 SELLER_NOT_APPROVED` and the transaction is rolled back. The unique indexes `Product_storeId_sku_live_key` and `ProductImage_uploadId_key` are the backstop for races and give the same `DUPLICATE_SKU` and `UPLOAD_IN_USE` (two creates with one SKU at the same time: one `201`, one `409`).

**Responses.**

| Endpoint | Success |
| --- | --- |
| `GET /seller/products` | `200`, list envelope of `SellerProductDto`, newest first (`createdAt` then `id`, both descending). `total` and `items` come from one read-only `REPEATABLE READ` snapshot, so they always agree (CR-T042-05) |
| `GET /seller/products/{id}` | `200`, `SellerProductDto` |
| `POST /seller/products` | `201`, `SellerProductDto`: `status` `DRAFT`, `moderationStatus` `PENDING`, `contentRevision` 1, `isSample` false |
| `PATCH /seller/products/{id}`, `.../stock`, `.../publish`, `.../unpublish`, `.../archive` | `200`, `SellerProductDto` after the change |
| `DELETE /seller/products/{id}` | `200`, `{ "outcome": "DELETED" }` or `{ "outcome": "ARCHIVED" }` |

`SellerProductDto` has exactly the keys of the example above: `id`, `slug`, `title`, `description`, `sku`, `category` (`{ id, name, isActive }`), `priceSatang`, `stock`, `lowStock`, `soldOut`, `status`, `moderationStatus`, `moderationNote`, `images` (`[{ key, url }]` in display order, `url` is `/api/files/` and the key), `isSample`, `createdAt`, `updatedAt`. No store id, owner id, upload id, `contentRevision`, or `moderationRequestedAt`.

**Fields** (item 8.2-7 settled for these endpoints, provisionally; see below).

| Field | Rule |
| --- | --- |
| `title` | One line, trimmed, 1 to 200 characters, `NAME_ALLOWED_TEXT` ([section 5.3.1](#531-as-built-t-030-backend-2026-10-13)) |
| `description` | Multi-line, 1 to 5000 characters after the normalisation of the store description ([section 5.7.1.1](#5711-as-built-t-040-2026-10-14), "Fields"); every non-empty line under `NAME_ALLOWED_TEXT` |
| `sku` | One line, trimmed, 1 to 64 characters, `NAME_ALLOWED_TEXT`. Compared exactly for uniqueness: `ABC` and `abc` are two SKUs |
| `categoryId` | An opaque id, 1 to 200 characters, no U+0000, no lone surrogate (section 1.4) |
| `priceSatang` | Integer, 100 to 100,000,000 (BR-02) |
| `stock` (create) | Integer, 0 to 1,000,000 (BR-34) |
| `imageKeys` | Array of at most 8 opaque keys of 1 to 200 characters; **a key twice is `400`**. An empty array removes every picture |
| `set` / `adjust` | As in the bullet "Stock" above. Both, neither, `adjust: 0`, and a fraction are `400` (path `""`, code `custom`, for both and neither) |
| Query | `page`, `pageSize` (section 1.7); `status` one of `DRAFT`, `PUBLISHED`, `ARCHIVED`; `moderationStatus` one of the four values; `lowStock` and `soldOut` accept only `true` (any other value, `false` included, is `400`). Filters combine with AND. Every other parameter, `storeId` included, is ignored |

The edit body takes at least one field (an empty object is `400`, path `""`, code `custom`). On every body, `stock` (edit only), `status`, `moderationStatus`, `moderationNote`, `contentRevision`, `slug`, `storeId`, and `isSample` are `400 unrecognized_keys`.

**Behaviour worth knowing.**

- **Slug.** Generated from the title by `generateSlug` (DATA_MODEL.md section 9) with a random suffix, never taken from the request, and not changed by an edit of the title.
- **Edit.** Moderation follows `classifySave` and [section 3.3](#33-product-status-and-moderation) exactly. A save in which nothing differs from the stored values writes nothing (not even `updatedAt`). A pure reorder of `imageKeys` rewrites the picture order and `updatedAt` only. Removing a picture removes the link, never the upload or its file.
- **Publish.** Never sets `moderationStatus`. Publishing a product whose `moderationStatus` is `PENDING` sets its place in the approval queue to the time of the publish (BR-36, D-028).
- **Delete** (BR-12). A product no order item references is deleted with its picture links and cart lines (cascade); its uploads stay. A product an order item references is archived through the archive row of the state table. The product row lock keeps a checkout from adding an order item in between; the `Restrict` key on `OrderItem.productId` is the backstop.
- **Stock.** The guarded statements repeat the bounds in their `WHERE` (DATA_MODEL.md section 7.6). Two decrements that together exceed the stock: one succeeds and the other is `409 NEGATIVE_STOCK` (the product row lock orders them). A decrease is accepted when a restore left the stock above 1,000,000.
- **Pictures and logos.** One upload is a picture of at most one product. Nothing stops the upload used as the store logo from also being a product picture; neither link deletes the file.

**Choices made in T-042 and not yet ruled** (each one constant or one line; a client may rely on the status and the code, not on these values):

- The text limits above: `title` 200, `description` 5000, `sku` 64 and case-sensitive (item 8.2-7).
- A duplicate key in `imageKeys` is `400` rather than collapsed.
- `409 CONFLICT` with the new reason `SLUG_TAKEN` (`SLUG_TAKEN` in `src/modules/inventory/errors.ts`; not yet in the reason table of [section 2.3](#23-error-codes)) when the generated slug collides on `Product_slug_key` on each of 3 attempts (`PRODUCT_SLUG_ATTEMPTS`); with 40 random bits per suffix it is not expected to happen.
- `DELETE` of an `ARCHIVED` product that an order references is `409 INVALID_STATE_TRANSITION` and changes nothing; `DELETE` of an `ARCHIVED` product that no order references deletes it.
- A stock change of an `ARCHIVED` product is `409 INVALID_STATE_TRANSITION` (the contract says only that `PATCH` of an archived product is refused).
- `lowStock` and `soldOut` accept only the value `true`.
- Product ids written by this module are random UUIDs, not cuids (as for uploads, section 5.8.1).
- No `AuditLog` row for seller product writes (REQ-A-10 asks for one on admin mutations only).
- `PRODUCT_LIMIT` (D-043, added 2026-10-20) is a new reason of `409 CONFLICT` (`PRODUCT_LIMIT` in `src/modules/inventory/errors.ts`), not yet in the reason table of [section 2.3](#23-error-codes). The value 1,000 is the owner's (D-043), not a choice of this task.
- A `SELLER` session whose user owns no store (not allowed by the data model) is `500 INTERNAL_ERROR` on the two reads, not `404` (CR-T042-06).

#### 5.7.3 Seller orders

A suspended store still reads and fulfils its existing orders (BR-14; finding B4), so these three endpoints do **not** require an approved store.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/seller/orders` | seller (any store status) | Paginated, newest first. Own seller orders only. Filter: `fulfilmentStatus`. |
| GET | `/seller/orders/{id}` | seller (any store status) | `{id}` is a seller order id. Else 404. |
| POST | `/seller/orders/{id}/status` | seller (any store status) | Body `{ to, carrierName?, trackingNumber? }`. Else 404. |

- A seller sees **only their own store's portion** of an order: their seller order, its items, and the buyer's shipping copy. Never another store's portion, and never the order's grand total.
- **The list carries neither `paidAt` nor the buyer's shipping copy** (owner ruling 2026-10-20 on REQUIREMENTS.md Q42: the paid time and the address are shown on the detail only). `GET /seller/orders/{id}` and the answer of `POST /seller/orders/{id}/status` carry both.
- **A seller sees a seller order only once its order is paid** (BR-20; D-026, OQ-41). Every seller read and write is filtered on the order's `paymentStatus` being `PAID`. A seller order whose order is still `PENDING`, or `FAILED`, does not exist for the seller: absent from the list, `404 NOT_FOUND` by id, `404` on a status change, and counted in no figure. `paymentStatus` in a seller's response is therefore always `PAID`.
- `to` is one of `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`; any other value is `400 VALIDATION_ERROR`. The move must be in the table of [section 3.2](#32-fulfilment-status-per-seller-order), otherwise `409 INVALID_STATE_TRANSITION` and nothing changes: in particular anything from `SHIPPED` other than `DELIVERED`. A move on a seller order whose order is not `PAID` (for example `PENDING` to `PROCESSING` while the payment is `PENDING`) is never judged against the table: that seller order does not exist for the seller, so it is `404 NOT_FOUND`, as above.
- `carrierName` and `trackingNumber` are accepted only with `to: "SHIPPED"`; with any other `to` they are a `400 VALIDATION_ERROR`. Both are optional. **Shipping is simulated**: no carrier is contacted and no tracking number is generated.
- Cancelling restores the stock of the seller order's items once and leaves the payment as it is. A cancelled seller order that was paid carries `cancellationKind: "REFUND_OUTSIDE_SYSTEM"`; the system records no refund (BR-21).

Seller order as its seller sees it on the detail and after a status change (a list entry is the same without `paidAt` and `shippingAddress`):

```json
{
  "data": {
    "id": "...", "orderNumber": "OD2610110000042", "createdAt": "...",
    "paidAt": "2026-10-11T18:30:00.000Z",
    "paymentStatus": "PAID",
    "fulfilmentStatus": "PROCESSING", "cancellationKind": null,
    "storeName": "...",
    "itemsSubtotalSatang": 77700,
    "shippingFeeSatang": 4000, "shippingFeeIsSimulated": true,
    "commissionRateBps": 500,
    "shippingAddress": { "recipientName": "...", "phone": "...", "line1": "...", "subdistrict": "...", "district": "...", "province": "...", "postalCode": "10110" },
    "shipment": null,
    "items": [
      { "id": "...", "productId": "...", "productTitle": "...", "productSku": "...", "image": null, "unitPriceSatang": 25900, "quantity": 3, "lineTotalSatang": 77700 }
    ]
  }
}
```

`storeName` is the name at purchase, also for the seller (BR-09). `commissionRateBps` is the rate copied at purchase; it is recorded only. `paidAt` is the paid time of the whole order (BR-39; D-033 point 4): the same for every store's part of one order, still there after the seller order is cancelled, and never `null` in a seller's response, because a seller sees only paid orders (BR-35).

##### 5.7.3.1 As built (T-043, 2026-10-20)

Implemented: `GET /seller/orders`, `GET /seller/orders/{id}`, `POST /seller/orders/{id}/status`, and `GET /seller/summary` ([section 5.7.4](#574-dashboard-summary)), in the seller side of `src/modules/orders` (`seller-schema.ts`, `seller-repository.ts`, `seller-mapping.ts`, `seller-service.ts`; public surface `@/modules/orders`) and the handlers `src/app/api/v1/seller/orders/route.ts`, `src/app/api/v1/seller/orders/[id]/route.ts`, `src/app/api/v1/seller/orders/[id]/status/route.ts`, and `src/app/api/v1/seller/summary/route.ts`. The schemas, constants, and types in `src/modules/orders/seller-schema.ts` are authoritative: `listSellerOrdersQuerySchema`, `sellerOrderIdParamsSchema`, `sellerOrderStatusBodySchema`, `SELLER_TARGET_STATUSES`, `CARRIER_NAME_MAX`, `TRACKING_NUMBER_MAX`, and the response types `SellerOrderListItemDto`, `SellerOrderViewDto`, `SellerOrderItemDto`, and `SellerSummaryDto`. The transition table is `FULFILMENT_TRANSITIONS` in `src/modules/orders/state.ts`, the one place it is defined (the payment side uses the same file). Unit tests next to the module and the routes; `tests/integration/seller-orders/endpoints.test.ts` against PostgreSQL. **Security-reviewed** ([reviews/T-043-security.md](reviews/T-043-security.md), 2026-10-20; no Critical, High, or Medium finding; SEC-072 raised). **Code-reviewed** ([reviews/T-043-code-review.md](reviews/T-043-code-review.md), 2026-10-20; approved). The detail `GET /seller/orders/{id}` reads in one read-only `REPEATABLE READ` snapshot, as the list and the summary do (CR-T043-02). The four route files are on the route list guard of `tests/security/t020-t018-catalog-shell.test.ts`. No endpoint here is rate-limited (section 6 lists none).

**Order of checks** ([section 1.8](#18-access-levels-and-404-against-403)); every response is `Cache-Control: no-store`. All four are `seller (any store status)`: no handler and no service reads the store status, so the seller of a suspended store reads, fulfils, cancels, and reads the summary (BR-14; DATA_MODEL.md section 7.7).

| Endpoint | Steps |
| --- | --- |
| `GET /seller/orders` | 3 session (401), 4 role `SELLER` (403 `FORBIDDEN` for a customer and an admin), 7 query (400), then the service |
| `GET /seller/orders/{id}` | 3, 4 as above, 7 path parameter (400), then the service (404) |
| `POST /seller/orders/{id}/status` | 1 `Origin` (403), 2 `Content-Type` (415), 3 session (401), 4 role `SELLER` (403 `FORBIDDEN`, before the body is read), 6 body (413), 7 path parameter and body (400), then the service (404, then 409) |
| `GET /seller/summary` | 3, 4 as above, then the service. The query is not read |

**Scope.** Every read and the status change look a seller order up by its id **and** the session's store **and** its owner **and** an order whose `paymentStatus` is `PAID`, in one statement. An unknown id, another store's seller order, and a seller order of a `PENDING` or `FAILED` order are therefore the same `404 NOT_FOUND` with `details` `{}`, on a read and on a status change, and nothing changes (BR-20, BR-35). A `storeId` in a query is not interpreted; one in the body is `400`.

**Status change** (one transaction, CLAUDE.md rule 5). In this order, the first failing step answers:

1. The seller order row is locked `FOR UPDATE` with the scope above (404).
2. The move is judged against the table for the actor `SELLER`: `PENDING` to `PROCESSING`; `PROCESSING` to `SHIPPED`; `SHIPPED` to `DELIVERED`; `PENDING` or `PROCESSING` to `CANCELLED`. Anything else is `409 INVALID_STATE_TRANSITION`, `details` `{}`, and nothing changes: in particular `SHIPPED` to `CANCELLED` (BR-29), a move out of `DELIVERED` or `CANCELLED`, and a move to the current status.
3. The guarded statement takes its source states from the same table and repeats the store and the paid-order condition (DATA_MODEL.md sections 7.4 and 7.6). Zero rows is `409`, never a success.
4. The effect, in the same transaction: `SHIPPED` inserts the `Shipment` row (`isSimulated` true, `shippedAt` from the database clock, `carrierName` and `trackingNumber` as the seller typed them or `null`); `DELIVERED` sets `Shipment.deliveredAt` from the database clock, never before `shippedAt`; `CANCELLED` claims the seller order's items whose stock was not yet restored and adds exactly those quantities back, in byte order of the product id (DATA_MODEL.md sections 7.3 and 7.5). The restore has no guard and no upper bound (BR-34): an archived product, a hidden one, and one whose stock stands at 1,000,000 all get their stock back. `Order.paymentStatus` and `paidAt` are not touched, and no refund row exists (BR-21).
5. The seller order is read back in the same transaction and returned, `200`.

Lock order: the `SellerOrder` row, then its `OrderItem` rows (the claim), then the `Product` rows in `COLLATE "C"` order. The `Order` row is not locked: the one condition read from it, `PAID`, is final. Two requests on one seller order queue on the row lock; the second sees the first's result, so two cancels at the same time give one `200` and one `409` and restore the stock once, and a cancel racing a ship ends in exactly one of the two.

**Responses.**

| Endpoint | Success |
| --- | --- |
| `GET /seller/orders` | `200`, list envelope of `SellerOrderListItemDto`, newest first (`SellerOrder.createdAt` then `id`, both descending). `total` and `items` come from one read-only `REPEATABLE READ` snapshot |
| `GET /seller/orders/{id}` | `200`, `SellerOrderViewDto` |
| `POST /seller/orders/{id}/status` | `200`, `SellerOrderViewDto` after the change |
| `GET /seller/summary` | `200`, `SellerSummaryDto` ([section 5.7.4](#574-dashboard-summary)) |

`SellerOrderViewDto` has exactly the keys of the example above: `id`, `orderNumber`, `createdAt` (the order's), `paidAt`, `paymentStatus` (always `PAID`), `fulfilmentStatus`, `cancellationKind` (`REFUND_OUTSIDE_SYSTEM` when cancelled, else `null`), `storeName`, `itemsSubtotalSatang`, `shippingFeeSatang`, `shippingFeeIsSimulated`, `commissionRateBps`, `shippingAddress`, `shipment`, `items` (each `{ id, productId, productTitle, productSku, image, unitPriceSatang, quantity, lineTotalSatang }`, in the order they were written). No order grand total, shipping total, other store's portion, store id, buyer id, or review.

`SellerOrderListItemDto`, the shape of a list entry, has the same keys **except `paidAt` and `shippingAddress`** (owner ruling on Q42, below). The list query does not read the paid time or the address columns at all; only the detail and the status change read them.

**Fields** (item 8.2-7 settled for `carrierName` and `trackingNumber` by the owner, 2026-10-20).

| Field | Rule |
| --- | --- |
| `to` | One of `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`; anything else, `PENDING` included, is `400` |
| `carrierName`, `trackingNumber` | Optional; accepted only with `to: "SHIPPED"` (with any other `to`, `400` at the field's own path, code `custom`). One line, trimmed, 1 to 100 characters, `NAME_ALLOWED_TEXT` ([section 5.3.1](#531-as-built-t-030-backend-2026-10-13)). An empty or blank string and `null` are `400`; leave the key out instead |
| Every other body key | `400 unrecognized_keys`: `storeId`, `fulfilmentStatus`, `from`, `reason`, and any amount included |
| `{id}` | An opaque id, 1 to 200 characters, no U+0000, no lone surrogate (section 1.4) |
| Query of the list | `page`, `pageSize` (section 1.7, at most 50); `fulfilmentStatus` one of the five values. Every other parameter, `storeId` and `paymentStatus` included, is ignored |

**Summary** ([section 5.7.4](#574-dashboard-summary)). The four groups are read in one read-only `REPEATABLE READ` snapshot, from rows of the session's store and owner only. `productsByStatus` counts every product of the store by `status` (all three keys are always present). `lowStockCount` and `soldOutCount` count products with `status` `PUBLISHED` and `moderationStatus` `APPROVED`, stock 1 to `LOW_STOCK_THRESHOLD` (5) and stock 0, whatever the store's status and the category's (BR-25; D-028). `ordersByStatus` counts the store's seller orders of `PAID` orders by `fulfilmentStatus` (all five keys present). `paidSalesTotalSatang` is the sum of `SellerOrder.itemsSubtotalSatang` over the store's seller orders of `PAID` orders that are not `CANCELLED`, summed as a 64-bit integer and sent only after it is checked to be a safe integer (a larger sum is `500`, never a rounded figure); the shipping fee is never part of it (BR-33).

**Decided by the owner (2026-10-20, seventy-ninth session):**

- `carrierName` and `trackingNumber`: 1 to 100 characters each, the display-name character rule, and a blank value is `400` rather than read as absent (item 8.2-7 for these two fields).
- REQUIREMENTS.md Q42 for the seller list: **no**. `GET /seller/orders` entries carry neither `paidAt` nor the shipping copy; the paid time and the address are on `GET /seller/orders/{id}` (and the status change answer) only.
- No `AuditLog` row for a seller's status change or cancel (REQ-A-10 asks for one on admin mutations only), and a seller's cancel takes no reason. Accepted for the MVP.

**Choices made in T-043 and not yet ruled** (each one constant or one line; a client may rely on the status and the code, not on these values):

- `createdAt` is the order's creation time (equal to the seller order's, which checkout writes in the same transaction).
- `GET /seller/orders` is not filtered by paid date (BR-40 point 6 does not require it).
- `DATA_MODEL.md` section 7.5 places `Order` before `SellerOrder`; this transaction takes no `Order` lock at all, for the reason above.
- A `SELLER` session whose user owns no store (not allowed by the data model) is `500 INTERNAL_ERROR`, as in [section 5.7.2.1](#5721-as-built-t-042-2026-10-20).

#### 5.7.4 Dashboard summary

`GET /seller/summary`, all figures computed from real rows of the caller's store (REQ-S-03):

```json
{
  "data": {
    "productsByStatus": { "DRAFT": 2, "PUBLISHED": 14, "ARCHIVED": 1 },
    "lowStockCount": 3,
    "soldOutCount": 1,
    "ordersByStatus": { "PENDING": 1, "PROCESSING": 2, "SHIPPED": 0, "DELIVERED": 9, "CANCELLED": 1 },
    "paidSalesTotalSatang": 1250000
  }
}
```

- `paidSalesTotalSatang` is an **aggregate** ([section 1.5](#15-money)) and can exceed 32 bits. It is the **price of the goods only, without the shipping fee** (D-026, OQ-34): the sum of `itemsSubtotalSatang` over the store's seller orders whose order is `PAID` and whose `fulfilmentStatus` is not `CANCELLED`. Cancelling a paid seller order lowers it (BR-21).
- `lowStockCount` (stock 1 to 5) and `soldOutCount` (stock 0) are two separate figures and count only products that are on sale, as defined in [section 5.7.2](#572-products) (D-026, OQ-33).
- `ordersByStatus` counts the store's seller orders whose order is `PAID` (D-026, OQ-41). Seller orders of a `PENDING` or `FAILED` order count in no figure (BR-20).
- Access `seller (any store status)`: the seller of a suspended store reads it (BR-14). As built by T-043: [section 5.7.3.1](#5731-as-built-t-043-2026-10-20), "Summary". Every key of `productsByStatus` and `ordersByStatus` is always present, with 0 when there is none.

### 5.8 Uploads and files

Findings S7 and S8; DATA_MODEL.md sections 6.7, 6.8, and 8; SECURITY.md "Upload policy" and SR-05.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/seller/uploads` | seller | `multipart/form-data` only, one image per request in the field `file`. Rate-limited. Response `201`. A suspended store is refused before the body is read. |
| GET | `/api/files/{key}` | public, or the owning seller (SEC-068) | Serves a stored image to anyone when it is public, otherwise only to the session of the seller whose store owns it. Not an envelope response on success. |

**Upload.**

- Allowed: JPEG, PNG, WebP; at most 5 MB (5,242,880 bytes) per file. The content is checked against its type by its leading bytes, not by the extension or the declared type; a file of exactly 5 MB is accepted.
- **The caller is judged before a byte of the body is read** (D-032 point 1; SECURITY.md SR-05 item 5). The upload follows the order of [section 1.8](#18-access-levels-and-404-against-403) like every other `seller` endpoint, and steps 1 to 5 use only the headers and the session: a foreign or missing `Origin` is `403 FORBIDDEN`; a request that is not `multipart/form-data` is `415`; no session is `401`; a customer or an admin is `403 FORBIDDEN`; **a seller whose store is `SUSPENDED` is `403 SELLER_NOT_APPROVED`**; the rate limit is `429`. Only then is the multipart body read. A request refused at one of these steps is not read, nothing of it is held or reaches storage, and no `Upload` row is written, whatever it carries and however large it is. A request refused at steps 1 to 4, a suspended store's included, uses none of the upload allowance of [section 6](#6-rate-limits-initial-values-tune-after-testing); a request that reaches the rate limit uses one, whatever happens to it afterwards.
- The service judges the store status again and the insert of the `Upload` row carries the condition (step 8 of section 1.8; DATA_MODEL.md section 7.7), so an upload that was being read when its store was suspended is refused with the same `403 SELLER_NOT_APPROVED` and leaves no row; bytes without a row are never served (see "Serving" below).
- A request that is not `multipart/form-data`, a file of another type, and a file whose content does not match an allowed type: `415 UNSUPPORTED_MEDIA_TYPE`. A file over the limit: `413 PAYLOAD_TOO_LARGE`. Nothing is stored in either case. The checks on the file are made at step 6, while the body is read, and its size is enforced on the bytes as they arrive, not on a declared length (SR-05 items 3 and 6).
- A multipart body that stops arriving is answered like a JSON body that does ([section 1.1](#11-transport); SR-05 item 10): a client error, never `500 INTERNAL_ERROR`, nothing stored. The status and the code are open with item 8.2-13 ([section 8.2](#82-open-technical)).
- The file is stored under a **key the server generates**. The client's filename is never used as a name or a path.
- The upload belongs to **the caller's store**, taken from the session; the request cannot name another owner.
- Response: `{ "data": { "key": "...", "url": "...", "contentType": "image/webp", "sizeBytes": 48211 } }`.
- SECURITY.md SR-05 allows an upload request to carry up to 8 files; this contract takes one. Changing that is a contract change for T-041.

**Attaching.** Uploading attaches nothing. A key becomes a product picture through `imageKeys` ([section 5.7.2](#572-products)) and a store logo through `logoKey` ([section 5.7.1](#571-application-and-store)). A key sent by a client is always looked up as an upload **of the caller's own store**; a key with no upload, and a key of another store, are refused identically with `404 NOT_FOUND` (`details.resource` `"upload"`). At most 8 pictures per product; one upload is attached to at most one product.

**Lifetime.**

- An upload never changes: its bytes are never overwritten and its key is never reused.
- **No endpoint deletes an upload.** Removing a picture from a product, replacing a logo, and deleting or archiving a product remove only the link.
- An upload that nothing references (no product, no store logo, no order item) for longer than a grace period (24 hours) is an orphan and is removed by a cleanup job, not by a request. An upload that any order item references is never an orphan, so **an order's picture stays for ever** (finding S7).
- **An orphan is no longer served** (SEC-065): from the end of the grace period, `GET /api/files/{key}` answers `404 NOT_FOUND` for it, whether or not the cleanup job has deleted it yet. Attaching it again before the job deletes it makes it served again.
- **A store may hold at most 50 uploads that nothing references** (SEC-065; **provisional**, see section 5.8.1), whatever their age, orphans not yet deleted included. One more upload is refused with `409 CONFLICT`, `details.reason` `UPLOAD_LIMIT`, before the body is read and again inside the upload transaction, and nothing is stored. Attaching an upload, or the cleanup job deleting an orphan, frees a place.

**Serving.** `GET /api/files/{key}`:

- The key must match the strict pattern of generated keys and must belong to a registered upload that is not an orphan (see "Lifetime"); anything else, including any traversal attempt, is `404 NOT_FOUND` and reads nothing. The key pattern itself is `OPEN (technical)` for T-041 (SECURITY.md TM-18).
- The response has the upload's recorded image content type, never one derived from the request, and `X-Content-Type-Options: nosniff`.
- **Who may read** (SEC-068 item 1, 2026-10-20; replaces "product pictures and logos are public by design"). A file is **public**, and served to anyone with or without a session, when it is at least one of: a picture of a product that is **visible now** ([section 3.4](#34-visibility-and-can-be-bought), BR-05), the logo of a store whose page is **public** (section 3.4), or the picture of an **order item**. Every other registered upload that is not an orphan is served **only to a `SELLER` session whose store owns it**, whatever that store's status (BR-14): an upload not attached yet, a picture of a draft, of a product awaiting approval, rejected, taken down, or archived, of a product hidden by its store, its owner, or its category, and the logo of a suspended store. Anyone else, an admin included, gets the same `404 NOT_FOUND` as for an unknown key. A takedown, a suspension, a deactivated owner, or a switched-off category therefore stops the public serving of the pictures at once, and approval or reinstatement brings it back, without any write to an upload.
- No session is required: a request without one is never `401`. The session is looked up only for a file that is not public. A seller's dashboard shows its own pictures through the same `url`, with its session cookie.
- The admin moderation screens (T-050) cannot yet show the pictures of a product awaiting approval: an admin session is not the owner. That needs its own rule, decided with T-050.
- Local adapter only in the MVP (D-010). Caching of file responses is `OPEN (technical)` for T-041; nothing is documented as cacheable yet.

#### 5.8.1 As built (T-041, 2026-10-19)

Implemented: `POST /api/v1/seller/uploads` (`src/app/api/v1/seller/uploads/route.ts`) and `GET /api/files/{key}` (`src/app/api/files/[key]/route.ts`), over `src/modules/uploads` (schema, multipart reader, content check, `StorageProvider` with the local disk adapter, repository, service). The constants and types in `src/modules/uploads/schema.ts` are authoritative: `MAX_UPLOAD_FILE_BYTES`, `MAX_UPLOAD_BODY_BYTES`, `UPLOAD_CONTENT_TYPES`, `UPLOAD_EXTENSIONS`, `STORAGE_KEY_PATTERN`, `FILE_CACHE_CONTROL`, and the response type `UploadDto`. Unit tests next to the module; `tests/integration/uploads/endpoints.test.ts` against PostgreSQL and a real directory. Security-reviewed on 2026-10-19 ([reviews/T-041-security.md](reviews/T-041-security.md)): the upload route is in the route list guard of `tests/security/t020-t018-catalog-shell.test.ts`, and the file route, which lies outside `src/app/api/v1`, in the guard of `tests/security/t041-uploads.test.ts`. The fix of SEC-065 (cap, orphans not served, cleanup function; below) came after that review and is not yet re-checked by security.

**Order of checks of `POST /seller/uploads`** (section 1.8). Every response is `Cache-Control: no-store`.

| Step | Check | Refusal |
| --- | --- | --- |
| 1 | `Origin` | `403 FORBIDDEN` |
| 2 | `Content-Type` media type `multipart/form-data` (parameters not judged here) | `415 UNSUPPORTED_MEDIA_TYPE` |
| 3 | Session | `401 UNAUTHENTICATED` |
| 4 | Role `SELLER`, then store `APPROVED` | `403 FORBIDDEN`; `403 SELLER_NOT_APPROVED` |
| 5 | `uploads` on the session's user id (30 per hour); a refusal is a throttled security event (SR-04) | `429 RATE_LIMITED` with `Retry-After` |
| 5b | The session's store holds `MAX_UNATTACHED_UPLOADS_PER_STORE` (50, provisional) uploads that nothing references, whatever their age (`assertUploadAllowance`; SEC-065). Nothing of the body is read | `409 CONFLICT`, `details.reason` `UPLOAD_LIMIT` |
| 6a | The body, at most `MAX_UPLOAD_BODY_BYTES` = 5,259,264 bytes (one file of 5,242,880 plus 16,384 of multipart framing): a `Content-Length` over it or not a plain decimal number before a byte is read, then on the bytes as they arrive | `413 PAYLOAD_TOO_LARGE` |
| 6b | The framing: the `boundary` parameter, the delimiters, the part headers (only `Content-Disposition` and `Content-Type`, each once, at most 8,192 bytes per part, strict UTF-8), exactly one part, named `file`, carrying a `filename` | `400 VALIDATION_ERROR`, see "Field errors" below |
| 6c | The client file name (see "File name" below) | `400 VALIDATION_ERROR`, path `file`, code `invalid_format` |
| 6d | The file's size, at most 5,242,880 bytes | `413 PAYLOAD_TOO_LARGE` |
| 6e | The type: the leading bytes must show JPEG, PNG, or WebP, and the part's declared `Content-Type` and the file name's extension must name that same type | `415 UNSUPPORTED_MEDIA_TYPE` |
| 8 | In the service, one transaction: `requireApprovedStoreForWrite` first (share lock on the store row while it is the caller's and `APPROVED`), then the store's upload lock (a transaction-level advisory lock keyed by the store id, no row lock) and the count of step 5b again, then the bytes are stored, then the `Upload` row is inserted by a statement that carries `ownerId` and `status = 'APPROVED'` itself (`INSERT ... SELECT ... WHERE`). The `Store` row is never updated or deleted after the lock (CR-T040-04). The upload lock makes parallel uploads of one store count one after the other, so the cap holds exactly | `403 SELLER_NOT_APPROVED`, or `409 CONFLICT` `UPLOAD_LIMIT`; nothing kept |

- The checks of the file are steps 6b to 6e. 6b and 6c are `400` although they come before 6d (`413`): the size of the file can only be known after the framing was read. A body over the body limit is `413` before anything else (6a).
- **Leading bytes** (`detectImageType`): JPEG `FF D8 FF` and at least one more byte; PNG the 8-byte signature followed by an `IHDR` chunk header; WebP `RIFF`, `WEBP`, a first chunk `VP8 `, `VP8L`, or `VP8X`, and a RIFF size that fits the file. GIF, SVG, HTML, PDF, and everything else are `415`, whatever the name or the declared type. A part without `Content-Type`, with `application/octet-stream`, or with `image/jpg` is `415`.
- **Extensions**: `.jpg` or `.jpeg` for JPEG, `.png`, `.webp`, without regard to letter case. A name without an extension is `415`.
- **File name**: never used as a name or a path, and never stored, logged, or echoed. Refused (`400`, path `file`, code `invalid_format`): empty, more than 255 characters, a control character (U+0000 to U+001F, U+007F to U+009F), `/`, `\`, `:`, the name `.`, a name starting with `..`, and a percent-encoded `/`, `\`, `:`, `.`, or control character (`%2f`, `%5c`, `%3a`, `%2e`, `%00` to `%1f`, `%7f`, any letter case).
- **Field errors** (each `400 VALIDATION_ERROR` has exactly one; messages repeat nothing of the request):

  | Case | `path` | `code` |
  | --- | --- | --- |
  | No or invalid `boundary`, a preamble, a broken delimiter, a malformed or unaccepted part header, `filename*`, a parameter other than `name` and `filename` | `""` | `invalid_multipart` (**provisional**, see below) |
  | A field other than `file`, for example `storeId` | `""` | `unrecognized_keys` |
  | No part, two `file` parts, or a `file` part without `filename` | `file` | `invalid_type` |
  | A refused file name | `file` | `invalid_format` |

- **A body that stops arriving** is answered as for a JSON body today: `400 VALIDATION_ERROR` with the field error `invalid_json` (provisional, item 8.2-13, which notes that this field code does not fit a multipart body). Nothing is stored.
- **Response** `201`: exactly `{ key, url, contentType, sizeBytes }`; `contentType` is the type the leading bytes show; `url` is `/api/files/` followed by the key. No upload id, store id, or file name.
- **Bytes and row.** A store suspended before the share lock, or at its cap, never gets a byte stored. When the insert or the commit fails after the bytes were stored, they are deleted again; if that deletion fails, the file stays without a row, is never served, and one warn line names its key.

**Orphan cleanup** (`src/modules/uploads/cleanup.ts`; section 5.8 "Lifetime"; DATA_MODEL.md section 8; SEC-065). No endpoint reaches it.

- `cleanUpExpiredOrphans({ storage })` deletes orphans in batches of `ORPHAN_CLEANUP_BATCH_SIZE` (100) rows, each batch one transaction, at most `ORPHAN_CLEANUP_MAX_BATCHES` (10) batches per run. Rows go first, then the bytes of each deleted row. A file whose deletion fails stays without a row, is never served, and one warn line names its key.
- **Storage check first** (SEC-073). Before the first batch the run calls `storage.assertReady()`: the local disk root must exist, be a directory, and hold the marker file `.marketplace-uploads` (`UPLOAD_ROOT_MARKER`), which every `put` creates when it is missing. Otherwise, or when the adapter has no check, no row is deleted and the run throws `UploadStorageNotReadyError` (message names no path). A root that existed before the marker gets it at its next upload; until then the cleanup refuses to run there. A file already missing is counted as `filesMissing`, not `filesDeleted`, with one warn line per run holding only the count.
- Safe against a concurrent attach: the candidates are locked `FOR UPDATE ... SKIP LOCKED` (a row whose reference is being written is skipped), and the delete repeats every condition in a second statement, so an attach committed in between keeps its row. An attach that waited on the lock fails its foreign key once the row is gone. The `Restrict` foreign keys stay the backstop.
- `runUploadCleanup()` is one run with one log line (`info` with `rowsDeleted`, `filesDeleted`, `filesMissing`, `filesFailed`; `error` with the error class and code only). `startUploadCleanupSchedule()` runs it at once and then every `ORPHAN_CLEANUP_INTERVAL_MS` (one hour), one schedule per process.
- **Not scheduled yet.** Nothing calls `startUploadCleanupSchedule`: the start-up hook `src/instrumentation.ts`, which already starts the session purge and the payment timeout sweep, belongs to devops. Until it is wired, orphans are not served but their rows and bytes stay, and they keep counting against the store's cap, which bounds what one store can keep on disk to 50 files of at most 5 MB.

**`GET /api/files/{key}`** (public or the owning seller, SEC-068; no rate limit). One path segment, decoded by the framework.

- Order: the key pattern; one statement (`fileLookupStatement` in `src/modules/uploads/repository.ts`) reads the upload's store, type, size, whether it is an orphan, whether it is an order item picture or a picture of a visible product (`VISIBLE_PRODUCT_SQL`), and whether it is any store's logo; for a logo that is not otherwise public, one more query asks whether its store is public (`PUBLIC_STORE_WHERE`); for a file that is still not public, the session is resolved through `getActor` and `mayServe` (`src/modules/uploads/service.ts`) allows only a `SELLER` whose store id is the upload's; then the bytes. Every lookup in the statement uses an index of its own (`ProductImage_uploadId_key`, `Store_logoUploadId_key`, `OrderItem_productImageUploadId_idx`, primary keys).
- `404 NOT_FOUND`, the same envelope in every case: a key that does not match `STORAGE_KEY_PATTERN` (checked first; nothing is looked up or read), a key with no `Upload` row, an orphan (nothing references the upload and it is older than `ORPHAN_GRACE_PERIOD_SECONDS` = 86,400 by the database clock; nothing is read or logged; SEC-065), a file the caller may not read (SEC-068; nothing is read or logged), a row whose bytes are missing or whose stored length differs from `sizeBytes`, or a recorded type outside the three (the last three write a warn line with the key).
- `200`: the bytes, with `Content-Type` the recorded type, `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline`, `X-Request-Id`, and `Cache-Control: no-store` (**provisional**, see below). Not an envelope.

**Choices made in T-041 and not yet ruled** (item 8.2-8, "T-041, with security"; each is one constant, so a ruling is a one-line change). A client may rely on the status and the error code, not on these values:

- Storage key: 32 lower-case hexadecimal digits from 16 random bytes (`STORAGE_KEY_PATTERN` `^[0-9a-f]{32}$`). Files live at `<UPLOAD_DIR>/<first two digits>/<key>`, written once with an exclusive create.
- Caching of file responses: `no-store` (`FILE_CACHE_CONTROL`), because nothing is documented as cacheable.
- One file per request, as this section already says; the SR-05 allowance of 8 files is not used.
- An extra form field (for example `storeId`) is refused with `400 unrecognized_keys`, as an unknown key of a JSON body (section 1.1), rather than ignored.
- The field code `invalid_multipart` for a body whose framing cannot be read (`INVALID_MULTIPART_FIELD_CODE`), a third code that does not come from a schema besides `invalid_json` and `invalid_header` (section 2.2).
- The client file name rule above (the brief requires traversal names to be refused; the exact list is this task's).
- SEC-065 (added 2026-10-19): the cap of 50 uploads nothing references per store (`MAX_UNATTACHED_UPLOADS_PER_STORE`), counted whatever their age; the refusal `409 CONFLICT` with the new reason `UPLOAD_LIMIT` (`UPLOAD_LIMIT_REASON`; not yet in the reason table of [section 2.3](#23-error-codes)); the early check at step 5b before the body; the cleanup's batch size (100), batches per run (10), and interval (one hour). The grace period of 24 hours is this section's own value, not a new choice.

**Configuration.** The local adapter needs `UPLOAD_DIR`, an absolute directory path. When it is missing or not absolute, both endpoints answer `500 INTERNAL_ERROR` (the upload endpoint after step 4, before the rate limit and before the body). `src/server/env.ts` validates it at start (absolute, not blank, no NUL; required in production, optional elsewhere; DEPLOYMENT.md "Uploaded files"). `src/modules/uploads/config.ts` still reads the variable itself with the same rule; moving it to `getEnv().uploadDir` is open.

### 5.9 Admin

Every path below requires `ADMIN`. A guest gets `401`, a customer or seller `403 FORBIDDEN` (REQ-A-01). Every mutation writes one audit row in the same transaction as the change; a rejected call writes none (REQ-A-10). An unknown id is `404 NOT_FOUND`.

#### 5.9.1 Users

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/users` | Paginated. Filters: `q` (substring of name or email), `role`, `isActive`. |
| POST | `/admin/users/{id}/deactivate` | No body. Deletes every session of that user in the same transaction; the user cannot sign in until reactivated. Own account: `409 CONFLICT`, reason `SELF_DEACTIVATION`. Last active admin: `409 CONFLICT`, reason `LAST_ADMIN`. Already inactive: `409 INVALID_STATE_TRANSITION`. |
| POST | `/admin/users/{id}/reactivate` | No body. Already active: `409 INVALID_STATE_TRANSITION`. The user must sign in again. |

- User item: `{ id, name, email, phone, role, isActive, createdAt, store: { id, name, slug, status } | null }`. Never a password hash, a session, or a session's IP address or browser details.
- **No endpoint here, or anywhere, changes a role** (BR-26; finding S9). `role` is an unknown key.
- Deactivating a user who owns a store does not change the store's `status`; the store and its products are hidden because visibility reads the owner's account (BR-27). Reactivating brings the store and its products back by themselves (D-026, OQ-31), in exactly the earlier state, including a suspension already in place.
- A deactivated store owner cannot sign in to ship orders already paid. **Nothing is automatic**: the admin cancels those seller orders by hand, one by one, through `POST /admin/seller-orders/{id}/status` (D-026, OQ-32; [section 5.9.5](#595-orders)). Deactivating a user changes no order.

#### 5.9.2 Applications and stores

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/applications` | Paginated, oldest first. Filter: `status`. |
| POST | `/admin/applications/{id}/approve` | No body. In one transaction: the application becomes `APPROVED`, a store is **created** with status `APPROVED` and a generated slug, and the applicant's role becomes `SELLER`. Not `PENDING`: `409 INVALID_STATE_TRANSITION`. Applicant no longer a `CUSTOMER`: `409 CONFLICT`, reason `APPLICANT_NOT_CUSTOMER`. Applicant deactivated: `409 CONFLICT`, reason `APPLICANT_INACTIVE`; nothing is created and the application stays `PENDING`, so an admin can reject it (D-040 point 1). Store name reserved or held by another store by now: `409 CONFLICT`, reason `STORE_NAME_RESERVED` or `STORE_NAME_TAKEN`; nothing is created and the application stays `PENDING` (SEC-058, D-041; [section 5.7.1.1](#5711-as-built-t-040-2026-10-14)). |
| POST | `/admin/applications/{id}/reject` | Body `{ reason }`, required and not empty. No store is created; the role stays `CUSTOMER`. Not `PENDING`: `409 INVALID_STATE_TRANSITION`. |
| GET | `/admin/stores` | Paginated. Filters: `status`, `q` (substring of the store name). Includes hidden stores. |
| POST | `/admin/stores/{id}/suspend` | Body `{ reason }`, required. `APPROVED` to `SUSPENDED`; otherwise `409 INVALID_STATE_TRANSITION`. |
| POST | `/admin/stores/{id}/reinstate` | Body `{ reason }`, required. `SUSPENDED` to `APPROVED`; otherwise `409 INVALID_STATE_TRANSITION`. |

- Approval always **creates** the store (DATA_MODEL.md section 4.1): a user who owns a store cannot apply (REQ-S-01), so there is no "activate" case.
- Suspending hides the store's products and blocks new orders for it; it does **not** end the seller's sessions, and the seller keeps the three order endpoints of [section 5.7.3](#573-seller-orders) (BR-14; finding B4).
- Store item for admins: `{ id, name, slug, description, logo, contactPhone, status, statusReason, isSample, ownerId, ownerIsActive, createdAt }`.
- **Services built in T-040 (2026-10-14), no endpoint yet.** `approveApplication(actor, id)` and `rejectApplication(actor, id, { reason })` in `@/modules/sellers`; T-050 exposes them as the two `POST` endpoints above after `requireActor` and `requireRole(actor, "ADMIN")`, parsing `{id}` with `applicationIdParamsSchema` and the reject body with `rejectApplicationBodySchema` (strict; `reason` is multi-line text of 1 to 500 characters after the normalisation of [section 5.7.1.1](#5711-as-built-t-040-2026-10-14), so a blank reason is `400`). Each service checks the role `ADMIN` itself (403 otherwise) and runs one transaction: the application row is locked (`FOR UPDATE`; unknown id `404`, not `PENDING` `409 INVALID_STATE_TRANSITION`); for an approval the applicant's user row is then locked (`FOR NO KEY UPDATE`, so a deactivation either committed before or waits) and `isActive = false` is `409 CONFLICT` `APPLICANT_INACTIVE` with nothing written and the application left `PENDING` (D-040 point 1); a reserved store name is `409 CONFLICT` `STORE_NAME_RESERVED`, likewise with nothing written (D-041 point 3); the application is moved by the guarded update, and for an approval the role is changed by `WHERE role = 'CUSTOMER' AND "isActive" = true` (zero rows rolls everything back as `409 CONFLICT` `APPLICANT_NOT_CUSTOMER`) and the store is created with status `APPROVED`, the application's name, description, and contact phone, and a generated slug. Only a violation of `Store_slug_key` (a slug collision) retries the whole approval with a new slug, at most 3 times, then `500` with nothing stored; a violation of `Store_nameKey_key` is not retried: it rolls everything back as `409 CONFLICT` `STORE_NAME_TAKEN` (D-041 point 1); a violation of `Store_ownerId_key` (a `CUSTOMER` who already owns a store row, which the data model forbids) is not retried either: it rolls everything back as `409 CONFLICT` `APPLICANT_NOT_CUSTOMER` (CR-T040-02); any other error is `500` with nothing stored. One `AuditLog` row is written in the same transaction: action `SELLER_APPLICATION_APPROVED` or `SELLER_APPLICATION_REJECTED`, target type `SellerApplication`, target id the application id, `metadata` `{ applicantId, before, after }` (approval: `before { status, role }`, `after { status, role, storeId }`; rejection: also `reason`). The result is `{ application: { id, userId, status, reviewNote, reviewedAt }, store: { id, name, slug, status } | null }` (`ApplicationDecisionDto`); what the admin endpoint returns is T-050's to fix. Two concurrent approvals of one application create one store and one audit row; the other is `409`. Suspend and reinstate are not built (T-050; the store state table is in `src/modules/sellers/state.ts`).

#### 5.9.3 Product moderation and `contentRevision`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/products` | Paginated. Filters: `queue=true`, `moderationStatus`, `status`, `storeId`, `q` (substring of the title). `queue=true` is the approval queue (below) and cannot be combined with `moderationStatus` or `status` (`400 VALIDATION_ERROR`). |
| GET | `/admin/products/{id}` | Any product, whatever its state. |
| POST | `/admin/products/{id}/approve` | Body `{ contentRevision }`. `PENDING` to `APPROVED`, only for a product whose `status` is `PUBLISHED`. Clears `moderationNote`. |
| POST | `/admin/products/{id}/reject` | Body `{ contentRevision, reason }`, reason required. `PENDING` to `REJECTED`, only for a product whose `status` is `PUBLISHED`. |
| POST | `/admin/products/{id}/takedown` | Body `{ contentRevision, reason }`, reason required. `APPROVED` to `TAKEN_DOWN`. |

The admin's product view is the seller's view of [section 5.7.2](#572-products) plus `contentRevision`, `moderationRequestedAt`, and `store: { id, name, slug, status }`.

**`contentRevision`** (DATA_MODEL.md section 4.2; D-031 point 2) is an integer, 1 or more. One seller save raises it by one, in exactly two cases:

1. the save changes a **moderated field** (`title`, `description`, `categoryId`, or the set of pictures; [section 3.3](#33-product-status-and-moderation)), whatever the product's `moderationStatus`;
2. the save **resubmits** the product, that is, moves it from `REJECTED` or `TAKEN_DOWN` to `PENDING`. This is the only case in which a change of the price alone raises it (D-028; D-031 point 2).

Nothing else raises it: not a price change on an `APPROVED` or `PENDING` product, not a change of stock, of `sku`, or of the order of the pictures, not a save in which nothing differs, not publishing, unpublishing, or archiving, and not an admin decision. As one rule: **every seller save that changes what an admin is asked to decide on raises the revision; nothing else does.**

It exists so that an admin decides on **what they were shown**:

- Every admin product response carries `contentRevision`.
- Every decision sends back the `contentRevision` the admin saw. It is required; a missing or non-integer value is `400 VALIDATION_ERROR`.
- If the product's revision is no longer that value, the seller changed a moderated field, or resubmitted the product, in between: `409 CONFLICT`, reason `STALE_REVISION`, and nothing changes. The admin reloads and decides again.
- **The stale approve after a price-only resubmission** (D-031 point 2). An admin screen opened before a product was rejected or taken down holds the earlier revision and the earlier price. When the seller then changes only the price, the product is `PENDING` again, at a revision one higher. An approve sent from that old screen is `409 CONFLICT`, reason `STALE_REVISION`: the product does not go on sale at a price the admin never saw.
- If the product is not in the state the decision needs (for example approving a product that is not `PENDING`): `409 INVALID_STATE_TRANSITION`. Which of the two codes is answered when the revision **and** the state both differ is `OPEN (technical)` ([section 8.2](#82-open-technical), item 8.2-6).
- Known consequence, accepted with D-025 OQ-05 (DATA_MODEL.md section 4.2): the price of a `PENDING` product can change without raising the revision, so an admin can approve a waiting product whose price changed after they opened it.

**The approval queue** (`GET /admin/products?queue=true`; REQ-A-05; D-026, OQ-42; D-028) lists the products whose `moderationStatus` is `PENDING` **and** whose `status` is `PUBLISHED`, **oldest first by the time the product was submitted for approval** (`moderationRequestedAt`). Publishing a product that is awaiting approval sets that time, so a long-standing draft does not jump the queue when it is published; an edit of a product that is already in the queue does not move it. The queue holds new products once their seller has published them, approved products sent back by an edit (BR-18), and resubmitted products (BR-19). A product the seller has saved but not yet published is not in the queue, and one that is unpublished or archived leaves it without a decision. A rejected or taken-down product is not visible; its seller can correct it ([section 3.3](#33-product-status-and-moderation)).

**No decision on an unpublished product** (D-028). Approve and reject apply only to products that are in the queue: published and awaiting approval. Approving or rejecting a product whose `status` is not `PUBLISHED`, also when an admin opens it directly by id, is `409 INVALID_STATE_TRANSITION` and changes nothing. Takedown is unchanged: it applies to an `APPROVED` product. The plain list (`moderationStatus=PENDING` without `queue=true`) and `GET /admin/products/{id}` still show unpublished products; they can be read, not decided.

#### 5.9.4 Categories

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/categories` | Paginated. Includes inactive categories. |
| POST | `/admin/categories` | Body `{ name, sortOrder? }`. The slug is generated. |
| PATCH | `/admin/categories/{id}` | Body: any of `name`, `sortOrder`, `isActive`. A rename keeps the slug. |
| DELETE | `/admin/categories/{id}` | No body. Deletes a category that **no product references**. If any product references it, archived ones included: `409 CONFLICT`, reason `CATEGORY_HAS_PRODUCTS`, and nothing changes; deactivate it instead (REQ-A-06; finding M11). |

Category item for admins: `{ id, name, slug, sortOrder, isActive, isSample, createdAt, updatedAt }`. Setting `isActive` to `false` removes the category's products from the whole storefront and makes them unbuyable through the visibility rule alone (BR-23); no product is changed, so setting it back to `true` brings them back by themselves (D-026, OQ-31). A seller cannot put a product into an inactive category ([section 5.7.2](#572-products)).

#### 5.9.5 Orders

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/orders` | Paginated, newest first. Filters: `paymentStatus`, `fulfilmentStatus` (orders with at least one seller order in that status), `storeId`, `userId`, `orderNumber` (exact), `from`, `to` (on the order's creation time, [section 1.6](#16-time)), and `paidFrom`, `paidTo` (on the time the order was paid, BR-40; D-033 point 4; [section 5.9.8](#598-as-built-t-050-2026-10-23)). |
| GET | `/admin/orders/{id}` | The whole order with every seller order. |
| POST | `/admin/seller-orders/{id}/status` | Body `{ to }` where `to` is `CANCELLED` or `DELIVERED`; any other value is `400 VALIDATION_ERROR`. |

- The admin's order is the customer's shape of [section 5.5.2](#552-response) plus `userId` and, on each seller order, `storeId` and `commissionRateBps`.
- An admin may cancel a `PENDING` or `PROCESSING` seller order, paid or not, and may mark a `SHIPPED` one `DELIVERED`. Nothing else: an admin cannot move an order to `PROCESSING` or `SHIPPED`, and cancelling a `SHIPPED` seller order is `409 INVALID_STATE_TRANSITION` (BR-29, REQ-A-07).
- Cancelling restores stock once and leaves the payment as it is; a paid one then carries `cancellationKind: "REFUND_OUTSIDE_SYSTEM"`. **No endpoint records a refund.**
- An admin cancel on a seller order of a `FAILED` order: it is already `CANCELLED`, so `409 INVALID_STATE_TRANSITION`, with no stock change (finding B5).
- Admins see orders whose payment failed, marked as payment failed, with no action possible on them (D-026, OQ-25; [section 5.5.4](#554-failed-payment)).

#### 5.9.6 Settings

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/settings` | The single settings row. |
| PATCH | `/admin/settings` | Body: one or both of the two fields below. |

```json
{ "data": { "flatShippingFeeSatang": 4000, "commissionRateBps": 500, "updatedAt": "...", "updatedById": "..." } }
```

| Field | Type and bounds | Initial value | Meaning |
| --- | --- | --- | --- |
| `flatShippingFeeSatang` | integer, **0 to 100,000** inclusive (0.00 to 1,000.00 THB) | 4,000 | The **simulated** flat shipping fee per seller order (BR-08) |
| `commissionRateBps` | integer, **0 to 10,000** inclusive **and a multiple of 100** (0 to 100 percent, whole percents only) | 500 | Commission in basis points; recorded on each seller order, nothing is deducted (BR-13) |

- These are the **only two settings** (REQ-A-09). There is no moderation switch: a body that carries `requireProductApproval`, or any other key, is `400 VALIDATION_ERROR` with `unrecognized_keys` and changes nothing (BR-17).
- A value outside its bounds, a fraction, or a non-number is `400 VALIDATION_ERROR`; the stored value does not change and no audit row is written (BR-28; D-025, OQ-16). The boundary values 0, 100,000, 0, and 10,000 are accepted.
- A change applies to orders created afterwards. Existing seller orders keep the fee and the rate copied at purchase.
- **The commission rate is a whole number of percent; no decimals** (D-026, OQ-38). The field is `commissionRateBps`, the name and unit DATA_MODEL.md section 6.16 stores, in the settings and on every seller order, and the settings endpoint accepts **only multiples of 100**. `250` (2.5 percent) is `400 VALIDATION_ERROR` and changes nothing; `0`, `500`, and `10000` are accepted. The presentation layer shows and collects `commissionRateBps / 100` as a whole percent.

#### 5.9.7 Summary, reports, and audit log

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/summary` | Dashboard figures from real rows. |
| GET | `/admin/reports` | Query `from`, `to`, both required ([section 1.6](#16-time)). |
| GET | `/admin/audit-logs` | Paginated, newest first. Read-only. Filters: `actorId`, `action`, `targetType`, `targetId`, `from`, `to`. |

`GET /admin/reports` (REQ-A-08):

```json
{
  "data": {
    "from": "2026-10-10T17:00:00.000Z", "to": "2026-10-11T17:00:00.000Z",
    "orderCount": 42,
    "paidRevenueSatang": 3120000,
    "newUserCount": 17,
    "newSellerCount": 2
  }
}
```

- **The range has a timezone because it is two instants** (finding M9): `from` and `to` are ISO 8601 instants with an explicit `Z` or offset, `from` inclusive, `to` exclusive. A calendar day in Asia/Bangkok is converted to instants by the presentation layer.
- **Which date places a row in the range.** `orderCount` and `paidRevenueSatang` use **the time the order was paid** (D-028), not the time it was created. That time is stored as `Order.paidAt` (DATA_MODEL.md section 6.10). The owner answered item 8.1-1 (D-033 point 4): it is returned as `paidAt` on the order shapes, and the admin order list filters by it with `paidFrom` and `paidTo` (BR-40, [section 5.9.8](#598-as-built-t-050-2026-10-23)). An order created before midnight and paid after it is therefore in the report of the later day, in the order list filtered by the paid date of the later day, and in the order list filtered by the creation date of the earlier one. `newUserCount` uses the user's creation time and `newSellerCount` the store's (the moment of approval).
- `paidRevenueSatang` is an **aggregate** and can exceed 32 bits ([section 1.5](#15-money)). It is the **price of the goods only, without the shipping fee** (D-026, OQ-34): the sum of `itemsSubtotalSatang` over seller orders whose order is `PAID` and whose `fulfilmentStatus` is not `CANCELLED`. `PENDING` and `FAILED` orders contribute nothing (BR-21).
- `orderCount` counts **orders that are paid and not cancelled** (D-026, OQ-34): an order counts once when its `paymentStatus` is `PAID` and at least one of its seller orders is not `CANCELLED`. An order with only some stores' parts cancelled still counts as one order; an order whose every part is cancelled, and a `PENDING` or `FAILED` order, does not count.

`GET /admin/summary` (finding M11; REQ-A-01; D-028). In effect. All four groups, from real rows:

```json
{
  "data": {
    "pendingApplicationCount": 3,
    "pendingProductCount": 11,
    "userCount": 240,
    "storesByStatus": { "APPROVED": 18, "SUSPENDED": 1 },
    "orderCount": 420,
    "paidRevenueSatang": 31200000
  }
}
```

| Group (D-028) | Fields |
| --- | --- |
| Items waiting for review | `pendingApplicationCount`: seller applications with status `PENDING`. `pendingProductCount`: the size of the approval queue of [section 5.9.3](#593-product-moderation-and-contentrevision) (awaiting approval and published) |
| Users and stores | `userCount`: all users. `storesByStatus`: stores per status |
| Orders | `orderCount`: over all time, by the rule of the report (paid and not cancelled; D-026, OQ-34) |
| Sales | `paidRevenueSatang`: over all time, goods only, by the rule of the report. An **aggregate** ([section 1.5](#15-money)) |

Audit entry: `{ id, actorId, action, targetType, targetId, metadata, createdAt }`. `metadata` holds the reason and a before and after summary. No request edits or deletes an entry, and an entry never contains a session token, a password hash, an IP address, or browser details.

#### 5.9.8 As built (T-050, 2026-10-23)

Implemented: the twenty-six endpoints of sections 5.9.1 to 5.9.7, in `src/modules/admin` (schema, state table, errors, repository, mapping, service; public surface `@/modules/admin`) and the handlers under `src/app/api/v1/admin/`. The schemas, constants, and types in `src/modules/admin/schema.ts` are authoritative. The moderation decision table is `MODERATION_DECISION_RULES` in `src/modules/admin/state.ts`; the store table stays `STORE_TRANSITIONS` (`src/modules/sellers/state.ts`) and the fulfilment table `FULFILMENT_TRANSITIONS` (`src/modules/orders/state.ts`, the actor `ADMIN` rows). The two application decisions are the T-040 services of `@/modules/sellers`, exposed unchanged. Unit tests next to the module (`src/modules/admin/*.test.ts`), one route test for every handler (`src/app/api/v1/admin/admin-routes.test.ts`), and `tests/integration/admin/endpoints.test.ts` against PostgreSQL (30 cases, passed on 2026-10-23: every endpoint for guest, customer, seller, and suspended seller; unknown ids; page size 51; and the behaviour below). **Not security-reviewed, not code-reviewed.** The 23 route files are not yet on the route list guard of `tests/security/t020-t018-catalog-shell.test.ts` (security adds them after review), so `pnpm test` fails on that one case until then. No endpoint here is rate-limited ([section 6](#6-rate-limits-initial-values-tune-after-testing) lists none).

**Order of checks** ([section 1.8](#18-access-levels-and-404-against-403)); every response is `Cache-Control: no-store`.

| Endpoints | Steps |
| --- | --- |
| Every `GET` | 3 session (401), 4 role `ADMIN` (403 `FORBIDDEN` for a customer and for a seller of any store status), 7 path parameter and query (400), then the service (404). `GET /admin/settings` and `GET /admin/summary` read no query |
| Every mutation with a body (`reject` of an application, `suspend`, `reinstate`, the three moderation decisions, `POST` and `PATCH /admin/categories...`, `POST /admin/seller-orders/{id}/status`, `PATCH /admin/settings`) | 1 `Origin` (403), 2 `Content-Type` (415), 3 session (401), 4 role `ADMIN` (403 `FORBIDDEN`, before the body is read), 6 body (413), 7 path parameter and body (400), then the service (404, then 409) |
| Every mutation without a body (`deactivate`, `reactivate`, `approve` of an application, `DELETE /admin/categories/{id}`) | 1, 2, 3, 4 as above, 7 path parameter (400), then the service. The body is never read ([section 1.2](#12-mutations-without-a-body)) |

The service checks the role `ADMIN` again first, before any query (TM-07): a route that forgot its own check still answers `403` and reads nothing.

**Responses.**

| Endpoint | Success | Refusals beyond the steps, in this order |
| --- | --- | --- |
| `GET /admin/users` | `200`, list of `AdminUserDto`, newest first (`createdAt`, `id`) | |
| `POST /admin/users/{id}/deactivate` | `200`, `AdminUserDto` after the change | `404`; `409 CONFLICT SELF_DEACTIVATION`; `409 INVALID_STATE_TRANSITION` (already inactive); `409 CONFLICT LAST_ADMIN` |
| `POST /admin/users/{id}/reactivate` | `200`, `AdminUserDto` | `404`; `409 INVALID_STATE_TRANSITION` (already active) |
| `GET /admin/applications` | `200`, list of `AdminApplicationDto`, oldest first (`createdAt`, `id`) | |
| `POST /admin/applications/{id}/approve`, `/reject` | `200`, `ApplicationDecisionDto` of `@/modules/sellers` (`{ application: { id, userId, status, reviewNote, reviewedAt }, store: { id, name, slug, status } \| null }`) | As in [section 5.9.2](#592-applications-and-stores) |
| `GET /admin/stores` | `200`, list of `AdminStoreDto`, newest first (`createdAt`, `id`) | |
| `POST /admin/stores/{id}/suspend`, `/reinstate` | `200`, `AdminStoreDto` after the change | `404`; `409 INVALID_STATE_TRANSITION` |
| `GET /admin/products` | `200`, list of `AdminProductDto`; the queue oldest submission first (`moderationRequestedAt`, `id`), any other list newest first (`createdAt`, `id`) | |
| `GET /admin/products/{id}` | `200`, `AdminProductDto` | `404` |
| `POST /admin/products/{id}/approve`, `/reject`, `/takedown` | `200`, `AdminProductDto` after the decision | `404`; `409 CONFLICT STALE_REVISION`; `409 INVALID_STATE_TRANSITION` (item 8.2-6 closed: revision first) |
| `GET /admin/categories` | `200`, list of `AdminCategoryDto`, by `sortOrder`, then `id` | |
| `POST /admin/categories` | `201`, `AdminCategoryDto` | |
| `PATCH /admin/categories/{id}` | `200`, `AdminCategoryDto` | `404` |
| `DELETE /admin/categories/{id}` | `200`, `{ "outcome": "DELETED" }` | `404`; `409 CONFLICT CATEGORY_HAS_PRODUCTS` |
| `GET /admin/orders` | `200`, list of `AdminOrderDto`, newest first (`createdAt`, `id`) | |
| `GET /admin/orders/{id}` | `200`, `AdminOrderDto` | `404` |
| `POST /admin/seller-orders/{id}/status` | `200`, the whole `AdminOrderDto` of the seller order's order, read after the commit | `404`; `409 INVALID_STATE_TRANSITION` |
| `GET /admin/settings`, `PATCH /admin/settings` | `200`, `SettingsDto` | |
| `GET /admin/summary` | `200`, `AdminSummaryDto` (the shape of section 5.9.7) | |
| `GET /admin/reports` | `200`, `ReportDto` (the shape of section 5.9.7) | |
| `GET /admin/audit-logs` | `200`, list of `AuditLogDto`, newest first (`createdAt`, `id`) | |

**Shapes**, exactly these keys:

- `AdminUserDto`: `{ id, name, email, phone, role, isActive, createdAt, store: { id, name, slug, status } | null }`.
- `AdminApplicationDto`: `{ id, applicant: { id, name, email, isActive }, storeName, description, contactPhone, status, reviewNote, reviewedAt, createdAt }`. `reviewNote` is `null` unless `REJECTED`.
- `AdminStoreDto`: the store item of section 5.9.2.
- `AdminProductDto`: `SellerProductDto` ([section 5.7.2.1](#5721-as-built-t-042-2026-10-20)) plus `contentRevision`, `moderationRequestedAt`, `store: { id, name, slug, status }`.
- `AdminCategoryDto`: the category item of section 5.9.4.
- `AdminOrderDto`: `OrderDto` ([section 5.5.2](#552-response); `paidAt` only on a paid order, BR-39; `cartReturn` as for the customer) plus `userId`, and on each seller order `storeId` and `commissionRateBps`. A failed order's parts carry `cancellationKind: "PAYMENT_FAILED"`, never `"REFUND_OUTSIDE_SYSTEM"` (BR-20).
- `SettingsDto`: `{ flatShippingFeeSatang, commissionRateBps, updatedAt, updatedById }`; `updatedById` is `null` until an admin first changes the row.
- `AuditLogDto`: the audit entry above; `metadata` is the stored JSON as written.

**Fields and queries** (item 8.2-7 settled for these endpoints, provisionally; see the choices below).

| Field | Rule |
| --- | --- |
| `{id}` | An opaque id, 1 to 200 characters, no U+0000, no lone surrogate ([section 1.4](#14-identifiers-slugs-and-order-numbers)) |
| `page`, `pageSize` | [Section 1.7](#17-pagination): `pageSize` 1 to 50 on every admin list; 51 is `400` |
| `q` (users, stores, products) | Trimmed, at most 100 characters; blank is the same as absent; matched case-insensitively anywhere as plain text (`%`, `_`, `\` are text). Users: name or email; stores: name; products: title |
| `role`, `status`, `moderationStatus`, `paymentStatus`, `fulfilmentStatus` | One of the enum values of [section 3](#3-shared-values-and-state) |
| `isActive` (users) | `true` or `false` |
| `queue` (products) | Only `true`; with `moderationStatus` or `status` it is `400` at path `queue` |
| `storeId`, `userId`, `actorId`, `targetId` (queries) | Opaque ids as `{id}` |
| `orderNumber` | 1 to 24 letters and digits, matched exactly |
| `from`, `to`, `paidFrom`, `paidTo` | Instants with `Z` or an offset ([section 1.6](#16-time)); half-open; the end must be later than the start (`400` at the end's path). `paidFrom` and `paidTo` must be given together (`400` at the missing one) |
| `action`, `targetType` (audit) | A word of letters, digits, and `_`, starting with a letter, at most 64 characters |
| `reason` | Multi-line, 1 to 500 characters after normalisation, the rule of the application reason ([section 5.9.2](#592-applications-and-stores)); blank is `400` |
| `contentRevision` | Integer, 1 to 2,147,483,647; a string or a fraction is `400` |
| `name` (category) | One line, trimmed, 1 to 100 characters, `NAME_ALLOWED_TEXT` |
| `sortOrder` (category) | Integer, 0 to 1,000,000 |
| `isActive` (category body) | A JSON boolean |
| `to` (seller order) | `CANCELLED` or `DELIVERED`; anything else is `400` |
| Settings | As in [section 5.9.6](#596-settings); at least one of the two |

Every body is strict: `role`, `status`, `slug`, `storeId`, `userId`, `isSample`, `moderationStatus`, `requireProductApproval`, `updatedById`, and every other key not listed is `400 unrecognized_keys`. An empty `PATCH` body is `400` (path `""`, code `custom`).

**Mechanism** (CLAUDE.md rule 5; DATA_MODEL.md sections 4.1, 4.2, 4.4, 4.5, 6.17, 7.3 to 7.8). Every mutation runs in one transaction that writes its `AuditLog` row; a refusal writes none. Inside a transaction every statement selects scalar fields only and is awaited alone (7.8). Every status column moves only by a guarded statement that names the expected current value; zero rows is a refusal.

- **Deactivate.** Read the target (404), self (`SELF_DEACTIVATION`), then lock: an admin target locks every active admin row `FOR UPDATE` in `COLLATE "C"` id order and is `LAST_ADMIN` when it is the only one left; any other target locks its own row `FOR NO KEY UPDATE`. Already inactive is `INVALID_STATE_TRANSITION`. Then `isActive` true to false, every `Session` row of the user deleted (the statement of `deleteSessionsOfUser`, which modules may not import, D-022), and the audit row. No order, store, product, or stock changes (BR-27).
- **Suspend, reinstate.** The `Store` row is locked `FOR NO KEY UPDATE`, so a seller write that holds its `FOR SHARE` lock (`requireApprovedStoreForWrite`) finishes first and the suspension then commits; the guarded update writes `status` and `statusReason`. Sessions are not ended (D-027).
- **Moderation.** The `Product` row is locked `FOR NO KEY UPDATE` (a seller edit holds `FOR UPDATE`, so the two queue); the revision, then the table, are judged on what is stored; the guarded update repeats `moderationStatus`, `contentRevision`, and for approve and reject `status = 'PUBLISHED'` (DATA_MODEL.md 7.6). Approve clears `moderationNote`; reject and takedown store the reason in it. `contentRevision` and `moderationRequestedAt` are not changed by a decision.
- **Categories.** A change locks the row `FOR NO KEY UPDATE` and writes only the fields that differ; switching `isActive` changes no product (BR-23, D-026 OQ-31). A delete locks `FOR UPDATE`, refuses when any product, archived ones included, references the category, and the `Restrict` key is the backstop (the same `409`). A seller's product write holds the category's `FOR SHARE` lock, so either waits for the other. A create picks the slug with `generateSlug` and retries only a collision on `Category_slug_key`, at most 3 times (then `500`).
- **Admin fulfilment move** (7.4). The `SellerOrder` row is locked `FOR UPDATE OF so` with its order's payment status read in the same statement; the move must be an `ADMIN` row of the fulfilment table, and any move on a seller order of a `FAILED` order is refused (BR-20 point 6). The guarded update takes its source states from the table and carries no store and no paid-order condition. `DELIVERED` sets `Shipment.deliveredAt`; `CANCELLED` claims and restores the stock of the items not yet restored (`claimAndRestoreStock` of the orders module, the same statement the seller cancel uses, products in `COLLATE "C"` order). The payment is not touched and no refund exists (BR-21). Lock order: `SellerOrder`, `OrderItem`, `Product`; the `Order` row is read, not locked, so a payment that fails afterwards finds the part cancelled and its items already claimed, and returns none of them to the cart (D-028).
- **Settings.** The single row is locked `FOR UPDATE`; only differing values are written, with the acting admin as `updatedById`. The row's CHECK constraints are the backstop of BR-28.
- **Reads.** Every list except the order list reads its count and its page in one read-only `REPEATABLE READ` snapshot; so do the product detail, the summary, and the report. The order list and the order detail carry nested relations and so run outside a transaction (DATA_MODEL.md 7.8), as the customer's history does: their `total` can differ from the rows by a write that lands between the two statements.
- **Summary and report figures** are the rules of BR-33 in SQL: `COUNT(DISTINCT so."orderId")` and `SUM(so."itemsSubtotalSatang")` over seller orders of `PAID` orders that are not `CANCELLED`; the report adds `o."paidAt" >= from AND o."paidAt" < to`. New users by `User.createdAt`, new sellers by `Store.createdAt`. Sums are 64-bit and sent only as safe integers.

**Audit rows** written by this module (`AuditLog.action`, `targetType`, `metadata`). The two application decisions write theirs in the sellers module (section 5.9.2).

| Action | Target type | `metadata` |
| --- | --- | --- |
| `USER_DEACTIVATED` | `User` | `{ role, before: { isActive }, after: { isActive }, sessionsRevoked }` |
| `USER_REACTIVATED` | `User` | `{ role, before: { isActive }, after: { isActive } }` |
| `STORE_SUSPENDED`, `STORE_REINSTATED` | `Store` | `{ reason, before: { status }, after: { status } }` |
| `PRODUCT_APPROVED`, `PRODUCT_REJECTED`, `PRODUCT_TAKEN_DOWN` | `Product` | `{ storeId, contentRevision, reason (reject, takedown), before: { moderationStatus, status }, after: { moderationStatus, status } }` |
| `CATEGORY_CREATED` | `Category` | `{ after: { name, slug, sortOrder, isActive } }` |
| `CATEGORY_UPDATED` | `Category` | `{ slug, before, after }` with only the changed fields |
| `CATEGORY_DELETED` | `Category` | `{ before: { name, slug, sortOrder, isActive } }` |
| `SELLER_ORDER_CANCELLED`, `SELLER_ORDER_DELIVERED` | `SellerOrder` | `{ orderId, storeId, paymentStatus, before: { fulfilmentStatus }, after: { fulfilmentStatus }, stockRestoredItems (cancel) }` |
| `SETTINGS_UPDATED` | `MarketplaceSettings` (target id `"1"`) | `{ before, after }` with only the changed values |

**Choices made in T-050 and not yet ruled** (each one constant or one line; a client may rely on the status and the code, not on these values):

- The paid-date range needs both ends: one end alone is `400` (REQUIREMENTS.md Q44 is open; nothing is built for a one-ended range).
- The paid-date filter's parameter names are `paidFrom` and `paidTo`, as instants like `from` and `to` (the presentation layer turns Bangkok calendar days into instants, [section 1.6](#16-time)).
- On the order list, `fulfilmentStatus` and `storeId` together match an order with **one** seller order that has both.
- The admin order list carries the full order shape with `paidAt` (Q42 (a), whether the list page shows it, is the owner's).
- `POST /admin/seller-orders/{id}/status` answers the whole order, not only the seller order.
- A `PATCH` of a category or of the settings in which nothing differs from the stored values writes nothing and writes no audit row, and answers `200` with the current row.
- A new category without `sortOrder` goes last (largest plus one, at most 1,000,000).
- Text and number bounds in the field table above (`q` 100, category name 100, `sortOrder` 0 to 1,000,000, `reason` 500 as for applications).
- Store and user lists newest first; application list oldest first (as section 5.9.2 says).
- No security event is logged for an admin action; the audit row is the record (SECURITY.md SR-04 permits one, nothing requires it).

### 5.10 Platform

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | public | Owned by devops (T-011); implemented. The details are below the table. |
| GET | `/api/files/{key}` | public | [Section 5.8](#58-uploads-and-files). |

**`GET /api/health`** (code-review finding CR-47; implemented in `src/app/api/health/route.ts` and `src/server/health.ts`). It answers whether the process is alive and whether the database answers a trivial query, and nothing else.

| Status | Body, complete | When |
| --- | --- | --- |
| `200` | `{ "status": "ok", "database": "up" }` | The database answered |
| `503` | `{ "status": "unavailable", "database": "down" }` | The database did not answer, or not within the time the check allows (2 seconds) |

- **Outside the envelopes of [section 2](#2-envelopes-and-errors).** The path is not under `/api/v1`. Neither body is wrapped: the `200` has no `data` key, and the `503` is **not** an error envelope of [section 2.2](#22-error-envelope): it has no `error` object, no `code`, no `message`, no `details`, and no `requestId` in the body, and `503` is not a status of [section 2.3](#23-error-codes). The two bodies above are the only ones; each has exactly those two keys, and no version, configuration, host name, or error text is ever added. A client decides by the status.
- **Headers, on both statuses:** `Cache-Control: no-store` and `X-Request-Id`. The response is never cached and never prerendered: every request runs the check.
- **The request id is always generated by the server** (a UUID). An `X-Request-Id` sent by the caller is never reused here, **even behind a trusted proxy**: this endpoint does not apply the exception of [section 1.1](#11-transport) ("Request id") and SECURITY.md SR-03, because it is public. The id is in the header only.
- Public, no session, no `Origin` or content-type check (a `GET`), no rate limit, and no request body is read. How an outage is logged is not part of this contract (SECURITY.md SEC-026; DEPLOYMENT.md, "Health endpoint").

## 6. Rate limits (initial values, tune after testing)

| Endpoint | Limit | Rule in `src/server/rate-limit.ts` |
| --- | --- | --- |
| Sign-in | 5 per minute per IP; 5 per minute per IP and email; 60 per 5 minutes per email over all addresses (SEC-032) | `sign-in-address`, `sign-in-email`, `sign-in-account` |
| Sign-up | 5 per hour per IP | `sign-up` |
| Checkout (`POST /checkout`) | 10 per minute per user | `checkout` |
| Uploads (`POST /seller/uploads`) | 30 per hour per user | `uploads` |
| Seller application (`POST /seller/application`) | 3 per day per user | `seller-application` |
| Review create (`POST /orders/{id}/items/{itemId}/review`) | 10 per hour per user | `review-create` |
| Product create (`POST /seller/products`) | 60 per hour per user (D-043 item 2; SEC-069). **Ruled, not built**, see below | `product-create` (planned) |
| Product publish (`POST /seller/products/{id}/publish`) | 60 per hour per user (D-043 item 2; SEC-069). **Ruled, not built**, see below | `product-publish` (planned) |

Decided by the orchestrator on 2026-10-11: "per IP" in this table means per client address as derived by security rule SR-01 in [SECURITY.md](SECURITY.md): an IPv4 address, an IPv6 /64 network, or the single shared subject `unknown` when no trusted proxy is configured. It is never taken from a header the client controls. With the default configuration all clients therefore share one per-address allowance.

Each line of the table is its own rule with its own counter (sign-in has three: per address, per address and email, and per email), so using up one limit never consumes another. A refused request gets `429 RATE_LIMITED` with `Retry-After`. A limit is applied at step 5 of the order in [section 1.8](#18-access-levels-and-404-against-403): after the caller is identified and the access level is judged (the role and, on a `seller` endpoint, the store status; D-032 point 1), and **before the body is read**. The limiter also refuses new subjects while a rule's in-process store is full (SR-02); that refusal is the same `429`, with a `Retry-After` of at most 60 seconds. The limiter is in-process and correct for a single instance only (D-012).

What the limits guarantee (D-032 point 2; SECURITY.md SR-05 item 5, "Rate limit"):

- **A request that reaches step 5 uses one allowance whatever happens to it afterwards** (`413`, `400`, `403`, `404`, `409`, or success). A later refusal is never a free attempt or a free body read.
- **A request refused at steps 1 to 4 uses none.** None of those steps reads a body. So a suspended seller's `POST /seller/uploads`, refused at step 4 with `403 SELLER_NOT_APPROVED`, does not count against `uploads`, and a customer's request to it, refused with `403 FORBIDDEN`, does not either.
- **A per-user limit is counted on the acting user of the session** and on nothing else; no header, body field, or query parameter changes the subject.
- **Sign-up and sign-in** are public and take a body from an anonymous caller. Their per-address limits (`sign-up`, `sign-in-address`) are consumed at step 5 by every request that passed steps 1 and 2, before a byte of the body is read and whatever the outcome (D-031 point 4). The body of these endpoints is read under the default limit of [section 1.1](#11-transport), also when it is the auth library that parses it.
- **The per-email limits of sign-in** (`sign-in-email` on the client address and the email, then `sign-in-account` on the email alone; SEC-032) cannot be at step 5, because the email is in the body. Their place is fixed: after the per-address limit allowed the request, after the body was read and the email validated and normalised, each only after the one before allowed the request, and **before the password is looked at**. Their refusal is the same `429 RATE_LIMITED` and does not say which rule refused; on sign-in the `Retry-After` is at most 60 seconds whichever rule refused (the `sign-in-account` window is 5 minutes, so a client that retries earlier may be refused again). They are counted on the email as typed (trimmed, lower-cased, NFKC), in the same way whether or not an account has that email. A request they refuse has already used the allowances before it and does not get them back. One address can therefore never use up the account-wide limit by itself: a wrong password from one address uses that address's allowance for the account.

**`product-create` and `product-publish` (D-043 item 2, 2026-10-20) are ruled but not built.** As ruled: each its own rule and counter, 60 requests per hour on the session's user id, applied at step 5 (after the role and an `APPROVED` store, before the body is read; publish has no body), a refusal `429 RATE_LIMITED` with `Retry-After` and a throttled security event, as for `uploads`. Not built because the limiter's rule set is full: the eight rules use the whole budget of 200,000 windows (SECURITY.md SR-02), so two new rules need capacity taken from other rules, which is a new SR-02 capacity split that security decides and records; the security tests pin the current rule list and split (`tests/security/sec050-recheck.test.ts`). Until then `POST /seller/products` and publish have no rate limit; the product limit of [section 5.7.2](#572-products) bounds what one store can hold.

**`uploads` is applied by `POST /seller/uploads` since T-041 (2026-10-19)**, on the session's user id, after the role and the store status and before the body is read; its refusal is written as a throttled security event; the integration tests show 30 requests allowed (accepted and refused alike), the 31st refused with `Retry-After` and its body unread, and 35 requests of a suspended store refused at step 4 without using the allowance. **`seller-application` is applied by `POST /seller/application` since T-040 (2026-10-14)**, on the session's user id, after the role check and before the body is read; its refusal is written as a throttled security event; the integration tests show three requests allowed (whatever their outcome) and the fourth refused with `Retry-After` and the body unread. **`checkout` is applied by `POST /checkout` since T-032 (2026-10-14)**, on the session's user id, after the access level and before the body is read; its refusal is written as a throttled security event (unit tests only so far). SEC-052 (one client can keep this rule's 10,000 windows full) is open with the owner. **Implemented for sign-up and sign-in (T-015, 2026-10-13); the remaining rules wait for their endpoints.** The limiter and the eight rules of the table exist in `src/server/rate-limit.ts` (`sign-in-account` added 2026-10-13 for SEC-032; its window capacity raised on 2026-10-14 from 10,000 to 50,000, taken from the four signed-in rules, for SEC-050 and D-038; no limit or window a client sees changed). `POST /auth/sign-up` and `POST /auth/sign-in` ([section 5.1](#51-auth)) are the only routes that create an account or check a password (the auth library's own handler is not mounted), and they apply `sign-up`, `sign-in-address`, `sign-in-email`, and `sign-in-account` as this section requires; the integration tests in `tests/integration/auth/limits-and-cookies.test.ts` show the 429 before the body is read, the per-account limit across addresses and for an unknown email with the same body and a `Retry-After` of at most 60 seconds, and that a request refused for its origin or content type uses no allowance (the SEC-032 cases were not yet run against the database on 2026-10-13). Item 8.2-9 is closed.

## 7. What changed from the earlier version

For consumers who read the earlier draft. Nothing was built against it.

| Before | Now |
| --- | --- |
| Store status could be read as including `PENDING` and `REJECTED`; "seller (any status)" | Store status is `APPROVED` or `SUSPENDED`; access levels of [section 1.8](#18-access-levels-and-404-against-403) |
| `/seller/orders*` needed an approved store | `seller (any store status)` |
| `minPrice`, `maxPrice` | `minPriceSatang`, `maxPriceSatang` |
| Some lists not marked as paginated | Every list paginated |
| Takedown with no target state | `moderationStatus: "TAKEN_DOWN"` |
| Moderation decisions with `{ reason }` only | `contentRevision` required on approve, reject, and takedown |
| "Moderation mode" in the settings | Removed; two settings with bounds |
| `paymentStatus` could be read as including `REFUNDED` | `PENDING`, `PAID`, `FAILED` only |
| Seller order `store: { name, slug }` | `storeName` (copy at purchase) and `storeSlug` |
| Shape of `details.items`, empty-cart code, failed-payment response undefined | [Sections 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought), [2.3](#23-error-codes), [5.5.4](#554-failed-payment) |
| No category delete, no product archive endpoint | `DELETE /admin/categories/{id}`, `POST /seller/products/{id}/archive` |
| `/admin/users/{id}/deactivate` and similar pairs on one line | One line per endpoint |
| Report range without a timezone | Two instants with an explicit offset |
| Content type on mutations without a body: open | Settled, [section 1.2](#12-mutations-without-a-body) |
| A suspended seller who sent an invalid body to a `seller` endpoint got `400 VALIDATION_ERROR`; the store status was first judged in the service, after the body was read and validated (the version of 2026-10-11, D-031 point 4) | `403 SELLER_NOT_APPROVED`, judged with the role before the rate limit and before the body is read; the service still checks again (D-032 point 1; [section 1.8](#18-access-levels-and-404-against-403)) |
| No limit on how deep a JSON body nests; a body that stops arriving not mentioned | At most 32 levels; a body that stops arriving is a client error, never a 500 ([section 1.1](#11-transport); both implemented on 2026-10-12, with one open point each: 8.2-12 and 8.2-13) |
| A surrogate half written as a `\u` escape was handed to the endpoint's schema as it was | A body that contains a string that is not well-formed Unicode is `400 VALIDATION_ERROR` ([section 1.1](#11-transport); implemented on 2026-10-12, its field code open with 8.2-12) |
| A cart held any number of lines; the mock provider answered in every environment | At most 50 distinct lines, `409 CONFLICT` `CART_LINE_LIMIT` on a new line and on checkout of a larger cart (SEC-053); the mock provider is refused with `NODE_ENV=production`, checkout `500` with nothing written (SEC-056); both owner decisions of 2026-10-22, [sections 5.4](#54-cart) and [5.5.5](#555-as-built-t-032-2026-10-14) |
| `GET /api/health`: "`{ "status": "ok", "database": "up" }` or 503" | Both bodies, the headers, and that the endpoint is outside the error envelope and never reuses a client request id ([section 5.10](#510-platform)) |

## 8. Open points

The owner's answers in D-025, D-026, and D-028 and the rulings in D-029, D-031, and D-032 are written into this contract as rules. Every open item below has an id (`8.1-n`, `8.2-n`) so that other documents can cite it. The ids are stable: an item keeps its id when the table is reordered, and the id of a closed item is not given to another. OQ-20 (visual details on real pages) is still open with the owner and no point of this contract depends on it. OQ-45 and OQ-46 belong to ui-ux-design and frontend; OQ-47 to OQ-50 (log and backup retention, session expiry) touch no endpoint: nothing here exposes logs, backups, or another user's session data.

### 8.1 `OPEN (owner)`

**No point waits for the owner.** Item 8.1-1 was answered in D-033 point 4 and stays listed until the seller and admin shapes carry the paid time.

| Id | Question for the owner | Why it arises | What the contract does meanwhile | Section |
| --- | --- | --- | --- | --- |
| 8.1-1 | **Answered by the owner (D-033 point 4, Q40): yes to both. Built in all three shapes** | The time is stored (`Order.paidAt`, DATA_MODEL.md section 6.10) and the report places an order in its range by it | The customer's order shape carries `paidAt` since T-032 ([section 5.5.2](#552-response)), the seller order shape since T-043 ([section 5.7.3](#573-seller-orders)), and the admin order shape with the paid-date filter of BR-40 since T-050 ([section 5.9.8](#598-as-built-t-050-2026-10-23)). Open with the owner, not with this item: REQUIREMENTS.md Q42 (does the admin list show it) and Q44 (a range with one end) | 5.5.2, 5.7.3, 5.9.5, 5.9.7, 5.9.8 |

Two further questions are parked with the owner in STATUS.md and are **not** open points of this contract, because the contract's behaviour does not wait on them: the Thai text on a hidden cart line (REQUIREMENTS.md Q38; the API carries `unbuyableReason: "NOT_AVAILABLE"`, never the text), and the confirmation that "view only" for a suspended store also refuses editing the store profile, uploading, and deleting a product ([section 5.7.2](#572-products) follows that shared reading; if the owner allows any of the three, its entry changes).

The six points this section listed earlier were answered in D-028 and are now rules:

| Point | Decided (D-028) | Section |
| --- | --- | --- |
| What a seller with a suspended store may do besides handling orders | View only: own store, products, and summary. Every write is refused until the store is reinstated | 5.7.1, 5.7.2 |
| Which figures the admin dashboard summary shows | All four groups; the shape is in effect | 5.9.7 |
| May a seller change the store's contact phone | Yes, without approval | 5.7.1 |
| What counts as a "correction" that resubmits a rejected or taken-down product | A change to title, description, category, the set of pictures, or the price. Not stock, SKU, or picture order | 3.3 |
| Items of a store's part cancelled before the payment failed | They do not return to the cart | 5.5.4 |
| Is a published product awaiting approval "on sale"; is a product hidden by a suspended store or a switched-off category counted | Not on sale; still counted | 5.7.2, 5.7.4 |

### 8.2 `OPEN (technical)`

| Id | Point | Settled by | Section |
| --- | --- | --- | --- |
| 8.2-1 | **Blind resend of a refused checkout.** It cannot be told from the customer's confirmation, because a refused checkout records no key; today only the client rule prevents an order with a quantity the customer has not seen. A guard on the server would be an additive migration (a stored refusal, a cart revision, or a confirmation value) and a contract change. No outcome is decided | backend-api and security, before T-032 starts (D-031 point 6) | 5.5.3 |
| 8.2-2 | **Closed by T-032 (2026-10-14): the savepoint.** One transaction under the cart lock; the stock statements run inside a savepoint and a refusal rolls back to it, then stores the lowered quantities and commits ([section 5.5.5](#555-as-built-t-032-2026-10-14)). Behaviour under concurrency is to be shown by T-033 | T-032 | 5.5.1, 5.5.3, 5.5.5 |
| 8.2-3 | **Closed by T-032 (2026-10-14): no "try again" answer.** The savepoint shape re-reads the cart's state inside the same lock and tries the stock again, at most 3 times; a request that still cannot settle is `500` with nothing stored. No code is added to section 2.3 | T-032 | 2.3, 5.5.1, 5.5.5 |
| 8.2-4 | **Closed by T-032 (2026-10-14).** Any UUID version, 36-character hyphenated form, either letter case; stored and compared lower-cased ([section 1.3](#13-the-idempotency-key-header)) | T-032 | 1.3 |
| 8.2-5 | **Closed on the API side by T-032 (2026-10-14).** Exactly `SIMULATED_DECLINE` and `TIMEOUT` are written (`PAYMENT_FAILURE_REASONS`); a stored value outside the list is answered as `null` ([section 5.5.2](#552-response)). Open for the database agent only: whether `Payment.failureReason` gets a check constraint (an additive migration) | database (the constraint, optional) | 5.5.2, 5.5.4 |
| 8.2-6 | **Closed by T-050 (2026-10-23).** When the `contentRevision` **and** the state both differ from what the decision needs, the revision is compared first: `409 CONFLICT` with `STALE_REVISION` (`judgeModerationDecision` in `src/modules/admin/state.ts`). The admin's screen is out of date either way, and the answer that says "reload" is the useful one | T-050 | 5.9.3, 5.9.8 |
| 8.2-7 | Text length limits that no requirement states | Each endpoint's task | 4 |
| 8.2-8 | Storage key pattern; caching of file responses; whether an upload request may carry more than one file; what an extra form field on the upload request (for example `storeId`) does, since the strict-object rule of section 1.1 is written for JSON bodies. **Built provisionally by T-041 (2026-10-19), not ruled:** 32 lower-case hexadecimal digits; `no-store`; one file; an extra field is `400 unrecognized_keys`; and a new field code `invalid_multipart` for a body whose framing cannot be read ([section 5.8.1](#581-as-built-t-041-2026-10-19)) | T-041, with security: a ruling by security on the built values | 5.8, 5.8.1 |
| 8.2-9 | **Closed by T-015 (2026-10-13).** The library's handler is not mounted; the auth routes are the application's own, with the paths and shapes of section 5.1, and follow section 1 in full. Both sign-in limits and the bound on the body read are on the two routes that check a password or create an account (section 6) | T-015 | 1.8, 5.1, 6 |
| 8.2-10 | `CART_EMPTY` is in the code since T-032. `OPEN_APPLICATION` and `APPLICANT_NOT_CUSTOMER` are in the code since T-040, `APPLICANT_INACTIVE` since D-040, `STORE_NAME_TAKEN` and `STORE_NAME_RESERVED` since D-041 (`src/modules/sellers/errors.ts`). `SELF_DEACTIVATION`, `LAST_ADMIN`, `STALE_REVISION`, and `CATEGORY_HAS_PRODUCTS` since T-050 (`src/modules/admin/errors.ts`). The other `CONFLICT` reasons are contract only until their tasks add them to the code. Since 2026-10-12 `conflict(reason)` requires a reason of the right form (CR-02), but it does not know the list: a reason that is well formed and not in section 2.3 is not refused by the code | T-031, T-032, T-042, T-050 | 2.3 |
| 8.2-11 | One convention is contract only until the code follows; it is not undecided. (a) The order of refusals is ruled (D-031 point 4 as amended by D-032 point 1) and the handler pattern in `src/server/http.ts` shows it since 2026-10-12 (CR-09). The guards exist since T-015 (2026-10-13), and the auth routes (T-015) and the catalog reads (T-020) apply the order for their access levels ([section 1.8](#18-access-levels-and-404-against-403), "As built"); no handler of access `seller` or `admin` exists yet, so the role helper and the store-status helper are called by no handler. Built on 2026-10-12 in the `src/server` follow-up, and re-checked by security the same day together with the pattern (SEC-022 to SEC-024 fixed; commit `6259d32`): (b) `invalid_json` for a body that is not valid UTF-8 (SEC-022); (c) the nesting limit of 32 levels (SEC-023; its field code is provisional, 8.2-12); (d) a body that stops arriving answered as a client error (SEC-024; its status and code are provisional, 8.2-13). Built on 2026-10-12 afterwards and awaiting the security re-check: (e) a body that contains a string that is not well-formed Unicode is refused (SEC-028; its field code is provisional, 8.2-12) | (a) the guards: done in T-015; their use: each `seller` and `admin` endpoint's task. Security re-checks (e) | 1.1, 1.8, 1.10 |
| 8.2-12 | **The `code` of the field error for a JSON body nested more than 32 levels deep.** The status and the error code are fixed: `400 VALIDATION_ERROR`, nothing echoed (SECURITY.md SR-05 item 12). The `code` inside `details.fields`, and whether the `path` is the empty string as for `invalid_json`, are not: SR-05 item 12 leaves the field code to backend-api and none is chosen. Candidates: reuse `invalid_json`, or a code of its own. **Still not ruled.** The `src/server` follow-up of 2026-10-12 built the first candidate as a **provisional** answer, because it adds no public code: `path` `""`, `code` `invalid_json`, and a message of its own (section 1.1). It is one constant, `JSON_TOO_DEEP_FIELD_CODE` in `src/server/errors.ts`, so a ruling for the other candidate is a one-line change. A client may rely on the status and on `VALIDATION_ERROR` only. **The same ruling settles a second field code:** that of a body that parses but contains a string that is not well-formed Unicode (section 1.1; SEC-028). The orchestrator ruled on 2026-10-12 that such a body is refused with `400 VALIDATION_ERROR` and that its field code follows whatever this item decides for a body that is valid JSON and refused all the same; until then it reuses `invalid_json` with `path` `""` and a message of its own. It is a constant of its own, `JSON_STRING_NOT_WELL_FORMED_FIELD_CODE` in `src/server/errors.ts`, so the ruling may give the two cases one code or two, and each is a one-line change | A ruling by the orchestrator with security, before the first handler that reads a JSON body is merged (D-032 point 4); the ruling is written into section 1.1 and is a contract change (section 10) | 1.1, 1.10, 2.3 |
| 8.2-13 | **The status and the error code for a body that stops arriving** (the connection is lost, the request is aborted, or the body ends before its declared length), for a JSON body and for the upload. Fixed: a client error, with a status below 500 and never `500 INTERNAL_ERROR`, and nothing of the part that arrived kept or echoed (SECURITY.md SR-05 item 10). Not fixed by any document: which status and which code. Section 2.3 reserves no code for it. Candidates: `400 VALIDATION_ERROR`, or a code of its own, which would be a new row in section 2.3. **Still not ruled.** The `src/server` follow-up of 2026-10-12 built the first candidate for JSON bodies as a **provisional** answer, because it adds no public code: `400 VALIDATION_ERROR` with one field error, `path` `""`, `code` `invalid_json`, and a message of its own (section 1.1). It is one constant, `ABORTED_BODY_ERROR_CODE` in `src/server/errors.ts`, so a ruling for another existing code is a one-line change (a new code also needs its row in `ERROR_STATUS`). Not settled by the provisional answer: the field error under `VALIDATION_ERROR`, since `invalid_json` does not fit a multipart body. A client may rely only on the status being below 500 | A ruling by the orchestrator with security, before the first handler that reads a JSON body is merged (D-032 point 4); the upload reader follows the same answer in T-041. A new code is a contract change (section 10) | 1.1, 2.3, 5.8 |
| 8.2-14 | **Relation loads inside an interactive transaction** (code-review finding CR-82, 2026-10-13; not reproduced against a database). Prisma 7.10 with `@prisma/adapter-pg` sends the relation loads of one query (for example a product with its pictures, store, and category) at the same time on the single `pg` client of an interactive transaction. `pg` 8.23.1, the version in the lockfile, queues them, so the result is correct, and prints one `DeprecationWarning` ("Calling client.query() when the client is already executing a query"); `pg` 9 removes the queueing, and such a transaction would then fail. Not a contract change: no response, status, or code depends on it. The catalog runs no transaction ([section 5.2.1](#521-as-built-t-020-2026-10-13), "Consistency"). The rule for the endpoints that must (CLAUDE.md rule 5: cart writes, checkout, stock, status transitions, admin actions with an audit row): inside `db.$transaction(async (tx) => ...)`, a query selects scalar fields only, or its relations are loaded by separate statements awaited one after the other, unless `relationLoadStrategy: "join"` has been evaluated and adopted; two `tx` queries are never started together (`Promise.all` on `tx` is not used). Owned elsewhere. Done (database, commit `1960ac3`): `pg` is pinned to major 8 by the override `pg: "^8"` in `pnpm-workspace.yaml` (resolved 8.23.1 in `pnpm-lock.yaml`; the project does not depend on `pg` directly), and the rule is recorded in [DATA_MODEL.md section 7.8](DATA_MODEL.md#78-relation-loads-inside-an-interactive-transaction-cr-82). **Not done**: an integration test that fails when a transaction with a nested select prints the warning (CR-82 d, needs the database) | database (the integration test) before T-031 starts; backend-api applies the rule in T-031 and T-032 | 5.2.1, 5.4, 5.5 |

Closed since the earlier version: telling the customer later that a returned quantity was cut (not required, D-028; the record is on the order item and `cartReturn` is filled from it), which request stores a lowered cart quantity (D-029), whether a pure reorder raises `contentRevision` (it does not, DATA_MODEL.md section 4.2), whether a price-only resubmission raises it (it does, D-031 point 2), whether an amount in a body is refused or dropped (refused, D-031 point 3), where validation falls in the order of refusals (D-031 point 4), where the store status of a `seller` endpoint is first judged (at step 4, before the body is read; D-032 point 1), where the per-email limit of sign-in is applied (section 6; SECURITY.md SR-05 item 5), the answer to a quantity change on a hidden cart line (`409 PRODUCT_UNAVAILABLE`, [section 5.4](#54-cart)), and the column for the time an order was paid (`Order.paidAt` exists, DATA_MODEL.md section 6.10; what remains is the owner question 8.1-1).

### 8.3 Disagreements between documents

**None that needs a decision.** Every disagreement this section listed earlier is ruled on: picture reordering (D-026, OQ-35), what counts as a correction and which items return to the cart (D-028), where a lowered quantity is stored and `storeId` in a seller body (D-029), `contentRevision` on a price-only resubmission, amounts in a body, the order of refusals, and the mechanism of the refused checkout (D-031), and where the store status of a `seller` endpoint is first judged, on which SECURITY.md SR-05 item 5 and section 1.8 of this contract differed (D-032 point 1, for SR-05; section 1.8 now follows it). The `REFUNDED` value and the "creates or activates" wording are no longer in REQUIREMENTS.md.

The wording difference this section noted earlier is gone as well (checked on 2026-10-12): REQ-S-09 in REQUIREMENTS.md no longer speaks of "pending, rejected, or suspended sellers". It now names a user with a pending or a rejected application as "still a customer" who "owns no store", which is what DATA_MODEL.md section 4.1 and sections 1.8 and 3 of this contract say.

Places where another document has only not been updated yet are not disagreements; they are in [section 8.4](#84-documents-that-do-not-yet-match-the-decisions).

### 8.4 Documents that do not yet match the decisions

Checked again on 2026-10-11, after the cross-document check, against the files as they stood in the working tree. **Every row this section listed earlier is resolved** and has been removed: REQUIREMENTS.md, DATA_MODEL.md, and TEST_STRATEGY.md now state D-026, D-028, and D-029 at each of the fourteen places that were named here (among them `Order.paidAt` in DATA_MODEL.md section 6.10, the 15-minute timeout, the `status = 'PUBLISHED'` guard of DATA_MODEL.md section 7.6, and the K5 and cart-read cases of TEST_STRATEGY.md).

Checked again on 2026-10-12, for D-032, against the files as they stood in the working tree. What lags now comes from D-031 and D-032, which are newer than those documents. Each row is for its owner to change; none is a choice left to make.

Removed on 2026-10-12 after the `src/server` follow-up: the row for the handler pattern in the file comment of `src/server/http.ts`, which now shows the order of section 1.8 (CR-09). Added by the same follow-up: the SECURITY.md row for SR-05 "Status" and SEC-022 to SEC-024.

Removed on 2026-10-12 after the security re-check (round 6; commit `6259d32`), each checked against SECURITY.md as it stands: the row for SR-05 "Status" and SEC-022 to SEC-024 (the three findings are `FIXED (re-checked 2026-10-12)` with their evidence, "Status" says items 10, 11, and 12 are implemented and re-checked and that the handler pattern shows the ten steps, the summary of the register counts them as fixed, and the two pinned tests were rewritten by security), and the row for SR-05 item 5 (steps 4 and 8 of its table read "**Approved** (D-032 point 1; section 1.8 states it this way since 2026-10-12)", and none of the four remarks that row quoted is in the file any more). Added the same day: the SECURITY.md row for SEC-027 and SEC-028.

Removed on 2026-10-12 because the other document now says what the decision says: DATA_MODEL.md section 6.6 (it names the price-only resubmission and cites D-031 point 2); REQUIREMENTS.md REQ-C-11 (an amount "is never used, and a request that carries one is refused", citing D-031 point 3); the STATUS.md half of the blind-resend row (it says "8.2-1"); and the SECURITY.md half of the D-031 point 4 row (SR-05 item 5 was rewritten as the ten steps of section 1.8, and its earlier wording is withdrawn there).

| Decision | Document and place | What it still says |
| --- | --- | --- |
| D-031 points 2 to 5, D-032 point 1, and this contract's sections 1.8, 5.4, and 8 | TEST_STRATEGY.md, questions T2, T3, T5, T6, T7, and T11 | Each quotes text of this contract that is now corrected and lists the point as unsettled. T2, T6, T7, and T11 are settled here; T5 is settled for the outcome and remains for the mechanism (8.2-2, 8.2-3); T3 is now the owner question 8.1-1, and its remark that sections 8.2 and 8.4 of this contract deny the `paidAt` column no longer holds |
| D-032 point 1: the store status is judged before the body is read | TEST_STRATEGY.md, question T11 and the "Suspended seller" row | T11: "No case sends a request that is both" invalid and not permitted. The case D-032 makes testable is missing: a suspended seller who sends an invalid body to a `seller` endpoint gets `403 SELLER_NOT_APPROVED`, not `400`. Its other statements agree (403 before 404; an upload from a suspended store stores nothing) |
| D-032 point 4; SECURITY.md SR-05 items 10 to 12 | TEST_STRATEGY.md | No case for a JSON body that is not valid UTF-8, for one nested more than 32 levels deep, or for a body that stops arriving. The last two wait on 8.2-12 and 8.2-13 for the code, not for the status class |
| The ruling of 2026-10-12 on SEC-028 (section 1.1, "Strings that are not well-formed Unicode") and the fixes of SEC-027 and SEC-028 in `src/server` | SECURITY.md: SR-05 item 11 and "Status"; the findings SEC-027 and SEC-028; the summary of the register | Item 11 speaks of bytes only and does not yet say that a string that is not well formed is refused in `readJsonBody` (the remediation of SEC-028 says item 11 "is extended to say so when the choice is made"); "Status" lists both under "Open beside them"; both findings are `OPEN` with "Re-check evidence: none yet", and the summary counts them as open. The code now does what both remediations ask; the findings stay open until the security agent has re-checked them |
| The id of the blind-resend item | TEST_STRATEGY.md, "Planned, outcome not yet ruled" | "the blind-resend point of its section 8.2"; the item is 8.2-1 |
| D-031 point 4 and D-032 points 1 and 2 | ARCHITECTURE.md, "Request flow for a mutation" | Step 1 applies the rate limiter before the caller is known, step 2 parses the body, and only step 3 calls `requireActor`. Under the rulings identity and the access level come before the rate limit, and all three before the body is read |

## 9. Review findings resolved here

| Finding | How | Section |
| --- | --- | --- |
| B3 | Store status is `APPROVED` or `SUSPENDED`; access levels redefined; a pending or rejected applicant is a `CUSTOMER` with only the application endpoints | 1.8, 3, 5.7.1, 5.9.2 |
| B4 | Seller order endpoints no longer require an approved store | 5.7.3, 5.9.2 |
| B5 | On payment failure the seller orders become `CANCELLED`; stock is restored once; the response of a later cancel is defined | 3.2, 5.5.4, 5.9.5 |
| S4 | One rule: the whole checkout is refused; one error shape naming every line | 5.4, 5.5.3 |
| S5 | `TAKEN_DOWN`; the way out of `REJECTED` and `TAKEN_DOWN`; moderated fields; no approval switch | 3.3, 5.9.3, 5.9.6 |
| S7 | Order pictures are copies by reference to an immutable upload; no endpoint deletes an upload | 5.5.2, 5.8 |
| S8 | Uploads have an owner; keys are attached through `imageKeys` and `logoKey` with an ownership check; orphans are cleaned up | 5.7.1, 5.7.2, 5.8 |
| S9 | No promotion endpoint; `role` is never accepted | 5.1, 5.9.1 |
| S11 | Slug rules for Thai titles, duplicates, and renames | 1.4 |
| S12 | `orderNumber` is database-assigned, unique, opaque | 1.4 |
| S13 | `minPriceSatang`, `maxPriceSatang` | 1.5, 5.2 |
| S14 | The 404 rule applies to every endpoint; BR-16 has a code and a reason | 1.8, 2.3, 5.4, 5.5.3 |
| S15 | Aggregate satang fields are documented as able to exceed 32 bits | 1.5, 5.7.4, 5.9.7 |
| M1 | `payment.isSimulated` and `paymentMethod` are derived from or mapped to `payment.provider` | 1.9, 5.5.1, 5.5.2 |
| M5 | Every list endpoint is paginated | 1.7 and every table |
| M9 (timezone) | Ranges are two instants with an explicit offset; UTC in, UTC out | 1.6, 5.9.7 |
| M11 | Category delete; default address; empty-cart code; failed-payment response; admin list filters; add-to-cart above stock and of a sold-out product (D-026, OQ-28). The `/admin/summary` contents are the four groups of D-028 | 5.9.4, 5.3, 2.3, 5.5.4, 5.9, 5.4, 5.9.7 |

The status of each finding is recorded in the register, not here.

## 10. Change process

A contract change after a consumer has started integrating needs an entry in [DECISIONS.md](DECISIONS.md) and a note to the affected agent. Adding an error code or a `CONFLICT` reason, changing an access level, and resolving an `OPEN` point in this document are contract changes.
