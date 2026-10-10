# API Contracts

Owner: backend-api agent. This is the **planned** contract. No endpoint is implemented yet. Each endpoint gets a status once built; the Zod schemas in `src/modules/<domain>/schema.ts` are then authoritative and this document must match them.

## Conventions

- Base path: `/api/v1`. JSON request and response bodies, `Content-Type: application/json` (uploads use `multipart/form-data`).
- Authentication: session cookie set by the auth handler at `/api/auth/*`. No bearer tokens in the MVP.
- Mutations (`POST`, `PATCH`, `PUT`, `DELETE`) require an `Origin` header matching the application origin.
- Money fields are integers in satang and end in `Satang`.
- Timestamps are ISO 8601 UTC strings.
- Mutation bodies reject unknown keys.
- The server never accepts `userId`, `storeId`, `role`, prices, or totals from the client for the acting user's own operations.

Decided by the orchestrator on 2026-10-11:

- **Request id.** The header is `X-Request-Id` on requests and on responses. Every response carries it, and an error envelope repeats it as `error.requestId`. The server generates the id (a UUID). An `X-Request-Id` sent by a client is ignored; it is reused only when the deployment has a trusted proxy configured and the value matches `^[A-Za-z0-9_-]{8,64}$` (security rule SR-03 in [SECURITY.md](SECURITY.md)). Clients must treat the id as opaque and should quote it when reporting a problem.
- **Origin.** A mutation whose `Origin` header is missing, is `null`, or is anything other than exactly the application origin (scheme, host, and port of `APP_URL`) is rejected with `403 FORBIDDEN`, whatever its content type. `GET` and `HEAD` are not checked.
- **Content type.** Each mutation accepts exactly one content type: `application/json`, or `multipart/form-data` for the upload endpoint only. A mutation that receives any other content type is rejected with `415 UNSUPPORTED_MEDIA_TYPE` before the body is read. Only the media type is compared, without regard to letter case or parameters, so `application/json; charset=utf-8` is accepted. A request with a body and no `Content-Type` is rejected the same way; mutations that have no body are an open point below.
- **JSON body.** A body that is not valid JSON (an empty body included) is rejected with `400 VALIDATION_ERROR` and exactly one field error, `{ "path": "", "code": "invalid_json", "message": "..." }`. Nothing of the body is echoed.
- **Required headers.** A missing or malformed required request header is rejected with `400 VALIDATION_ERROR` and a field error whose `path` is the header name as this document spells it and whose `code` is `invalid_header`. So far this applies to `Idempotency-Key` on `POST /checkout`: `{ "path": "Idempotency-Key", "code": "invalid_header", "message": "..." }`.
- **Caching.** Every envelope response, success or error, is sent with `Cache-Control: no-store` unless the endpoint's entry in this document says otherwise. Only public endpoints whose response does not depend on who is asking may be documented as cacheable; none is so far. Error responses are always `no-store`.

Where these conventions are implemented. No route handler exists yet, so "implemented" below means that a tested helper exists in `src/server/`; applying it is part of each endpoint's task.

| Convention | Helper | State |
| --- | --- | --- |
| Request id | `resolveRequestId`, `trustsIncomingRequestId` (`request-id.ts`); every envelope helper writes the header (`http.ts`) | Implemented |
| Client address behind "per IP" | `getClientAddress` (`client-address.ts`) | Implemented |
| Origin | `assertSameOrigin(request, allowedOrigin)` (`http.ts`). The allowed origin is an argument; reading and validating `APP_URL` belongs to `src/server/env.ts` (devops) | Helper implemented; no handler calls it yet |
| Content type | `assertContentType(request, expected)` (`http.ts`); `readJsonBody` calls it for JSON | Helper implemented; no handler calls it yet |
| JSON body | `readJsonBody(request)` (`http.ts`), `invalidJsonBody` (`errors.ts`) | Implemented |
| Required headers | `invalidHeader(name, message)` (`errors.ts`) builds the error. Reading and checking `Idempotency-Key` itself is part of the checkout task (T-032) | Error mapping implemented; the header check is planned |
| Envelopes, error codes, caching | `ok`, `created`, `paginated`, `errorResponse`, `parseInput` (`http.ts`); `AppError` and the code table (`errors.ts`) | Implemented |

Open, not decided here (the helpers above deliberately do not guess):

- **Size limit for JSON bodies.** No limit is stated, so `readJsonBody` enforces none. `413 PAYLOAD_TOO_LARGE` is documented for uploads only.
- **Mutations without a body.** The content-type rule says every mutation accepts exactly one content type, but several mutations have no body (`DELETE /me/addresses/{id}`, `POST /seller/products/{id}/publish`). Whether they must still send `Content-Type: application/json` is not decided; `assertContentType` refuses a missing header wherever it is called.
- **Format of `Idempotency-Key`.** The checkout entry says "UUID". Which UUID versions are accepted, and whether letter case matters when two keys are compared, is not decided.

### Success envelope

