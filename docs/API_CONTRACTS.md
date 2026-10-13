# API Contracts

Owner: backend-api agent. This is the **planned** contract, corrected on 2026-10-11 after the T-004 planning review ([reviews/T-004-findings.md](reviews/T-004-findings.md)) the owner answers in [DECISIONS.md](DECISIONS.md) D-025, D-026, and D-028, and the technical rulings in D-029, and corrected again the same day after the cross-document check, for the technical rulings in D-031, and on 2026-10-12 for D-032 (the store status is judged before the body is read; SECURITY.md SR-05 item 5). **Implemented so far: the six catalog endpoints of [section 5.2](#52-catalog) (T-020, 2026-10-13) and `GET /api/health` ([section 5.10](#510-platform)); every other endpoint is planned.** Once an endpoint is built, the Zod schemas in `src/modules/<domain>/schema.ts` are authoritative for it and this document must match them.

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

**`OPEN (technical)`, to settle in T-032 before the checkout handler is written.** This is the second point left open by T-019, and the documents and code do not determine it: which UUID versions are accepted, and what the "one normalised form" is (in particular whether letter case matters when two keys are compared). No helper reads the header yet. Proposal by backend-api, **not in effect**: accept the 36-character hyphenated form of any UUID version (`^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`), lower-case it, and store and compare the lower-case form.

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
- **As built (2026-10-13).** Ten handlers exist: the four auth routes of T-015 ([section 5.1](#51-auth)) and the six catalog reads of T-020 ([section 5.2.1](#521-as-built-t-020-2026-10-13)). The auth routes apply this order for what they are: sign-up and sign-in are `public` mutations (steps 1, 2, 5, 6, 7), sign-out is a `user` mutation without a body (steps 1, 2, 3), and the session read is a `public` `GET`. The catalog reads are `public` `GET`s (step 7, then the service). No handler of access `seller` or `admin` exists yet, so steps 4 and 8 are applied by nothing so far. In detail:
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
| Body size | `readJsonBody(request, { maxBytes })` (`http.ts`): default `DEFAULT_JSON_BODY_LIMIT_BYTES`, ceiling `MAX_JSON_BODY_LIMIT_BYTES`; a larger `maxBytes` throws. The upload limits belong to the upload task | Implemented for JSON; uploads planned |
| JSON body | `readJsonBody(request)` (`http.ts`), `invalidJsonBody` (`errors.ts`) | Implemented, all in [section 1.1](#11-transport): a body that is not valid JSON; a body that is not valid UTF-8 (strict decoding; SEC-022); the nesting limit of 32 levels (`MAX_JSON_NESTING_DEPTH`, `jsonBodyTooDeep`; SEC-023; its field code is **provisional**, 8.2-12); a body that stops arriving answered as a client error (`requestBodyAborted`, `RequestBodyAbortedError`; SEC-024; its status and code are **provisional**, 8.2-13). Those three were built on 2026-10-12 and re-checked by security the same day (SEC-022 to SEC-024 fixed; commit `6259d32`). Also built on 2026-10-12: a string that is not well-formed Unicode is refused (`jsonStringNotWellFormed`; SEC-028; its field code is **provisional**, 8.2-12), and the two labels logged for a body that stops arriving are kept only in the form of a class name and of an error code (SEC-027; not a contract matter). These two await the security re-check |
| Order of refusals ([section 1.8](#18-access-levels-and-404-against-403)) | The handler pattern documented in `http.ts`; the guards belong to auth (`src/server/auth/**`): `requireActor`, the role helper, and the helper that judges the store status (D-032 point 1) | The documented pattern follows section 1.8 since 2026-10-12 (code-review finding CR-09; re-checked by security the same day, commit `6259d32`). The guards are implemented (T-015, `src/server/auth/session.ts` and `actor.ts`) and the four auth routes apply the order ([section 5.1](#51-auth)); the protected endpoints of later tasks apply it as they are built |
| Required headers | `invalidHeader(name, message)` (`errors.ts`) builds the error. Reading and checking `Idempotency-Key` itself is part of the checkout task (T-032) | Error mapping implemented; the header check is planned |
| Envelopes, error codes, caching | `ok`, `created`, `paginated`, `errorResponse`, `parseInput` (`http.ts`); `AppError` and the code table (`errors.ts`); `conflict(reason)` requires the reason and puts it in `details.reason` | Implemented, except the code marked "planned" in [section 2.3](#23-error-codes). Not a contract matter, noted for operators: `errorResponse` logs an error's class name, status, and code only (`describeErrorForLog`, `errors.ts`), never its message or stack, for every unexpected error, library and Prisma errors included (SECURITY.md SEC-048, SR-04; 2026-10-13) |
| Rate limits | `rateLimiter.consume(subject, RATE_LIMITS.<RULE>)` (`rate-limit.ts`) | Limiter implemented; the sign-up and sign-in routes call it (`sign-up`, `sign-in-address`, `sign-in-email`; T-015) |

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
| 409 | `CART_EMPTY` | Checkout with no cart, or a cart with no lines (D-023 point 3) | `{}` | **Planned**: not in `errors.ts` yet; added with T-032 |
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
| POST | `/auth/sign-up` | public | Body `{ name, email, password }`. Creates a `CUSTOMER`; does not sign in. Rate-limited per address (`sign-up`). |
| POST | `/auth/sign-in` | public | Body `{ email, password }`. Sets the session cookie. Rate-limited per address and per email. |
| POST | `/auth/sign-out` | user | No body. Deletes the session on the server and clears the cookie. |
| GET | `/auth/session` | public | The caller's actor, or `null`. Writes nothing. |

**`POST /auth/sign-up`.** Strict body (section 1.1): `name` (trimmed, 1 to 100 characters, no control character), `email` (trimmed, at most 254 characters, a valid address; stored lower-cased), `password` (8 to 128 characters, checked on the server). Any other key, `role`, `isActive`, `phone`, `storeId`, `userId`, `emailVerified`, and `image` included, is `400 VALIDATION_ERROR` and nothing is created. The new user is an active `CUSTOMER`.

- `200 { "data": { "accepted": true } }`, no cookie, **both** for a new email and for an email that already has an account; for the latter nothing is created or changed (SECURITY.md TM-03). The client signs in next with `POST /auth/sign-in` (REQUIREMENTS REQ-C-01 asks for sign-up to log in and for a duplicate to get a generic error; that cannot hold together with an identical answer, and the point is with the owner, see the T-015 report).
- `400 VALIDATION_ERROR`: the body fails the schema. `403 FORBIDDEN`, `415`, `413`, `429 RATE_LIMITED` as in section 1.8.

**`POST /auth/sign-in`.** Strict body: `email` (as above), `password` (1 to 128 characters; the length policy is not applied at sign-in).

- `200 { "data": { "userId": "...", "role": "CUSTOMER" } }` with `Set-Cookie` for the session cookie (SECURITY.md, "Session and cookie settings"). A session the request came with is ended (rotation).
- `401 UNAUTHENTICATED`, message `The email or password is incorrect.`, `details` `{}`, no cookie: the same for an unknown email, a wrong password, and a deactivated account (REQ-C-02, REQ-A-02).
- `400`, `403`, `413`, `415`, `429` as in section 1.8; a `429` does not say which of the two limits refused.

**`POST /auth/sign-out`.** No body, `Content-Type: application/json` (section 1.2). `200 { "data": { "signedOut": true } }` with a `Set-Cookie` that clears the cookie; the old cookie is refused from then on. `401 UNAUTHENTICATED` without a valid session. `403`, `415` as in section 1.8.

**`GET /auth/session`.** `200 { "data": { "userId": "...", "role": "SELLER", "storeId": "...", "storeStatus": "SUSPENDED" } }` for a valid session of an active user, read from the database on this request; `200 { "data": null }` otherwise (no cookie, a cookie with a bad signature, an expired session, a deactivated user). `storeId` and `storeStatus` are `null` for a user without a store.

**Order of checks on these routes** (section 1.8; SECURITY.md SR-05 item 5). Sign-up and sign-in are `public`, so steps 3 and 4 are skipped: 1 `Origin`, 2 `Content-Type`, 5 the per-address limit (`sign-up` or `sign-in-address`, on the SR-01 client address, before a byte of the body is read), 6 the body under the default limit of section 1.1, 7 the schema; for sign-in then the per-email limit (`sign-in-email`, on the trimmed, lower-cased, NFKC email, counted the same whether or not an account has it), and only then the password. Sign-out: 1, 2, 3 (the session), then the deletion; no body is read. Those two are the only routes that check a password or create an account; with the library's handler unmounted no other route does (item 8.2-9, closed).

**No endpoint gives a user the `ADMIN` role** (BR-26; finding S9). Admins are created only by the bootstrap script; there is no promotion endpoint under `/admin`, and `role` is an unknown key in every body of this contract. The script may be run again to create further admins (D-026, OQ-37); that is still not an endpoint. The library is configured so that `role`, `isActive`, and `phone` can never be set through it either (a value at sign-up is replaced by the default; an update is refused).

No password-recovery endpoint exists: there is no email delivery (DECISIONS.md, "Pending decisions").

No endpoint returns the IP address or browser details stored with a session to anyone other than the signed-in user they belong to (SECURITY.md SR-07 item 7), and no endpoint returns server log lines (SR-06 item 4).

### 5.2 Catalog

All public. All return only what the visibility rule allows ([section 3.4](#34-visibility-and-can-be-bought)).

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/categories` | public | Paginated. Active categories only, ordered by `sortOrder`, then `id`. |
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

Shapes. The block below is a catalogue of the five shapes keyed by name, not one response; each endpoint returns the matching shape inside the envelope of [section 2.1](#21-success-envelope):

```json
{
  "category": { "id": "...", "name": "...", "slug": "...", "isSample": false },

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

**Access and order of checks.** All six are `public` `GET`s: steps 1 to 6 of [section 1.8](#18-access-levels-and-404-against-403) do not apply, nothing is rate-limited, and a session cookie, a role, or a `storeId`, `userId`, or `role` in the query changes nothing. The path parameter is validated first, then the query (`400`), then the service answers (`404`, or `200`). Every response is `Cache-Control: no-store`. No catalog request writes anything (D-029 point 1); the integration tests compare a snapshot of every table and sequence before and after.

**Query parameters.**

| Rule | Detail |
| --- | --- |
| Numbers | `page`, `pageSize`, `minPriceSatang`, `maxPriceSatang` are decimal digits only. A sign, a blank, a fraction (`10.5`, `2.0`), an exponent (`1e3`), hexadecimal, or full-width digits are `400` |
| `page` | At least 1, at most 14 digits (so the offset stays a safe integer; code-review finding CR-84). A page beyond the last one is `200` with an empty `data` and the true `total` |
| `pageSize` | 1 to 50, default 20. `51` and above are `400` (field code `too_big`), never clamped |
| `minPriceSatang`, `maxPriceSatang` | 0 to 100,000,000; both inclusive. `maxPriceSatang` below `minPriceSatang` is `400` on the path `maxPriceSatang` (field code `custom`); equal bounds are allowed |
| `q` | Surrounding white space is removed. Blank (or empty) is the same as no `q`. At most **100 characters** after trimming (item 8.2-7 for this field). Matched case-insensitively as a substring of the title; `%`, `_`, and `\` are ordinary characters, not wildcards. U+0000 or a lone surrogate is `400` |
| `category` | A category slug, read like a path slug (below). Unknown or inactive: `404 NOT_FOUND` on both product lists |
| `sort` | `newest`, `price_asc`, `price_desc`; anything else, the empty string included, is `400` |
| A known parameter given twice | `400` (field code `invalid_type`); for example `page=1&page=2`. Unknown parameters are ignored, also when repeated |

**Ordering**, every one ending with `id`: `newest` is `createdAt` descending, then `id` descending; `price_asc` is `priceSatang` ascending, then `id` ascending; `price_desc` is `priceSatang` descending, then `id` ascending. Categories: `sortOrder`, then `id`, both ascending. Reviews: `createdAt` descending, then `id` descending.

**`{slug}` path parameter** ([section 1.4](#14-identifiers-slugs-and-order-numbers)). A value that contains `%` is percent-decoded once (a generated slug never contains `%`, so a slug the framework already decoded is not changed). It is then normalised to NFC and matched exactly. After decoding it must be 1 to **200 characters** and contain no U+0000 and no lone surrogate. A broken escape (for example `%E0%B8`) is `400`; a well-formed slug that matches nothing visible is `404`.

**404.** Every refusal of a catalog read is `404 NOT_FOUND` with the default message and `details` `{}`: an unknown slug, a product hidden by any condition of [section 3.4](#34-visibility-and-can-be-bought), a suspended store, a store whose owner is deactivated, an unknown or inactive category. The answers are identical, so none says that a hidden row exists.

**Shapes**, beyond the catalogue above:

- `averageRating` is the mean of the integer ratings rounded to **one decimal place**, half away from zero (ratings 5, 4, 5 give `4.7`).
- `image` of a list item is the picture with the lowest `sortOrder`, or `null`. `images` of the detail is every picture in `sortOrder` order, `[]` when there is none.
- `url` is `/api/files/` followed by the key percent-encoded as one path segment. **The file endpoint does not exist yet** (T-041), so such a URL answers `404` until it does.
- `store.description` is `null` when the seller wrote none; `logo` is `null` without a logo.
- The review shape carries no reviewer name or id.

**Consistency.** A list reads its `total` and its page as two statements, not in one transaction, so a write that commits between them can make `total` differ from the rows by that write. Reason: with Prisma 7.10 and `@prisma/adapter-pg`, the relation loads of one query run at the same time on a transaction's single connection, which `pg` 8.23 reports as deprecated and `pg` 9 removes (see `src/modules/catalog/repository.ts`). The consequence for the endpoints that must run in a transaction (CLAUDE.md rule 5) is item 8.2-14 in [section 8.2](#82-open-technical).

**Visibility as one definition.** `VISIBLE_PRODUCT_WHERE` and `PUBLIC_STORE_WHERE` in `src/modules/catalog/visibility.ts`, exported from `@/modules/catalog`, are the query form of [section 3.4](#34-visibility-and-can-be-bought); the cart flags and checkout (T-031, T-032) use them rather than restating the five conditions.

### 5.3 Account

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/me` | user | Profile, role, own store, own latest application. |
| PATCH | `/me` | user | Body: `name`, `phone` only. `email`, `role`, `isActive` are unknown keys. |
| GET | `/me/addresses` | user | Paginated. Own addresses only. |
| POST | `/me/addresses` | user | |
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
- A `productId` that does not exist, or whose product is not visible, is `404 NOT_FOUND`; no line is created. A hidden product is answered exactly like a missing one.
- A product from the caller's own store is `409 PRODUCT_UNAVAILABLE` with one entry in `details.items` whose `reason` is `OWN_STORE` and whose `cartItemId` is `null`; no line is created (BR-16; finding S14).
- **A line whose product is hidden refuses a quantity change** (BR-38; D-028). `PATCH /cart/items/{itemId}` on the caller's own line whose product is not visible ([section 3.4](#34-visibility-and-can-be-bought)) is `409 PRODUCT_UNAVAILABLE`, and the line is unchanged. `details.items` has one entry in the shape of [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought): `{ "cartItemId": the line id, "productId": "...", "reason": "NOT_AVAILABLE", "requestedQuantity": 2, "availableStock": null }`, where `requestedQuantity` is the quantity sent. The answer says no more than the cart read says about that line (`unbuyableReason: "NOT_AVAILABLE"`, below): not which condition hides the product, and not its stock or its price. It is the same answer when the hidden product also has no stock, so a hidden line is never answered as sold out. It is not `404`, because the line is the caller's own and the caller already sees it in the cart; `DELETE /cart/items/{itemId}` on it always succeeds. The `quantity` is validated first: a value outside 1 to 99 is `400` ([section 1.8](#18-access-levels-and-404-against-403)). `POST /cart/items` names a product, not a line, so for a hidden product it stays `404 NOT_FOUND` as above, also when the caller already has a line for that product; the line is unchanged.
- **A sold-out product is refused** (D-026, OQ-28; finding M11). Adding a visible product whose stock is 0, or setting the quantity of a line whose product is sold out, is `409 INSUFFICIENT_STOCK`; no line is created and an existing line is unchanged. `details.items` has one entry in the shape of [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought): `{ "cartItemId": null or the line id, "productId": "...", "reason": "INSUFFICIENT_STOCK", "requestedQuantity": 2, "availableStock": 0 }`. Sold out has two names on purpose, and nothing is renamed: a refusal says `reason: "INSUFFICIENT_STOCK"` with `availableStock: 0`, in the vocabulary of the checkout refusal, and the cart read says `unbuyableReason: "SOLD_OUT"`. A client treats the two as the same condition and shows the sold-out text for both.
- **More than is in stock is lowered, not refused** (D-026, OQ-28). When the resulting quantity of the line (the quantity sent, plus what the line already holds for an add) is above the product's stock and the stock is at least 1, the request **succeeds**, the line is stored with a quantity equal to the stock, and the response says so with `quantityLowered: true`.

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
- `mockOutcome`: optional, `"SUCCESS"` (default) or `"FAIL"`. It exists only to exercise the failure path of the mock provider and is rejected when a real provider is configured.
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
| A line cannot be bought (BR-22) | `409 PRODUCT_UNAVAILABLE` or `409 INSUFFICIENT_STOCK`, [section 5.5.3](#553-checkout-refused-because-a-line-cannot-be-bought) |
| Grand total above 2,000,000,000 satang (BR-04) | `422 ORDER_LIMIT_EXCEEDED` |

No status or code exists for an answer that asks the client to try the same checkout again; whether one is needed depends on the mechanism chosen in T-032 ([section 8.2](#82-open-technical), item 8.2-3).

#### 5.5.2 Response

`201` when this request created the order; `200` when the idempotency key matched an order that already exists. The body is the order in both cases, **whatever its payment status**: a failed payment is not an error envelope ([section 5.5.4](#554-failed-payment)).

```json
{
  "data": {
    "id": "...",
    "orderNumber": "OD2610110000042",
    "createdAt": "2026-10-11T03:20:00.000Z",
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
- `payment.isSimulated` is derived from `payment.provider` (finding M1). `payment.failureReason` is `null` unless the payment failed; then it is a short code. Two values are named so far: `SIMULATED_DECLINE` (the mock provider declined) and `TIMEOUT` (the order was still `PENDING` after 15 minutes). **The list is not closed**: DATA_MODEL.md sections 6.13 and 7.2 give the same two values "for example" and define no enum. Closing it is `OPEN (technical)` ([section 8.2](#82-open-technical), item 8.2-5); until it is closed a client treats a value it does not know as a failed payment with no specific reason.
- `createdAt` is the only time on the order itself. No field carries the time the order was paid; whether one should is with the owner ([section 8.1](#81-open-owner), item 8.1-1).
- `shippingTotalSatang` equals the flat fee multiplied by the number of seller orders (BR-08). `grandTotalSatang` is `itemsSubtotalSatang + shippingTotalSatang`.
- The commission rate is recorded on each seller order but is **not** in the customer's response; the seller's and the admin's views carry `commissionRateBps` ([section 5.7.3](#573-seller-orders)). Nothing is deducted from any amount (BR-13).
- `shipment` is `null` until the seller order is `SHIPPED`; then `{ "carrierName": "...", "trackingNumber": "...", "isSimulated": true, "shippedAt": "...", "deliveredAt": null }`, with `carrierName` and `trackingNumber` `null` when the seller entered none.
- `review` is the caller's review of that item, `{ "id", "rating", "comment", "createdAt" }`, or `null`.
- `paymentStatus` in a checkout response is normally `PAID` or `FAILED`. It is `PENDING` only when the provider did not answer; a repeat with the same key then returns the same order and does not charge again. An order still `PENDING` 15 minutes after it was created is failed (D-028; D-023 point 6).

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

That is the whole promise, and it is an outcome (D-029 point 2). **The mechanism is not part of this contract** (D-031 point 5): whether the server validates before it takes stock, uses a savepoint, or runs an attempt and then a separate refusal transaction (DATA_MODEL.md section 7.1) is validated in T-013 and chosen in T-032 ([section 8.2](#82-open-technical), item 8.2-2). All three are admissible as long as the outcome above holds and a checkout that succeeds stays atomic ([section 5.5.1](#551-request)).

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
| POST | `/seller/application` | customer-role | Body `{ storeName, description, contactPhone }`. Rate-limited. A `SELLER` already owns a store and an `ADMIN` cannot become a seller: both get `403 FORBIDDEN` (BR-06). A second application while one is `PENDING`: `409 CONFLICT`, reason `OPEN_APPLICATION`. A rejected applicant may apply again (a new application). |
| GET | `/seller/application` | user | The caller's latest application: `{ id, storeName, description, contactPhone, status, reviewNote, reviewedAt, createdAt }`. `reviewNote` is the rejection reason. Never applied: `404 NOT_FOUND`. |
| GET | `/seller/store` | seller (any store status) | Own store: `{ id, name, slug, description, logo, contactPhone, status, statusReason, isSample }`. `statusReason` is the reason of the last suspension or reinstatement. |
| PATCH | `/seller/store` | seller | Body: any of `name`, `description`, `contactPhone`, `logoKey` (a storage key of the caller's store, or `null` to remove the logo; [section 5.8](#58-uploads-and-files)). A seller may change the contact phone, and no change here needs approval (D-028). The slug does not change on a rename. Existing orders keep the old name ([section 5.5.2](#552-response)). |
| GET | `/seller/summary` | seller (any store status) | [Section 5.7.4](#574-dashboard-summary). |

"`seller (any status)`" in the earlier version described users whose role was still `CUSTOMER` (finding B3). The two application endpoints are what such a user has; everything else under `/seller` needs role `SELLER`.

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
- **Suspended store: view only, apart from orders** (REQ-S-09; BR-14; D-028). A seller whose store is `SUSPENDED` may use exactly these endpoints: `GET /seller/store`, `GET /seller/summary`, `GET /seller/products`, `GET /seller/products/{id}`, the three order endpoints of [section 5.7.3](#573-seller-orders) (`GET /seller/orders`, `GET /seller/orders/{id}`, `POST /seller/orders/{id}/status`), and `GET /seller/application`. Every other seller endpoint is refused with `403 SELLER_NOT_APPROVED` until the store is reinstated: creating, editing, publishing, unpublishing, archiving, and deleting a product, adjusting stock, editing the store (`PATCH /seller/store`), and uploading (`POST /seller/uploads`). Deleting a product, editing the store, and uploading are not named one by one in D-028; they are refused because they are not views.

#### 5.7.3 Seller orders

A suspended store still reads and fulfils its existing orders (BR-14; finding B4), so these three endpoints do **not** require an approved store.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/seller/orders` | seller (any store status) | Paginated, newest first. Own seller orders only. Filter: `fulfilmentStatus`. |
| GET | `/seller/orders/{id}` | seller (any store status) | `{id}` is a seller order id. Else 404. |
| POST | `/seller/orders/{id}/status` | seller (any store status) | Body `{ to, carrierName?, trackingNumber? }`. Else 404. |

- A seller sees **only their own store's portion** of an order: their seller order, its items, and the buyer's shipping copy. Never another store's portion, and never the order's grand total.
- **A seller sees a seller order only once its order is paid** (BR-20; D-026, OQ-41). Every seller read and write is filtered on the order's `paymentStatus` being `PAID`. A seller order whose order is still `PENDING`, or `FAILED`, does not exist for the seller: absent from the list, `404 NOT_FOUND` by id, `404` on a status change, and counted in no figure. `paymentStatus` in a seller's response is therefore always `PAID`.
- `to` is one of `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`; any other value is `400 VALIDATION_ERROR`. The move must be in the table of [section 3.2](#32-fulfilment-status-per-seller-order), otherwise `409 INVALID_STATE_TRANSITION` and nothing changes: in particular `PENDING` to `PROCESSING` while the payment is not `PAID`, and anything from `SHIPPED` other than `DELIVERED`.
- `carrierName` and `trackingNumber` are accepted only with `to: "SHIPPED"`; with any other `to` they are a `400 VALIDATION_ERROR`. Both are optional. **Shipping is simulated**: no carrier is contacted and no tracking number is generated.
- Cancelling restores the stock of the seller order's items once and leaves the payment as it is. A cancelled seller order that was paid carries `cancellationKind: "REFUND_OUTSIDE_SYSTEM"`; the system records no refund (BR-21).

Seller order as its seller sees it:

```json
{
  "data": {
    "id": "...", "orderNumber": "OD2610110000042", "createdAt": "...",
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

`storeName` is the name at purchase, also for the seller (BR-09). `commissionRateBps` is the rate copied at purchase; it is recorded only.

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

### 5.8 Uploads and files

Findings S7 and S8; DATA_MODEL.md sections 6.7, 6.8, and 8; SECURITY.md "Upload policy" and SR-05.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/seller/uploads` | seller | `multipart/form-data` only, one image per request in the field `file`. Rate-limited. Response `201`. A suspended store is refused before the body is read. |
| GET | `/api/files/{key}` | public | Serves a stored image. Not an envelope response on success. |

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

**Serving.** `GET /api/files/{key}`:

- The key must match the strict pattern of generated keys and must belong to a registered upload; anything else, including any traversal attempt, is `404 NOT_FOUND` and reads nothing. The key pattern itself is `OPEN (technical)` for T-041 (SECURITY.md TM-18).
- The response has the upload's recorded image content type, never one derived from the request, and `X-Content-Type-Options: nosniff`.
- Product pictures and logos are public by design: a file is served to anyone who has its key, whether or not the product it belongs to is currently visible.
- Local adapter only in the MVP (D-010). Caching of file responses is `OPEN (technical)` for T-041; nothing is documented as cacheable yet.

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
| POST | `/admin/applications/{id}/approve` | No body. In one transaction: the application becomes `APPROVED`, a store is **created** with status `APPROVED` and a generated slug, and the applicant's role becomes `SELLER`. Not `PENDING`: `409 INVALID_STATE_TRANSITION`. Applicant no longer a `CUSTOMER`: `409 CONFLICT`, reason `APPLICANT_NOT_CUSTOMER`. |
| POST | `/admin/applications/{id}/reject` | Body `{ reason }`, required and not empty. No store is created; the role stays `CUSTOMER`. Not `PENDING`: `409 INVALID_STATE_TRANSITION`. |
| GET | `/admin/stores` | Paginated. Filters: `status`, `q` (substring of the store name). Includes hidden stores. |
| POST | `/admin/stores/{id}/suspend` | Body `{ reason }`, required. `APPROVED` to `SUSPENDED`; otherwise `409 INVALID_STATE_TRANSITION`. |
| POST | `/admin/stores/{id}/reinstate` | Body `{ reason }`, required. `SUSPENDED` to `APPROVED`; otherwise `409 INVALID_STATE_TRANSITION`. |

- Approval always **creates** the store (DATA_MODEL.md section 4.1): a user who owns a store cannot apply (REQ-S-01), so there is no "activate" case.
- Suspending hides the store's products and blocks new orders for it; it does **not** end the seller's sessions, and the seller keeps the three order endpoints of [section 5.7.3](#573-seller-orders) (BR-14; finding B4).
- Store item for admins: `{ id, name, slug, description, logo, contactPhone, status, statusReason, isSample, ownerId, ownerIsActive, createdAt }`.

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
| GET | `/admin/orders` | Paginated, newest first. Filters: `paymentStatus`, `fulfilmentStatus` (orders with at least one seller order in that status), `storeId`, `userId`, `orderNumber` (exact), `from`, `to` (on the order's creation time, [section 1.6](#16-time)). There is no filter on the time an order was paid ([section 8.1](#81-open-owner), item 8.1-1). |
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
- **Which date places a row in the range.** `orderCount` and `paidRevenueSatang` use **the time the order was paid** (D-028), not the time it was created. That time is stored as `Order.paidAt` (DATA_MODEL.md section 6.10). It is used here to place a row in the range and is **not returned by any endpoint and not offered as a filter**: whether it should be is with the owner ([section 8.1](#81-open-owner), item 8.1-1). An order created before midnight and paid after it is therefore in the report of the later day and in the admin order list, which filters by creation time, of the earlier one. `newUserCount` uses the user's creation time and `newSellerCount` the store's (the moment of approval).
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
| Sign-in | 5 per minute per IP and per email | `sign-in-address`, `sign-in-email` |
| Sign-up | 5 per hour per IP | `sign-up` |
| Checkout (`POST /checkout`) | 10 per minute per user | `checkout` |
| Uploads (`POST /seller/uploads`) | 30 per hour per user | `uploads` |
| Seller application (`POST /seller/application`) | 3 per day per user | `seller-application` |
| Review create (`POST /orders/{id}/items/{itemId}/review`) | 10 per hour per user | `review-create` |

Decided by the orchestrator on 2026-10-11: "per IP" in this table means per client address as derived by security rule SR-01 in [SECURITY.md](SECURITY.md): an IPv4 address, an IPv6 /64 network, or the single shared subject `unknown` when no trusted proxy is configured. It is never taken from a header the client controls. With the default configuration all clients therefore share one per-address allowance.

Each line of the table is its own rule with its own counter (sign-in has two: per address and per email), so using up one limit never consumes another. A refused request gets `429 RATE_LIMITED` with `Retry-After`. A limit is applied at step 5 of the order in [section 1.8](#18-access-levels-and-404-against-403): after the caller is identified and the access level is judged (the role and, on a `seller` endpoint, the store status; D-032 point 1), and **before the body is read**. The limiter also refuses new subjects while a rule's in-process store is full (SR-02); that refusal is the same `429`, with a `Retry-After` of at most 60 seconds. The limiter is in-process and correct for a single instance only (D-012).

What the limits guarantee (D-032 point 2; SECURITY.md SR-05 item 5, "Rate limit"):

- **A request that reaches step 5 uses one allowance whatever happens to it afterwards** (`413`, `400`, `403`, `404`, `409`, or success). A later refusal is never a free attempt or a free body read.
- **A request refused at steps 1 to 4 uses none.** None of those steps reads a body. So a suspended seller's `POST /seller/uploads`, refused at step 4 with `403 SELLER_NOT_APPROVED`, does not count against `uploads`, and a customer's request to it, refused with `403 FORBIDDEN`, does not either.
- **A per-user limit is counted on the acting user of the session** and on nothing else; no header, body field, or query parameter changes the subject.
- **Sign-up and sign-in** are public and take a body from an anonymous caller. Their per-address limits (`sign-up`, `sign-in-address`) are consumed at step 5 by every request that passed steps 1 and 2, before a byte of the body is read and whatever the outcome (D-031 point 4). The body of these endpoints is read under the default limit of [section 1.1](#11-transport), also when it is the auth library that parses it.
- **The per-email limit of sign-in** (`sign-in-email`) cannot be at step 5, because the email is in the body. Its place is fixed: after the per-address limit allowed the request, after the body was read and the email validated and normalised, and **before the password is looked at**. Its refusal is the same `429 RATE_LIMITED` and does not say which rule refused. It is counted on the email as typed, in the same way whether or not an account has that email. A request it refuses has already used a per-address allowance and does not get it back.

**Implemented for sign-up and sign-in (T-015, 2026-10-13); the other rules wait for their endpoints.** The limiter and the seven rules of the table exist in `src/server/rate-limit.ts`. `POST /auth/sign-up` and `POST /auth/sign-in` ([section 5.1](#51-auth)) are the only routes that create an account or check a password (the auth library's own handler is not mounted), and they apply `sign-up`, `sign-in-address`, and `sign-in-email` as this section requires; the integration tests in `tests/integration/auth/limits-and-cookies.test.ts` show the 429 before the body is read, the per-email limit across addresses and for an unknown email, and that a request refused for its origin or content type uses no allowance. Item 8.2-9 is closed.

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
| `GET /api/health`: "`{ "status": "ok", "database": "up" }` or 503" | Both bodies, the headers, and that the endpoint is outside the error envelope and never reuses a client request id ([section 5.10](#510-platform)) |

## 8. Open points

The owner's answers in D-025, D-026, and D-028 and the rulings in D-029, D-031, and D-032 are written into this contract as rules. Every open item below has an id (`8.1-n`, `8.2-n`) so that other documents can cite it. The ids are stable: an item keeps its id when the table is reordered, and the id of a closed item is not given to another. OQ-20 (visual details on real pages) is still open with the owner and no point of this contract depends on it. OQ-45 and OQ-46 belong to ui-ux-design and frontend; OQ-47 to OQ-50 (log and backup retention, session expiry) touch no endpoint: nothing here exposes logs, backups, or another user's session data.

### 8.1 `OPEN (owner)`

**One point waits for the owner.** It was found by the cross-document check and has not been put to the owner yet; the orchestrator parks it in [STATUS.md](STATUS.md). Until it is answered nothing is built on a guess (D-019).

| Id | Question for the owner | Why it arises | What the contract does meanwhile | Section |
| --- | --- | --- | --- | --- |
| 8.1-1 | Should order pages show the time an order was paid, and should the admin order list be filterable by paid date so it can be matched against the report (which is by paid date, D-028)? | The time is stored (`Order.paidAt`, DATA_MODEL.md section 6.10) and the report places an order in its range by it. The order shapes carry only `createdAt`, and the `from` and `to` filters of `GET /admin/orders` use the creation time, so an admin cannot see through the API why an order falls in a report range | Nothing is exposed: no response carries the paid time and no filter uses it | 5.5.2, 5.7.3, 5.9.5, 5.9.7 |

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
| 8.2-2 | **Mechanism of the refused checkout.** The contract fixes the outcome only (no order, stock unchanged, the lowered quantity stored, the customer resubmits; D-029 point 2). Admissible candidates: validating before taking stock, a savepoint, or an attempt transaction followed by a separate refusal transaction (DATA_MODEL.md section 7.1). A checkout that succeeds stays atomic under each | T-013 validates the candidates; T-032 chooses (D-031 point 5) | 5.5.1, 5.5.3 |
| 8.2-3 | **An answer that says "try again".** DATA_MODEL.md section 7.1 has its recommended shape end, in a rare race, with "a retryable conflict". No status or code for such an answer exists in section 2.3 and none is reserved. If the shape chosen under 8.2-2 can give that answer, it gets a code in section 2.3, and a row in section 5.5.1, before T-032 starts | backend-api, before T-032 starts (D-031 point 5) | 2.3, 5.5.1 |
| 8.2-4 | Accepted UUID versions and the normalised form of `Idempotency-Key` | T-032 | 1.3 |
| 8.2-5 | **The closed list of `payment.failureReason` values.** This contract and DATA_MODEL.md sections 6.13 and 7.2 both name `SIMULATED_DECLINE` and `TIMEOUT` "for example"; neither defines the list or says whether it is an enum | database and backend-api, before T-032 starts | 5.5.2, 5.5.4 |
| 8.2-6 | Which code an admin decision gets when the `contentRevision` **and** the state both differ from what the decision needs: `409 CONFLICT` with `STALE_REVISION`, or `409 INVALID_STATE_TRANSITION`. Recommended by backend-api, not in effect: the revision is compared first, so `STALE_REVISION` | backend-api, in T-050 | 5.9.3 |
| 8.2-7 | Text length limits that no requirement states | Each endpoint's task | 4 |
| 8.2-8 | Storage key pattern; caching of file responses; whether an upload request may carry more than one file; what an extra form field on the upload request (for example `storeId`) does, since the strict-object rule of section 1.1 is written for JSON bodies | T-041, with security | 5.8 |
| 8.2-9 | **Closed by T-015 (2026-10-13).** The library's handler is not mounted; the auth routes are the application's own, with the paths and shapes of section 5.1, and follow section 1 in full. Both sign-in limits and the bound on the body read are on the two routes that check a password or create an account (section 6) | T-015 | 1.8, 5.1, 6 |
| 8.2-10 | The planned error code `CART_EMPTY`, and the `CONFLICT` reasons, are contract only until their tasks add them to the code. Since 2026-10-12 `conflict(reason)` requires a reason of the right form (CR-02), but it does not know the list: a reason that is well formed and not in section 2.3 is not refused by the code | T-031, T-032, T-042, T-050 | 2.3 |
| 8.2-11 | One convention is contract only until the code follows; it is not undecided. (a) The order of refusals is ruled (D-031 point 4 as amended by D-032 point 1) and the handler pattern in `src/server/http.ts` shows it since 2026-10-12 (CR-09). The guards exist since T-015 (2026-10-13), and the auth routes (T-015) and the catalog reads (T-020) apply the order for their access levels ([section 1.8](#18-access-levels-and-404-against-403), "As built"); no handler of access `seller` or `admin` exists yet, so the role helper and the store-status helper are called by no handler. Built on 2026-10-12 in the `src/server` follow-up, and re-checked by security the same day together with the pattern (SEC-022 to SEC-024 fixed; commit `6259d32`): (b) `invalid_json` for a body that is not valid UTF-8 (SEC-022); (c) the nesting limit of 32 levels (SEC-023; its field code is provisional, 8.2-12); (d) a body that stops arriving answered as a client error (SEC-024; its status and code are provisional, 8.2-13). Built on 2026-10-12 afterwards and awaiting the security re-check: (e) a body that contains a string that is not well-formed Unicode is refused (SEC-028; its field code is provisional, 8.2-12) | (a) the guards: done in T-015; their use: each `seller` and `admin` endpoint's task. Security re-checks (e) | 1.1, 1.8, 1.10 |
| 8.2-12 | **The `code` of the field error for a JSON body nested more than 32 levels deep.** The status and the error code are fixed: `400 VALIDATION_ERROR`, nothing echoed (SECURITY.md SR-05 item 12). The `code` inside `details.fields`, and whether the `path` is the empty string as for `invalid_json`, are not: SR-05 item 12 leaves the field code to backend-api and none is chosen. Candidates: reuse `invalid_json`, or a code of its own. **Still not ruled.** The `src/server` follow-up of 2026-10-12 built the first candidate as a **provisional** answer, because it adds no public code: `path` `""`, `code` `invalid_json`, and a message of its own (section 1.1). It is one constant, `JSON_TOO_DEEP_FIELD_CODE` in `src/server/errors.ts`, so a ruling for the other candidate is a one-line change. A client may rely on the status and on `VALIDATION_ERROR` only. **The same ruling settles a second field code:** that of a body that parses but contains a string that is not well-formed Unicode (section 1.1; SEC-028). The orchestrator ruled on 2026-10-12 that such a body is refused with `400 VALIDATION_ERROR` and that its field code follows whatever this item decides for a body that is valid JSON and refused all the same; until then it reuses `invalid_json` with `path` `""` and a message of its own. It is a constant of its own, `JSON_STRING_NOT_WELL_FORMED_FIELD_CODE` in `src/server/errors.ts`, so the ruling may give the two cases one code or two, and each is a one-line change | A ruling by the orchestrator with security, before the first handler that reads a JSON body is merged (D-032 point 4); the ruling is written into section 1.1 and is a contract change (section 10) | 1.1, 1.10, 2.3 |
| 8.2-13 | **The status and the error code for a body that stops arriving** (the connection is lost, the request is aborted, or the body ends before its declared length), for a JSON body and for the upload. Fixed: a client error, with a status below 500 and never `500 INTERNAL_ERROR`, and nothing of the part that arrived kept or echoed (SECURITY.md SR-05 item 10). Not fixed by any document: which status and which code. Section 2.3 reserves no code for it. Candidates: `400 VALIDATION_ERROR`, or a code of its own, which would be a new row in section 2.3. **Still not ruled.** The `src/server` follow-up of 2026-10-12 built the first candidate for JSON bodies as a **provisional** answer, because it adds no public code: `400 VALIDATION_ERROR` with one field error, `path` `""`, `code` `invalid_json`, and a message of its own (section 1.1). It is one constant, `ABORTED_BODY_ERROR_CODE` in `src/server/errors.ts`, so a ruling for another existing code is a one-line change (a new code also needs its row in `ERROR_STATUS`). Not settled by the provisional answer: the field error under `VALIDATION_ERROR`, since `invalid_json` does not fit a multipart body. A client may rely only on the status being below 500 | A ruling by the orchestrator with security, before the first handler that reads a JSON body is merged (D-032 point 4); the upload reader follows the same answer in T-041. A new code is a contract change (section 10) | 1.1, 2.3, 5.8 |
| 8.2-14 | **Relation loads inside an interactive transaction** (code-review finding CR-82, 2026-10-13; not reproduced against a database). Prisma 7.10 with `@prisma/adapter-pg` sends the relation loads of one query (for example a product with its pictures, store, and category) at the same time on the single `pg` client of an interactive transaction. `pg` 8.23.1, the version in the lockfile, queues them, so the result is correct, and prints one `DeprecationWarning` ("Calling client.query() when the client is already executing a query"); `pg` 9 removes the queueing, and such a transaction would then fail. Not a contract change: no response, status, or code depends on it. The catalog runs no transaction ([section 5.2.1](#521-as-built-t-020-2026-10-13), "Consistency"). The rule for the endpoints that must (CLAUDE.md rule 5: cart writes, checkout, stock, status transitions, admin actions with an audit row): inside `db.$transaction(async (tx) => ...)`, a query selects scalar fields only, or its relations are loaded by separate statements awaited one after the other, unless `relationLoadStrategy: "join"` has been evaluated and adopted; two `tx` queries are never started together (`Promise.all` on `tx` is not used). Owned elsewhere and **not done** here: pinning `pg` to `^8` with a pnpm override (lockfile and `package.json`), the note in DATA_MODEL.md section 7, and an integration test that fails when a transaction with a nested select prints the warning | database (the pin, DATA_MODEL.md, the integration test) before T-031 starts; backend-api applies the rule in T-031 and T-032 | 5.2.1, 5.4, 5.5 |

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
