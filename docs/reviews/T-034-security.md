# T-034 security review: cart, checkout, order confirmation, order history UI

Reviewer: security agent. Date: 2026-10-22. Commit reviewed: `cb07d84` (frontend T-034). Tree at review: `e822494`, clean. Register: [../SECURITY.md](../SECURITY.md). The same session re-checked SEC-081 (commit `0f497a8`); that result is in the register under SEC-081.

Result: **no finding of any severity.** The UI sends no amount, reads every amount from the server, imports no database code, holds no secret, labels the mock payment and the simulated shipping, renders all user-typed text as escaped React text inside `<bdi>`, and reaches orders and addresses only through services scoped by `actor.userId`. Three observations below are not security findings; they are for the code reviewer.

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the checkout UI is secure.

## Scope

- `src/components/checkout/checkout-view.tsx`, `checkout-section.tsx`
- `src/components/orders/order-detail-view.tsx`, `order-list-view.tsx`, `order-section.tsx`, `orders-section.tsx`, `status-badges.tsx`
- `src/components/cart/cart-view.tsx`, `cart-summary.tsx`, `cart-section.tsx`, `request-error.tsx`, `src/components/page-frame.tsx`
- `src/app/(storefront)/checkout/page.tsx`, `orders/page.tsx`, `orders/[id]/page.tsx`, `cart/page.tsx`
- `src/lib/api-client/checkout.ts`, `cart.ts`, `http.ts` (diff), `error-copy.ts` (diff), `src/lib/routes.ts` (diff), `src/i18n/th.ts` (mock and simulated labels only)
- Called, read for the trust boundary: `src/components/account/account-actor.ts`, `src/modules/orders/service.ts` (`getOrder`, `listOrders`), `src/modules/checkout/schema.ts` (`checkoutBodySchema`), `src/modules/checkout/repository.ts` (`findOwnedAddress`), `src/modules/orders/mapping.ts` (image reference), `src/components/user-name.tsx`, `src/components/catalog/product-image.tsx`

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Client-sent amounts (rule 3, D-031) | Holds. `placeOrder` is called once, from `checkout-view.tsx:112`, with an object literal of exactly `addressId`, `paymentMethod: "MOCK"`, `mockOutcome`; no spread. The cart client sends only a quantity. The server body is a strict object, so a price, total, fee, quantity, `storeId`, `userId`, or `items` key is a 400 anyway. Totals after a refusal (`refusal.totals`) and the summary are display only, parsed defensively (`readCheckoutRefusal`: safe non-negative integers, unknown entries dropped). | `t034-checkout-ui.test.ts`: wire body keys through a stub `fetch`, AST of the call site, strict-schema cases |
| Idempotency | Holds for security. One `crypto.randomUUID()` key per attempt, kept only while the outcome is unknown; the server binds the key to the user and returns the existing order on a repeat (API_CONTRACTS 5.5.2). | Code read; wire case checks the header |
| Prisma and layer boundaries (rule 7) | Holds. No T-034 file imports `src/server/db`, `@prisma/*`, or `pg`. The two client components and the three api-client files import `src/modules` as types only, except `cart-view.tsx`, which takes the constant `MAX_LINE_QUANTITY` from `src/modules/cart/schema.ts`; that file's only value import is `zod`, so the bundle gains a pure schema, no server code. Server sections call module services after `requireAccountActor`, as rule 1 asks. | Static cases; `pnpm lint` exit 0 |
| Secrets | Holds. No `process.env` in any T-034 file; pattern search of the commit found nothing. No manifest changed. | Static case; secret row in the register |
| Mock payment and simulated shipping labelled | Holds. Checkout: `NoticeLabel` "การชำระเงินจำลอง" on the payment card with the note that no money is charged, "การจัดส่งจำลอง" on the shipping card, and the failure option itself says "(จำลอง)". Order detail: mock label next to the payment status (when `payment.isSimulated`), method text "ชำระเงินจำลอง (ไม่ใช้เงินจริง)", simulated label on each store's shipping fee (when `shippingFeeIsSimulated`), on the shipment block, and always on the order's shipping total. Order list: mock label on each order. | Static cases; `th.ts:51-52,125-128,211,223` |
| XSS | Holds. No `dangerouslySetInnerHTML`, `innerHTML`, or `eval`. Product titles, store names, recipient, phone, and address lines are React text children; user-typed names go through `UserName` (`<bdi>`), as SEC-033 asks. Links: `orderHref` and `storeHref` percent-encode the id and the slug into a fixed path prefix; `router.push` takes `orderHref` of the server's id; the sign-in link uses `signInHref` of a fixed in-app path (`ROUTES.checkout`), so no open redirect. Images: `next/image` with a URL the server builds from the upload's storage key (`imageRef`), not from user text. | Static case; code read |
| IDOR, orders | Holds. `OrderSection` validates the id with `orderIdSchema`, then `getOrder(actor, id)` reads with `findOwnedOrder(actor.userId, id)`; another user's order and a missing one both reach `notFound()`, so the page is no oracle. `listOrders` is scoped by `actor.userId`; `page` and `pageSize` go through the endpoint's schema. | Code read; ownership is covered by the T-032 review and its integration tests (not re-run here) |
| IDOR, addresses | Holds. The page offers only the actor's addresses (`listAddresses(actor, ...)`); the server checks the chosen id with `findOwnedAddress(tx, actor.userId, addressId)` and answers a foreign id like a missing one. | Code read |
| Authentication | Holds. Each section calls `requireAccountActor`, which redirects to sign-in without a session; a session that ends during a service call is redirected too. The pages set `robots: noindex`. | Code read |
| CSRF | Unchanged. Mutations go through `apiRequest` with `credentials: "same-origin"` and a JSON content type; the routes' `Origin` checks were reviewed in T-031 and T-032. | Code read |

## Observations (not security findings; for code review)

1. After an unknown outcome the key is kept, but the address radios and the "simulate failure" checkbox stay enabled. If the customer changes either and confirms again, the same key returns the order of the first attempt (by design of the contract), so the order may ship to the earlier address. The order page shows the stored address, so nothing is hidden; it is a correctness and UX point. Locking the choices while `unknown` is true, or starting a new key when they change, would avoid it.
2. `apiRequest` spreads caller headers after `Content-Type`, so a caller could override it. Today the only caller passes `Idempotency-Key`. Worth a comment or an allow-list.
3. The checkout offers only the first page of addresses at the largest page size; D-044 caps addresses at 50 per user, which removes the gap once backend-api lands it.

## Commands

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/t034-checkout-ui.test.ts tests/security/sec081-recheck.test.ts --project security` | 2 files, 12 passed, 19 expected fail (all in the SEC-081 file) |
| `pnpm test --project security` | 37 files, 1309 passed, 23 expected fail, exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (137 of 137 import-guard probes) |
| `pnpm exec eslint` and `pnpm exec prettier --check` on the two new test files | exit 0 |
| `git show cb07d84 0f497a8` filtered for secret shapes | no match |

## Not covered

- No browser run, no e2e run, no run of the pages against a database, and no look at the built client bundle. That the bundle holds nothing beyond the pure cart schema rests on the import checks, not on reading the build output.
- The server endpoints (`/api/v1/checkout`, `/api/v1/orders`, `/api/v1/cart`) were not re-reviewed; they were reviewed under T-031 and T-032. Rate limiting of checkout is theirs.
- Cart UI files were read for the same properties but are not the focus of this review; `cart-view.tsx` and `cart-summary.tsx` show the same patterns.
