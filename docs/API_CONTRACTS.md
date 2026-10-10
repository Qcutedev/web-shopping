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

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Schema failure; `details.fields` lists field errors |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `FORBIDDEN` | Role not allowed for this endpoint; bad `Origin` |
| 403 | `SELLER_NOT_APPROVED` | Seller endpoint used without an approved store |
| 404 | `NOT_FOUND` | Missing, or owned by someone else |
| 409 | `INSUFFICIENT_STOCK` | `details.items` lists product ids and available stock |
| 409 | `PRODUCT_UNAVAILABLE` | Item in cart no longer purchasable |
| 409 | `INVALID_STATE_TRANSITION` | Status change not allowed |
| 409 | `CONFLICT` | Uniqueness violation (SKU, slug, duplicate review, open application) |
| 413 | `PAYLOAD_TOO_LARGE` | Upload over the limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Upload type not allowed |
| 422 | `ORDER_LIMIT_EXCEEDED` | Total above the order cap |
| 429 | `RATE_LIMITED` | Includes `Retry-After` |
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

## Change process

A contract change after a consumer has started integrating needs an entry in [DECISIONS.md](DECISIONS.md) and a note to the affected agent.