```json
{ "data": { } }
```

List endpoints:

```json
{ "data": [ ], "meta": { "page": 1, "pageSize": 20, "total": 132, "totalPages": 7 } }
```

Pagination query: `page` (default 1, minimum 1), `pageSize` (default 20, maximum 50).

### Error envelope

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "details": { }, "requestId": "..." } }
```

`message` is a developer-facing English string. The frontend maps `code` to Thai copy.

Decided by the orchestrator on 2026-10-11:

- An error envelope always contains all four keys. `details` is always an object; it is the empty object `{}` when there is nothing to report, never `null` and never absent.
- On `VALIDATION_ERROR`, `details.fields` is an array of `{ "path": string, "code": string, "message": string }`, capped at 50 entries (further errors are not reported).
  - `path` is the location of the offending value: property names and array indexes joined with `.`, and the empty string for the request root (for example unknown keys on the body). A `.` or `\` inside a property name is escaped with a backslash, so the key `a.b` is reported as `a\.b` and `b` nested in `a` as `a.b`. Limitation: an array index and a property name made of the same digits look the same (`items.0`), and so do the root and a property whose name is the empty string.
  - `code` is the schema issue code, for example `invalid_type`, `too_small`, or `unrecognized_keys`. Two codes do not come from a schema: `invalid_json` (the body is not valid JSON; `path` is the empty string and it is the only entry) and `invalid_header` (a required header is missing or malformed; `path` is the header name, for example `Idempotency-Key`).
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

Still open, not decided here: the shape of `details.items` for `INSUFFICIENT_STOCK` (belongs to the checkout task).

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Request body, query, path parameter, or required header fails its schema, or the body is not valid JSON; `details.fields` lists field errors |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `FORBIDDEN` | Role not allowed for this endpoint; missing, `null`, or foreign `Origin` on a mutation |
| 403 | `SELLER_NOT_APPROVED` | Seller endpoint used without an approved store |
| 404 | `NOT_FOUND` | Missing, or owned by someone else |
| 409 | `INSUFFICIENT_STOCK` | `details.items` lists product ids and available stock |
| 409 | `PRODUCT_UNAVAILABLE` | Item in cart no longer purchasable |
| 409 | `INVALID_STATE_TRANSITION` | Status change not allowed |
| 409 | `CONFLICT` | Uniqueness violation (SKU, slug, duplicate review, open application) |
| 413 | `PAYLOAD_TOO_LARGE` | Upload over the limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Mutation sent with a content type the endpoint does not accept; upload type not allowed |
| 422 | `ORDER_LIMIT_EXCEEDED` | Total above the order cap |
| 429 | `RATE_LIMITED` | Includes `Retry-After` (whole seconds) |
| 500 | `INTERNAL_ERROR` | Unexpected; no internals disclosed |

## Endpoints

Access: `public`, `user` (any logged-in user), `seller` (approved store required unless noted), `admin`.

### Auth (handled by the auth library)

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/sign-up/email` | public | Creates `CUSTOMER` only. Rate-limited. |
| POST | `/api/auth/sign-in/email` | public | Generic failure message. Rate-limited. |
| POST | `/api/auth/sign-out` | user | Invalidates the session. |
| GET | `/api/auth/get-session` | public | Current session or null. |

Exact paths follow the installed auth library and are confirmed in T-015.

### Catalog

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/categories` | public | Active categories. |
| GET | `/products` | public | Query: `q`, `category`, `minPrice`, `maxPrice`, `sort` (`newest`, `price_asc`, `price_desc`), pagination. Purchasable-visible products only. |
| GET | `/products/{slug}` | public | Detail with images, store summary, review summary (only when reviews exist). |
| GET | `/products/{slug}/reviews` | public | Paginated. |
| GET | `/stores/{slug}` | public | Approved stores only. |
| GET | `/stores/{slug}/products` | public | Paginated. |

### Account

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/me` | user | Profile, role, store status. |
| PATCH | `/me` | user | `name`, `phone` only. |
| GET | `/me/addresses` | user | |
| POST | `/me/addresses` | user | |
| PATCH | `/me/addresses/{id}` | user | Owner only, else 404. |
| DELETE | `/me/addresses/{id}` | user | Owner only, else 404. |

### Cart

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/cart` | user | Items grouped by store, live prices, availability flags, server-computed totals. |
| POST | `/cart/items` | user | `{ productId, quantity }`. Adds to an existing line. |
| PATCH | `/cart/items/{itemId}` | user | `{ quantity }`. |
| DELETE | `/cart/items/{itemId}` | user | |

### Checkout and orders

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/checkout` | user | Header `Idempotency-Key` (UUID, required). Body `{ addressId, paymentMethod: "MOCK", mockOutcome?: "SUCCESS" \| "FAIL" }`. Rate-limited. |
| GET | `/orders` | user | Own orders, paginated. |
| GET | `/orders/{id}` | user | Owner only, else 404. |
| POST | `/orders/{id}/items/{itemId}/review` | user | `{ rating, comment? }`. Eligibility per BR-11. |

