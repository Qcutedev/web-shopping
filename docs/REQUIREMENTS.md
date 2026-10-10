# Requirements

Single source of truth for what the marketplace must do. Owner: product-requirements agent.

Priority: `MVP` (first release), `LATER` (designed for, not built), `OUT` (not planned).

## Roles

| Role | How obtained |
| --- | --- |
| Guest | Not logged in. Can browse, search, and view products and stores. |
| Customer | Self-registration. |
| Seller | A customer whose seller application an admin approved. Keeps customer abilities. |
| Admin | Bootstrap script, or promotion by an existing admin (audited). |

## Business rules

| Id | Rule |
| --- | --- |
| BR-01 | Money is stored and computed in integer satang. Display is THB with two decimals. |
| BR-02 | Product unit price: 1.00 to 1,000,000.00 THB. |
| BR-03 | Quantity per cart line: 1 to 99, and never above current stock at checkout. |
| BR-04 | Order grand total may not exceed 20,000,000.00 THB (keeps totals inside a 32-bit integer of satang). |
| BR-05 | A product is purchasable only when: product status `PUBLISHED`, moderation status `APPROVED`, store status `APPROVED`, stock at least the requested quantity. |
| BR-06 | One store per seller account. |
| BR-07 | Checkout splits the cart into one seller order per store. Each seller order has its own fulfilment status and shipping fee. |
| BR-08 | Shipping fee in the MVP is a flat fee per seller order, taken from marketplace settings. It is labelled as a simulated rate. |
| BR-09 | Order items snapshot product name, SKU, unit price, and primary image at purchase. Orders snapshot the shipping address. Later edits never change history. |
| BR-10 | Payment status and fulfilment status are separate. See the state tables below. |
| BR-11 | A customer may review a product once per purchased order item, only after that item's seller order is `DELIVERED`. |
| BR-12 | Products referenced by any order are archived, never hard-deleted. |
| BR-13 | Commission rate is stored in settings and recorded on each seller order at purchase time. No payout is calculated in the MVP. |
| BR-14 | Suspending a store hides its products from the storefront and blocks new orders for it. Existing orders remain visible and can still be fulfilled. |
| BR-15 | Stock is decremented when the order is created. A failed or cancelled payment restores stock. |
| BR-16 | A seller cannot buy from their own store. |

### Payment status (per order)

| From | To | Trigger |
| --- | --- | --- |
| `PENDING` | `PAID` | Mock provider confirms |
| `PENDING` | `FAILED` | Mock provider declines (simulated failure) |
| `PAID` | `REFUNDED` | LATER |

### Fulfilment status (per seller order)

| From | To | Who |
| --- | --- | --- |
| `PENDING` | `PROCESSING` | Seller, only when payment is `PAID` |
| `PROCESSING` | `SHIPPED` | Seller; tracking number optional and entered by the seller |
| `SHIPPED` | `DELIVERED` | Seller or admin (simulated; no carrier confirmation) |
| `PENDING`, `PROCESSING` | `CANCELLED` | Seller or admin; restores stock |

Any other transition is rejected.

### Seller application and store status

`PENDING` to `APPROVED` or `REJECTED` (admin, with reason on rejection). `APPROVED` to `SUSPENDED` and back (admin, with reason). A rejected applicant may submit a new application.

## Customer stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-C-01 | Register with email and password | MVP | Valid input creates a `CUSTOMER` and logs in. Duplicate email gives a generic error. Password under 8 characters is rejected server-side. No request field can set the role. |
| REQ-C-02 | Log in and log out | MVP | Correct credentials start a session. Wrong credentials give one generic message. Logout invalidates the session server-side. Repeated failures are rate-limited. |
| REQ-C-03 | Manage profile | MVP | View and edit display name and phone. Cannot edit role or email of another user by any request. |
| REQ-C-04 | Manage addresses | MVP | Create, edit, delete, set default. Thai address fields: recipient, phone, line, subdistrict, district, province, postal code (5 digits). Another user's address id returns 404. |
| REQ-C-05 | Homepage discovery | MVP | Shows categories and newest purchasable products, paginated. Seeded data is labelled as sample. |
| REQ-C-06 | Search, filter, sort | MVP | Keyword search over product name. Filter by category and price range. Sort by newest and price. Paginated. Empty result shows an empty state. Only purchasable-visible products appear. |
| REQ-C-07 | Category pages | MVP | Lists products in the category with the same filters and pagination. Unknown or inactive category gives 404. |
| REQ-C-08 | Product detail | MVP | Gallery, name, price, description, stock state, store link. Rating shown only if reviews exist. Unpublished, unapproved, or suspended-store product gives 404 to the public. |
| REQ-C-09 | Store page | MVP | Store name, logo, description, and its purchasable products. Non-approved store gives 404. |
| REQ-C-10 | Cart | MVP | Add, change quantity, remove. Items grouped by store. Shows per-store and grand totals computed by the server. Items that became unavailable are flagged and excluded from checkout. |
| REQ-C-11 | Checkout | MVP | Choose address, see server-computed totals and shipping, choose mock payment. Creates one order with one seller order per store in a single transaction. Insufficient stock on any item fails the whole checkout with a clear message and no changes. Same idempotency key never creates a second order. |
| REQ-C-12 | Mock payment | MVP | Clearly labelled as a test payment in the UI and stored with provider `MOCK`. Supports a simulated success and a simulated failure. Failure sets payment `FAILED` and restores stock. |
| REQ-C-13 | Order confirmation and history | MVP | Confirmation page after checkout. History is paginated. Detail shows snapshots, per-seller fulfilment status, tracking if entered. Another customer's order id returns 404. |
| REQ-C-14 | Reviews | MVP | Rating 1 to 5 and optional text, subject to BR-11. Text is rendered escaped. |
| REQ-C-15 | Password recovery | LATER | Needs an email provider. Not faked. |
| REQ-C-16 | Wishlist, vouchers, chat | OUT | |

