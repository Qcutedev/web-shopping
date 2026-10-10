# Requirements

Single source of truth for what the marketplace must do. Owner: product-requirements agent.

Priority: `MVP` (first release), `LATER` (designed for, not built), `OUT` (not planned).

Where a rule or criterion carries a tag such as "(open: Q9)", the behaviour is not yet decided. It must not be built on a guess; see [Open questions](#open-questions-awaiting-the-owner).

## Roles

| Role | How obtained |
| --- | --- |
| Guest | Not logged in. Can browse, search, and view products and stores. Cannot hold a cart (Q5). |
| Customer | Self-registration. |
| Seller | A customer whose seller application an admin approved. Keeps customer abilities. |
| Admin | Bootstrap script (REQ-A-11). Promotion by an existing admin is not yet defined as a story (open: Q16). |

## Terms

| Term | Meaning |
| --- | --- |
| Title | The product's name. "Product name" and "title" mean the same field. |
| Visible | A product is visible on the storefront when its product status is `PUBLISHED`, its moderation status is `APPROVED`, and its store status is `APPROVED`. Stock does not affect visibility: a visible product with zero stock is shown as out of stock (see REQ-C-08; confirmation requested in Q14). |
| Purchasable | Visible, and stock is at least the requested quantity (BR-05). |

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
| BR-08 | Shipping fee is a flat fee per seller order, taken from marketplace settings. The initial value is 40.00 THB (4,000 satang) per seller order (Q1). An admin may change it (REQ-A-09); a change applies only to orders created afterwards. The fee is labelled as a simulated rate wherever it is shown. |
| BR-09 | Order items snapshot product title, SKU, unit price, and primary image at purchase. Orders snapshot the shipping address. Seller orders snapshot the shipping fee and commission rate. Later edits never change history. |
| BR-10 | Payment status and fulfilment status are separate. See the state tables below. |
| BR-11 | A customer may review a product once per purchased order item, only after that item's seller order is `DELIVERED`. |
| BR-12 | Products referenced by any order are archived, never hard-deleted. |
| BR-13 | Commission rate is stored in settings and recorded on each seller order at purchase time. The initial value is 5 percent (Q3). It is recorded only: nothing is deducted from any amount, and no payout is calculated in the MVP. |
| BR-14 | Suspending a store hides its products from the storefront and blocks new orders for it. Existing orders remain visible to the seller and the customer and can still be fulfilled by the seller. |
| BR-15 | Stock is decremented when the order is created. Stock is restored when the payment becomes `FAILED`, and when a seller order is moved to `CANCELLED`. |
| BR-16 | A seller cannot buy from their own store. |

### Payment status (per order)

| From | To | Trigger |
| --- | --- | --- |
| `PENDING` | `PAID` | Mock provider confirms |
| `PENDING` | `FAILED` | Mock provider declines (simulated failure) |
| `PAID` | `REFUNDED` | LATER |

Any other transition is rejected. Whether a `FAILED` order can be paid again is not decided (open: Q10).

### Fulfilment status (per seller order)

| From | To | Who |
| --- | --- | --- |
| `PENDING` | `PROCESSING` | Seller, only when payment is `PAID` |
| `PROCESSING` | `SHIPPED` | Seller; tracking number and carrier name optional and entered by the seller |
| `SHIPPED` | `DELIVERED` | Seller or admin (simulated; no carrier confirmation) |
| `PENDING`, `PROCESSING` | `CANCELLED` | Seller or admin; restores stock |

Any other transition is rejected.

Customers cannot cancel their own orders in the MVP (Q4). No customer-facing cancel action exists, and any attempt by a customer to change a seller order's status is rejected and changes nothing.

What a customer sees, and what happens to the payment, when a seller order is cancelled after the order was `PAID` is not decided (open: Q11).

### Seller application and store status

`PENDING` to `APPROVED` or `REJECTED` (admin, with reason on rejection). `APPROVED` to `SUSPENDED` and back (admin, with reason). A rejected applicant may submit a new application. Any other transition is rejected.

### Product moderation

Products require admin approval before they go live (Q2). A new product has moderation status `PENDING` and is not visible until an admin approves it. The "moderation mode" setting in REQ-A-09 has the initial value "pre-approval on". Whether the switch stays, and what "off" does, is open (Q7). Which edits send an approved product back to moderation is open (Q8). Whether a rejected or taken-down product can be resubmitted is open (Q9).

## Customer stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-C-01 | Register with email and password | MVP | Valid input creates a `CUSTOMER` and logs in. Duplicate email gives a generic error and creates no user. Password under 8 characters is rejected server-side. No request field can set the role. |
| REQ-C-02 | Log in and log out | MVP | Correct credentials start a session. Wrong credentials give one generic message that does not reveal whether the email exists. Logout invalidates the session server-side: the old session cookie is rejected afterwards. Sign-in attempts above the limit listed under "Rate limits" in [API_CONTRACTS.md](API_CONTRACTS.md) are rejected with 429. A deactivated user (REQ-A-02) cannot log in. |
| REQ-C-03 | Manage profile | MVP | View and edit own display name and phone. No request changes a user's role or email, or any field of another user's profile. A guest is rejected with 401. |
| REQ-C-04 | Manage addresses | MVP | Create, edit, delete, set default; at most one default per user. Thai address fields: recipient, phone, line, subdistrict, district, province, postal code (5 digits). A postal code that is not exactly 5 digits is rejected. Another user's address id returns 404 on read, edit, and delete. A guest is rejected with 401. |
| REQ-C-05 | Homepage discovery | MVP | Shows active categories and the newest visible products, paginated. Seeded data is labelled as sample. |
| REQ-C-06 | Search, filter, sort | MVP | Keyword search over product title. Filter by category and price range. Sort by newest, price ascending, and price descending. Paginated. Empty result shows an empty state. Only visible products appear. |
| REQ-C-07 | Category pages | MVP | Lists visible products in the category with the same filters and pagination. Unknown or inactive category gives 404. The effect of deactivating a category on its products elsewhere on the storefront is open (Q13). |
| REQ-C-08 | Product detail | MVP | Gallery, title, price, description, stock state (at minimum in stock or out of stock), store link. Rating shown only if reviews exist. Unpublished, unapproved, or suspended-store product gives 404 to the public. |
| REQ-C-09 | Store page | MVP | Store name, logo, description, and its visible products, paginated. Non-approved store gives 404. |
| REQ-C-10 | Cart | MVP | Login is required: there is no guest cart (Q5). A guest's add-to-cart request is rejected with 401, stores nothing, and the storefront sends the guest to the login page. A logged-in user can add, change quantity, and remove. Quantity outside 1 to 99 is rejected (BR-03). A product from the user's own store is rejected and no cart line is created (BR-16). Another user's cart line id returns 404. Items are grouped by store. Per-store and grand totals are computed by the server from current prices; no client-sent amount is used. Items that became unavailable are flagged (how checkout treats them is open: Q12). |
| REQ-C-11 | Checkout | MVP | Choose address, see server-computed totals and shipping, choose mock payment. Creates one order with one seller order per store in a single transaction. Shipping total equals the flat fee multiplied by the number of seller orders (BR-08). Client-sent prices, totals, and fees are ignored. Insufficient stock on any item fails the whole checkout with a clear message, creates no order, and changes no stock. An address id that does not belong to the customer returns 404 and creates no order. A cart with nothing to buy is rejected and creates no order. A grand total above BR-04 is rejected, creates no order, and changes no stock. A repeat request with the same idempotency key returns the original order and never creates a second one, including when the two requests arrive at the same time. A guest is rejected with 401. |
| REQ-C-12 | Mock payment | MVP | Clearly labelled as a test payment in the UI and stored with provider `MOCK`. Supports a simulated success and a simulated failure. Success sets payment `PAID`. Failure sets payment `FAILED` and restores stock for every item in the order. What the customer can do next after a failure is open (Q10). |
| REQ-C-13 | Order confirmation and history | MVP | Confirmation page after checkout. History is paginated and lists only the customer's own orders. Detail shows snapshots, per-seller fulfilment status, tracking if entered. Another customer's order id returns 404. A guest is rejected with 401. No cancel action is offered to the customer (Q4). |
| REQ-C-14 | Reviews | MVP | Rating 1 to 5 and optional text, subject to BR-11. Rejected with no review created: rating outside 1 to 5; item's seller order not `DELIVERED`; reviewer is not the buyer of the item; a second review for the same order item. Text is rendered escaped. |
| REQ-C-15 | Password recovery | LATER | Needs an email provider. Not faked. |
| REQ-C-16 | Wishlist, vouchers, chat | OUT | |

## Seller stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-S-01 | Apply to sell | MVP | Logged-in customer submits store name, description, contact phone. One open application at a time: a second submission while one is `PENDING` is rejected and creates nothing. A user who already owns a store cannot apply (BR-06). Status and, on rejection, the reason are visible to the applicant. A guest is rejected with 401. |
| REQ-S-02 | Store settings | MVP | Approved seller edits name, description, logo. Slug is unique across stores. A seller can edit only their own store. |
| REQ-S-03 | Dashboard summary | MVP | Counts of products, low-stock items (threshold open: Q15), orders by status, and paid sales total (definition open: Q11), all scoped to the seller's store and computed from real rows. |
| REQ-S-04 | Product CRUD | MVP | Create, edit, publish, unpublish, archive, delete. Fields: title, description, SKU (unique per store), category, price, stock. Price outside BR-02 is rejected. A duplicate SKU within the store is rejected. A new product enters moderation as `PENDING` and is not visible until approved (Q2). Which edits return an approved product to moderation is open (Q8). Deleting a product that any order references archives it instead (BR-12). Another store's product id returns 404 on read, update, and delete. |
| REQ-S-05 | Image upload | MVP | JPEG, PNG, WebP only; maximum 5 MB each; maximum 8 per product. Content is checked, not only the extension: a file whose content does not match an allowed type is rejected. A ninth image for one product is rejected. Stored under a generated name. |
| REQ-S-06 | Inventory | MVP | Set stock to an absolute value or adjust by a delta. No request results in stock below zero. Another store's product id returns 404. |
| REQ-S-07 | Seller orders | MVP | Paginated list and detail of the seller's own seller orders only, with buyer shipping snapshot. For an order spanning several stores the seller sees only their own portion. Another store's seller order id returns 404. |
| REQ-S-08 | Fulfilment updates | MVP | Transitions follow the fulfilment table. Invalid transitions are rejected and change nothing. `PENDING` to `PROCESSING` is rejected unless the order's payment is `PAID`. Cancelling restores stock for the seller order's items. |
| REQ-S-09 | Non-approved seller limits | MVP | Pending, rejected, or suspended sellers cannot create, publish, or sell products. Server-enforced. A suspended seller can still view and fulfil their existing seller orders (BR-14). |
| REQ-S-10 | Payouts and commission statements | LATER | |

## Admin stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-A-01 | Protected dashboard | MVP | Every admin page and endpoint rejects non-admins on the server: a guest gets 401, a customer or seller gets 403. Summary metrics come from real rows. |
| REQ-A-02 | User management | MVP | Paginated, searchable list. Deactivate and reactivate a user. Deactivation revokes the user's sessions and blocks login until reactivation. An admin cannot deactivate themselves or remove the last admin; both attempts are rejected and change nothing. The effect of deactivating a seller on their store is open (Q17). |
| REQ-A-03 | Seller application review | MVP | Approve, or reject with a reason; rejection without a reason is rejected. Approval creates or activates the store and sets the user's role to `SELLER`. Reviewing an application that is not `PENDING` is rejected. |
| REQ-A-04 | Suspend and reinstate | MVP | A reason is required. Effects per BR-14. Suspending a store that is not `APPROVED`, or reinstating one that is not `SUSPENDED`, is rejected. |
| REQ-A-05 | Product moderation | MVP | Queue of pending products. Approve, reject with reason, or take down an approved product with reason. A rejected or taken-down product is not visible. |
| REQ-A-06 | Category management | MVP | Create, rename, reorder, deactivate. A category with products cannot be hard-deleted. |
| REQ-A-07 | Order oversight | MVP | Paginated, filterable list of all orders and details. May cancel or mark delivered per the fulfilment table; any other transition by an admin is rejected. |
| REQ-A-08 | Reports | MVP | Orders, paid revenue (definition open: Q11), new users, and new sellers over a date range, from real rows. |
| REQ-A-09 | Marketplace settings | MVP | Flat shipping fee (initial value 40.00 THB, Q1), commission rate (initial value 5 percent, Q3), moderation mode (pre-approval on or off; initial value on, Q2; switch open: Q7). A change applies to orders and products created afterwards and never alters existing orders. Allowed ranges for the fee and the rate are open (Q19). |
| REQ-A-10 | Audit log | MVP | Every action in REQ-A-02 to A-07 and A-09 writes who, what, target, before and after summary, and when. Read-only, paginated. No request edits or deletes an audit entry. |
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
| REQ-N-12 | The marketplace name is a placeholder until the owner provides the real name and logo (Q6). The name is defined as a single string in exactly one place; changing that one string changes the name everywhere it is displayed (header, footer, page titles). No logo image is required until one is provided. | MVP |

## Confirmed decisions

Confirmed by the owner on 2026-10-11, see [DECISIONS.md](DECISIONS.md) D-017. These are rules, not defaults.

| # | Question | Decision | Status | Stated in |
| --- | --- | --- | --- | --- |
| Q1 | Flat shipping fee amount | 40.00 THB per seller order | Confirmed by owner 2026-10-11, see D-017 | BR-08, REQ-C-11, REQ-A-09 |
| Q2 | Must products be approved before going live? | Yes. Admin approval is required before a product is visible | Confirmed by owner 2026-10-11, see D-017 | Product moderation, REQ-S-04, REQ-A-05, REQ-A-09 |
| Q3 | Commission rate | 5 percent, recorded only, nothing deducted | Confirmed by owner 2026-10-11, see D-017 | BR-13, REQ-A-09 |
| Q4 | Can customers cancel their own orders? | No in the MVP; seller or admin only | Confirmed by owner 2026-10-11, see D-017 | Fulfilment status, REQ-C-13 |
| Q5 | Guest cart before login | No guest cart; login required to add to cart | Confirmed by owner 2026-10-11, see D-017 | Roles, REQ-C-10 |
| Q6 | Marketplace name and logo | Placeholder name used; real name and logo to be provided by the owner. Use of a placeholder in one replaceable place is confirmed (D-017); the name and logo themselves remain outstanding | Partly open | REQ-N-12 |

## Open questions awaiting the owner

Raised on 2026-10-11 during the T-004 review. None is decided. The "Recommended default" column is a suggestion only and is **not in effect**; per D-019 nothing here is to be built on a guess.

| # | Question | Affects | Recommended default (not in effect) |
| --- | --- | --- | --- |
| Q7 | Should admins keep a switch that turns product pre-approval off? If yes, what happens to new products and to products already waiting when it is off? | REQ-A-09, REQ-S-04 | Remove the switch from the MVP; approval is always required |
| Q8 | Which edits to an approved product send it back for approval, and does it stay on sale while it waits? | REQ-S-04 | Title, description, category, and image changes return it to `PENDING` and hide it; price and stock changes do not |
| Q9 | After a product is rejected or taken down, can the seller correct it and resubmit? | REQ-S-04, REQ-A-05 | Yes; editing it returns it to `PENDING` |
| Q10 | After a failed payment, can the customer pay again for the same order, or must they check out again? Do the items return to the cart? | REQ-C-12, payment status table | No retry; the order stays `FAILED` and the items are put back in the cart |
| Q11 | When a seller order is cancelled after payment, what happens to the money and what does the customer see, given refunds are `LATER`? Do cancelled seller orders count in "paid sales" and "paid revenue"? | Fulfilment table, REQ-S-03, REQ-A-08 | Show "cancelled, refund handled outside the system (simulated)"; exclude cancelled seller orders from sales totals |
| Q12 | If one item in the cart can no longer be bought (removed, store suspended, or sold out), does checkout go ahead with the remaining items or stop until the customer removes it? | REQ-C-10, REQ-C-11 | Stop with a clear message naming the item; nothing is ordered |
| Q13 | When an admin deactivates a category, do its products disappear from search, store pages, and purchase, or does only the category page go away? | REQ-C-07, REQ-A-06, BR-05 | Only the category page and category filter go away |
| Q14 | Do sold-out products stay visible in listings and on their page, marked as out of stock? The current text says yes, following REQ-C-08. | Terms, REQ-C-05 to C-09 | Yes |
| Q15 | At what stock level does a product count as "low stock" on the seller dashboard? | REQ-S-03 | 5 or fewer |
| Q16 | In the MVP, can an admin make another user an admin from the admin screens, or are admins created only by the setup script? | Roles, REQ-A-02, REQ-A-10 | Setup script only |
| Q17 | When an admin deactivates a user who is a seller, is their store hidden as if suspended? | REQ-A-02, BR-14 | Yes, treated as suspended while deactivated |
| Q18 | What placeholder marketplace name should be displayed until the real one is provided? | REQ-N-12 | An obviously temporary Thai name |
| Q19 | What limits apply to the settings an admin can enter (highest shipping fee, commission range)? | REQ-A-09 | Fee 0.00 to 1,000.00 THB; commission 0 to 100 percent |

## Traceability

[PROJECT_PLAN.md](PROJECT_PLAN.md) is authoritative for what each task covers; this table is the reverse index and shows gaps. Test file mapping is recorded in [TEST_STRATEGY.md](TEST_STRATEGY.md) as tests are written; no test files exist yet.

| Requirement | Tasks | Test files |
| --- | --- | --- |
| REQ-C-01, REQ-C-02 | T-015 | none yet |
| REQ-C-03, REQ-C-04 | T-030 | none yet |
| REQ-C-05 to REQ-C-09 | T-020, T-021 | none yet |
| REQ-C-10 | T-031, T-034 | none yet |
| REQ-C-11 to REQ-C-13 | T-032, T-034 | none yet |
| REQ-C-14 | T-035 | none yet |
| REQ-S-01, REQ-S-02, REQ-S-09 | T-040, T-044 | none yet |
| REQ-S-03 | T-044 (pages only). **Gap: no backend task** | none yet |
| REQ-S-04, REQ-S-06 | T-042, T-044 | none yet |
| REQ-S-05 | T-041, T-044 | none yet |
| REQ-S-07, REQ-S-08 | T-043, T-044 | none yet |
| REQ-A-01 to REQ-A-10 | T-050, T-051 | none yet |
| REQ-A-11 | T-016 | none yet |
| REQ-N-01 | T-017, T-018 | none yet |
| REQ-N-02 | T-017, T-018 | none yet |
| REQ-N-03 | T-017 | none yet |
| REQ-N-04 | T-015, T-045, T-052 | none yet |
| REQ-N-05 | T-033 | none yet |
| REQ-N-06 | **Gap: no task lists it** | none yet |
| REQ-N-07 | T-011, T-019 | none yet |
| REQ-N-08 | **Gap: no task lists it** | none yet |
| REQ-N-09 | T-014 (sample data only). **Gap: mock payment and simulated shipping labels not listed by any task** | none yet |
| REQ-N-10 | T-010, T-012 | none yet |
| REQ-N-12 | **Gap: new on 2026-10-11, no task lists it** | none yet |
| BR-01 to BR-16 | T-013 (schema) | none yet |
| BR-07 to BR-15 | T-032 | none yet |
| BR-16 | T-013 only. **Gap: enforced in cart or checkout, which no task lists** | none yet |