`POST /checkout` response `201` (or `200` when the idempotency key matched an existing order):

```json
{
  "data": {
    "id": "...",
    "orderNumber": "...",
    "paymentStatus": "PAID",
    "payment": { "provider": "MOCK", "isSimulated": true },
    "itemsSubtotalSatang": 0,
    "shippingTotalSatang": 0,
    "grandTotalSatang": 0,
    "sellerOrders": [
      {
        "id": "...",
        "store": { "name": "...", "slug": "..." },
        "fulfilmentStatus": "PENDING",
        "shippingFeeSatang": 0,
        "items": [
          { "productTitle": "...", "unitPriceSatang": 0, "quantity": 1, "lineTotalSatang": 0 }
        ]
      }
    ]
  }
}
```

`mockOutcome` exists only to exercise the failure path of the mock provider and is rejected when a real provider is configured.

### Seller

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/seller/application` | user | One open application at a time. |
| GET | `/seller/application` | user | Own latest application. |
| GET | `/seller/store` | seller (any status) | Own store. |
| PATCH | `/seller/store` | seller | Name, description, logo key. |
| GET | `/seller/summary` | seller | Counts and paid sales total for own store. |
| GET | `/seller/products` | seller | Own products, paginated, filter by status. |
| POST | `/seller/products` | seller | |
| GET | `/seller/products/{id}` | seller | Own store only, else 404. |
| PATCH | `/seller/products/{id}` | seller | Own store only, else 404. |
| POST | `/seller/products/{id}/publish` | seller | |
| POST | `/seller/products/{id}/unpublish` | seller | |
| DELETE | `/seller/products/{id}` | seller | Archives if referenced by orders. |
| PATCH | `/seller/products/{id}/stock` | seller | `{ set: n }` or `{ adjust: n }`; never below zero. |
| POST | `/seller/uploads` | seller | Multipart image. Returns a storage key. Rate-limited. |
| GET | `/seller/orders` | seller | Own seller orders, paginated, filter by status. |
| GET | `/seller/orders/{id}` | seller | Own store only, else 404. |
| POST | `/seller/orders/{id}/status` | seller | `{ to, carrierName?, trackingNumber? }`. |

### Admin

Every path below requires `ADMIN`; other roles receive 403. Every mutation writes an audit row.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/summary` | Dashboard metrics from real rows. |
| GET | `/admin/users` | Search, paginate. |
| POST | `/admin/users/{id}/deactivate` and `/reactivate` | Not self; not the last admin. |
| GET | `/admin/applications` | Filter by status. |
| POST | `/admin/applications/{id}/approve` | Creates or activates the store; sets role `SELLER`. |
| POST | `/admin/applications/{id}/reject` | `{ reason }`. |
| GET | `/admin/stores` | |
| POST | `/admin/stores/{id}/suspend` and `/reinstate` | `{ reason }`. |
| GET | `/admin/products` | Filter by moderation status. |
| POST | `/admin/products/{id}/approve`, `/reject`, `/takedown` | `{ reason }` on reject and takedown. |
| GET, POST | `/admin/categories` | |
| PATCH | `/admin/categories/{id}` | Rename, reorder, activate, deactivate. |
| GET | `/admin/orders`, `/admin/orders/{id}` | All orders. |
| POST | `/admin/seller-orders/{id}/status` | Cancel or mark delivered. |
| GET | `/admin/reports` | `from`, `to` date range. |
| GET, PATCH | `/admin/settings` | Shipping fee, commission, moderation mode. |
| GET | `/admin/audit-logs` | Read-only, paginated. |

### Platform

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | public | `{ "status": "ok", "database": "up" }` or 503. |
| GET | `/api/files/{key}` | public | Serves stored images with a fixed image content type and `nosniff` (local adapter only). |

## Rate limits (initial values, tune after testing)

| Endpoint | Limit |
| --- | --- |
| Sign-in | 5 per minute per IP and per email |
| Sign-up | 5 per hour per IP |
| Checkout | 10 per minute per user |
| Uploads | 30 per hour per user |
| Seller application | 3 per day per user |
| Review create | 10 per hour per user |

Decided by the orchestrator on 2026-10-11: "per IP" in this table means per client address as derived by security rule SR-01 in [SECURITY.md](SECURITY.md): an IPv4 address, an IPv6 /64 network, or the single shared subject `unknown` when no trusted proxy is configured. It is never taken from a header the client controls. With the default configuration all clients therefore share one per-address allowance.

Each line of the table is its own rule with its own counter (sign-in has two: per address and per email), so using up one limit never consumes another. A refused request gets `429 RATE_LIMITED` with `Retry-After`. The limiter also refuses new subjects while a rule's in-process store is full (SR-02); that refusal is the same `429`, with a `Retry-After` of at most 60 seconds.

## Change process

A contract change after a consumer has started integrating needs an entry in [DECISIONS.md](DECISIONS.md) and a note to the affected agent.