## Seller stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-S-01 | Apply to sell | MVP | Logged-in customer submits store name, description, contact phone. One open application at a time. Status visible to the applicant. |
| REQ-S-02 | Store settings | MVP | Approved seller edits name, description, logo. Slug is unique. |
| REQ-S-03 | Dashboard summary | MVP | Counts of products, low-stock items, orders by status, and paid sales total, all scoped to the seller's store and computed from real rows. |
| REQ-S-04 | Product CRUD | MVP | Create, edit, publish, unpublish, archive. Fields: title, description, SKU (unique per store), category, price, stock. New and materially edited products enter moderation per settings. Another store's product id returns 404 on read, update, and delete. |
| REQ-S-05 | Image upload | MVP | JPEG, PNG, WebP only; maximum 5 MB each; maximum 8 per product. Content is checked, not only the extension. Stored under a generated name. |
| REQ-S-06 | Inventory | MVP | Set stock to an absolute value or adjust by a delta; never below zero. |
| REQ-S-07 | Seller orders | MVP | Paginated list and detail of the seller's own seller orders only, with buyer shipping snapshot. Another store's seller order id returns 404. |
| REQ-S-08 | Fulfilment updates | MVP | Transitions follow the fulfilment table. Invalid transitions are rejected. |
| REQ-S-09 | Non-approved seller limits | MVP | Pending, rejected, or suspended sellers cannot create, publish, or sell products. Server-enforced. |
| REQ-S-10 | Payouts and commission statements | LATER | |

## Admin stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-A-01 | Protected dashboard | MVP | Every admin page and endpoint rejects non-admins on the server. Summary metrics come from real rows. |
| REQ-A-02 | User management | MVP | Paginated, searchable list. Deactivate and reactivate a user (revokes sessions). An admin cannot deactivate themselves or remove the last admin. |
| REQ-A-03 | Seller application review | MVP | Approve or reject with reason. Approval creates or activates the store and sets the user's role to `SELLER`. |
| REQ-A-04 | Suspend and reinstate | MVP | With reason. Effects per BR-14. |
| REQ-A-05 | Product moderation | MVP | Queue of pending products. Approve, reject with reason, or take down an approved product. |
| REQ-A-06 | Category management | MVP | Create, rename, reorder, deactivate. A category with products cannot be hard-deleted. |
| REQ-A-07 | Order oversight | MVP | Paginated, filterable list of all orders and details. May cancel or mark delivered per the fulfilment table. |
| REQ-A-08 | Reports | MVP | Orders, paid revenue, new users, and new sellers over a date range, from real rows. |
| REQ-A-09 | Marketplace settings | MVP | Flat shipping fee, commission rate, moderation mode (pre-approval on or off). |
| REQ-A-10 | Audit log | MVP | Every action in REQ-A-02 to A-07 and A-09 writes who, what, target, before and after summary, and when. Read-only, paginated. |
| REQ-A-11 | Admin bootstrap | MVP | First admin is created by a documented script from environment input. No default password. No public endpoint grants admin. |

## Nonfunctional

| Id | Requirement | Priority |
| --- | --- | --- |
| REQ-N-01 | All customer-facing text in Thai; THB and `th-TH` formatting. | MVP |
| REQ-N-02 | Responsive at 360, 768, and 1280 pixel widths. | MVP |
| REQ-N-03 | WCAG 2.1 AA contrast, keyboard operability, labelled forms. | MVP |
| REQ-N-04 | Authorization and validation enforced server-side on every protected operation. | MVP |
| REQ-N-05 | No overselling under concurrent checkout. | MVP |
| REQ-N-06 | All list endpoints paginated with a maximum page size of 50. | MVP |
| REQ-N-07 | Structured logs, health endpoint, environment validation at startup. | MVP |
| REQ-N-08 | No secrets in the repository or client bundle. | MVP |
| REQ-N-09 | Sample data, mock payment, and simulated shipping are labelled wherever shown. | MVP |
| REQ-N-10 | Runs locally from documented steps on Windows. | MVP |
| REQ-N-11 | Dedicated search service, real payment gateway, real carrier integration, email delivery, object storage in production. | LATER |

## Open questions (defaults assumed until the owner decides otherwise)

| # | Question | Default in use |
| --- | --- | --- |
| Q1 | Flat shipping fee amount | 40.00 THB per seller order |
| Q2 | Must products be approved before going live? | Yes, pre-approval on |
| Q3 | Commission rate placeholder | 5 percent, recorded only |
| Q4 | Can customers cancel their own orders? | No in the MVP; seller or admin only |
| Q5 | Guest cart before login | No; login required to add to cart |
| Q6 | Marketplace name and logo | Placeholder name until provided |

## Traceability

Requirement to task mapping is kept in [PROJECT_PLAN.md](PROJECT_PLAN.md) (each task lists the requirement ids it covers). Test file mapping is added to [TEST_STRATEGY.md](TEST_STRATEGY.md) as tests are written.
