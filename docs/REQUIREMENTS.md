# Requirements

Single source of truth for what the marketplace must do. Owner: product-requirements agent.

Priority: `MVP` (first release), `LATER` (designed for, not built), `OUT` (not planned).

Where a rule or criterion carries a tag such as "(open: Q21)", the behaviour is not yet decided. It must not be built on a guess; see [Open questions](#open-questions-awaiting-the-owner).

## Roles

| Role | How obtained |
| --- | --- |
| Guest | Not logged in. Can browse, search, and view products and stores. Cannot hold a cart (Q5). |
| Customer | Self-registration. |
| Seller | A customer whose seller application an admin approved. Keeps customer abilities. |
| Admin | Bootstrap script only (REQ-A-11, BR-26). No admin screen or endpoint grants the admin role in the MVP. |

## Terms

| Term | Meaning |
| --- | --- |
| Title | The product's name. "Product name" and "title" mean the same field. |
| Visible | A product is visible on the storefront when every visibility condition in BR-05 holds. Stock does not affect visibility: a visible product with zero stock is sold out and stays visible (BR-24). |
| Not visible (hidden) | A product that fails any visibility condition in BR-05. It appears in no storefront listing or search result, its product page returns 404 to the public, and it cannot be added to a cart or bought. |
| Sold out | A visible product whose stock is 0. Marked "สินค้าหมด" (BR-24). |
| Low stock | Stock of 5 or fewer (BR-25). |
| Purchasable | Visible, and stock is at least the requested quantity (BR-05). |
| Store owner | The user account that owns a store (BR-06). |

## Business rules

| Id | Rule |
| --- | --- |
| BR-01 | Money is stored and computed in integer satang. Display is THB with two decimals. |
| BR-02 | Product unit price: 1.00 to 1,000,000.00 THB. |
| BR-03 | Quantity per cart line: 1 to 99, and never above current stock at checkout. |
| BR-04 | Order grand total may not exceed 20,000,000.00 THB (keeps totals inside a 32-bit integer of satang). |
| BR-05 | Visibility rule. A product is visible on the storefront only when all five conditions hold: (1) product status `PUBLISHED`; (2) moderation status `APPROVED`, so a product awaiting first approval, awaiting re-approval after an edit (BR-18), rejected, or taken down is not visible; (3) store status `APPROVED`; (4) the store owner's user account is active (BR-27); (5) the product's category is active (BR-23). Stock is not a visibility condition: a product that meets all five conditions with stock 0 stays visible and is marked "สินค้าหมด" (BR-24). A product that is not visible appears in no homepage, search, category, or store listing, its product page returns 404 to the public, and it cannot be added to a cart or bought. A product is purchasable only when it is visible and its stock is at least the requested quantity. |
| BR-06 | One store per seller account. |
| BR-07 | Checkout splits the cart into one seller order per store. Each seller order has its own fulfilment status and shipping fee. |
| BR-08 | Shipping fee is a flat fee per seller order, taken from marketplace settings. The initial value is 40.00 THB (4,000 satang) per seller order (Q1). An admin may change it (REQ-A-09); a change applies only to orders created afterwards. The fee is labelled as a simulated rate wherever it is shown. |
| BR-09 | Order items snapshot product title, SKU, unit price, and primary image at purchase. Orders snapshot the shipping address. Seller orders snapshot the store name, the shipping fee, and the commission rate. Later edits never change history: after a store is renamed, every order placed before the rename still shows the store name as it was at purchase, to the customer, the seller, and the admin (D-025, OQ-18). |
| BR-10 | Payment status and fulfilment status are separate. See the state tables below. |
| BR-11 | A customer may review a product once per purchased order item, only after that item's seller order is `DELIVERED`. |
| BR-12 | Products referenced by any order are archived, never hard-deleted. |
| BR-13 | Commission rate is stored in settings and recorded on each seller order at purchase time. The initial value is 5 percent (Q3). It is recorded only: nothing is deducted from any amount, and no payout is calculated in the MVP. |
| BR-14 | Suspending a store hides its products from the storefront and blocks new orders for it. Existing orders remain visible to the seller and the customer and can still be fulfilled by the seller. |
| BR-15 | Stock is decremented when the order is created. Stock is restored when the payment becomes `FAILED`, and when a seller order is moved to `CANCELLED`. Stock for one order item is restored at most once across all paths (D-023). |
| BR-16 | A seller cannot buy from their own store. |
| BR-17 | Product approval is always required. There is no setting, switch, or request that turns approval off or lets a product become visible without an admin approving it. Marketplace settings contain no moderation on/off option (D-025, OQ-04). |
| BR-18 | Re-approval after an edit. When a seller changes the title, description, category, or pictures of a product whose moderation status is `APPROVED`, its moderation status returns to `PENDING`, it enters the admin moderation queue, and it is not visible (BR-05) until an admin approves it again. Only those four fields trigger re-approval. A change to price or stock (and to any other field) leaves the moderation status unchanged and takes effect at once: the new price or stock is what the storefront shows and what checkout uses from that moment. A save in which none of the four fields differs from the stored value does not trigger re-approval (D-025, OQ-05). |
| BR-19 | A product that an admin rejected or took down is not final. The seller who owns it can correct it and submit it again; a resubmitted product has moderation status `PENDING`, enters the admin moderation queue, and stays not visible until an admin approves it (D-025, OQ-06). How the seller triggers resubmission is open (Q20). |
| BR-20 | Failed payment. When an order's payment becomes `FAILED`: (1) stock is restored (BR-15); (2) every item of the order is returned to the customer's cart; (3) the order stays `FAILED` permanently: no request pays, retries, or reopens it, and the customer buys the items only by checking out again, which creates a new order; (4) sellers do not see the order: its seller orders appear in no seller order list, a seller's request for one of them by id returns 404, and they are counted in no seller dashboard figure (D-025, OQ-07). |
| BR-21 | Cancelling a paid order. A seller (own seller orders only) or an admin may cancel a seller order whose order payment is `PAID`, while its fulfilment status is `PENDING` or `PROCESSING`. The cancelled seller order is displayed as "ยกเลิกแล้ว คืนเงินนอกระบบ" wherever its status is shown. The system records no refund: the payment status stays `PAID` and no refund record or amount is created. A cancelled seller order is not counted in any sales or revenue figure (REQ-S-03, REQ-A-08) (D-025, OQ-08). |
| BR-22 | No partial purchase. If any item in the cart cannot be bought at checkout (the product is not visible under BR-05, or its stock is below the line's quantity), the whole checkout stops: no order is created, no stock changes, nothing is charged, and the response identifies each item that cannot be bought. Checkout succeeds only after the customer has removed or fixed every such item (D-025, OQ-09). |
| BR-23 | Inactive category. While a category is inactive, every product in it is not visible (BR-05): it is absent from the homepage, search results, category pages, and store pages, its product page returns 404 to the public, and it cannot be added to a cart or bought (D-025, OQ-10). |
| BR-24 | Sold-out products stay visible. A product that meets the visibility conditions of BR-05 and has stock 0 still appears in listings, search, and on its product page, and is marked "สินค้าหมด" in each of those places. It cannot be bought while its stock is 0 (D-025, OQ-11). |
| BR-25 | "Low stock" means stock of 5 or fewer. This is the only definition of low stock in the product (D-025, OQ-12). |
| BR-26 | In the MVP an admin account is created only by the bootstrap script (REQ-A-11). No admin screen and no endpoint gives a user the admin role (D-025, OQ-13). |
| BR-27 | Deactivated store owner. While the user account that owns a store is deactivated (REQ-A-02), the store and all of its products are hidden: the store page returns 404 to the public, its products are not visible (BR-05), and they cannot be added to a cart or bought (D-025, OQ-14). |
| BR-28 | Limits on marketplace settings. Flat shipping fee: 0.00 to 1,000.00 THB inclusive (0 to 100,000 satang). Commission rate: 0 to 100 percent inclusive. A value outside its range is rejected and the setting keeps its previous value (D-025, OQ-16). |
| BR-29 | A seller order whose fulfilment status is `SHIPPED` can only become `DELIVERED`. It cannot be cancelled, and there is no "lost" status or action in the MVP (D-025, OQ-17). |
| BR-30 | Quantity above stock. When a product's stock has dropped below a quantity the customer already chose (in a cart line or in the quantity selector on a product page) and the stock is at least 1, the quantity is lowered automatically to the stock available and the customer is shown a message saying that it was lowered. The customer is never left holding a quantity above stock without being told. When the stock is 0 the product is sold out (BR-24): the cart line is flagged as not buyable and blocks checkout under BR-22 (D-025, OQ-23). |

### Payment status (per order)

| From | To | Trigger |
| --- | --- | --- |
| `PENDING` | `PAID` | Mock provider confirms |
| `PENDING` | `FAILED` | Mock provider declines (simulated failure) |
| `PAID` | `REFUNDED` | LATER |

Any other transition is rejected. `FAILED` is final: a failed order is never paid again or retried, and its items return to the customer's cart (BR-20). `REFUNDED` is not reachable in the MVP: cancelling a paid seller order leaves the payment `PAID` (BR-21).

### Fulfilment status (per seller order)

| From | To | Who |
| --- | --- | --- |
| `PENDING` | `PROCESSING` | Seller, only when payment is `PAID` |
| `PROCESSING` | `SHIPPED` | Seller; tracking number and carrier name optional and entered by the seller |
| `SHIPPED` | `DELIVERED` | Seller or admin (simulated; no carrier confirmation) |
| `PENDING`, `PROCESSING` | `CANCELLED` | Seller or admin, whether or not the order is already paid (BR-21); restores stock |

Any other transition is rejected. In particular `SHIPPED` to `CANCELLED` is rejected and changes nothing, and no "lost" status exists (BR-29).

Customers cannot cancel their own orders in the MVP (Q4). No customer-facing cancel action exists, and any attempt by a customer to change a seller order's status is rejected and changes nothing.

A seller order that is cancelled after its order was paid is displayed as "ยกเลิกแล้ว คืนเงินนอกระบบ"; the payment stays `PAID` and no refund is recorded (BR-21).

Sellers do not see the seller orders of an order whose payment is `FAILED` (BR-20). Which fulfilment status those seller orders carry, and what the customer and the admin are shown for them, is open (Q21).

### Seller application and store status

`PENDING` to `APPROVED` or `REJECTED` (admin, with reason on rejection). `APPROVED` to `SUSPENDED` and back (admin, with reason). A rejected applicant may submit a new application. Any other transition is rejected.

### Product moderation

Products require admin approval before they go live (Q2), and approval can never be switched off (BR-17). A new product has moderation status `PENDING` and is not visible until an admin approves it.

| Event | Who | Result |
| --- | --- | --- |
| Product created | Seller | Moderation status `PENDING`; not visible |
| Approve a `PENDING` product | Admin | `APPROVED`; visible if the other conditions of BR-05 hold |
| Reject a `PENDING` product, with reason | Admin | Rejected; not visible; the seller can correct and resubmit it (BR-19) |
| Take down an `APPROVED` product, with reason | Admin | Taken down; not visible; the seller can correct and resubmit it (BR-19) |
| Change title, description, category, or pictures of an `APPROVED` product | Seller | Back to `PENDING`; not visible until approved again (BR-18) |
| Change price or stock of an `APPROVED` product | Seller | Stays `APPROVED`; the change takes effect at once (BR-18) |
| Resubmit a rejected or taken-down product | Seller | `PENDING`; not visible until approved (BR-19) |

A seller can never set a product's moderation status to `APPROVED`: any seller request that tries is rejected and changes nothing.

## Customer stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-C-01 | Register with email and password | MVP | Valid input creates a `CUSTOMER` and logs in. Duplicate email gives a generic error and creates no user. Password under 8 characters is rejected server-side. No request field can set the role. |
| REQ-C-02 | Log in and log out | MVP | Correct credentials start a session. Wrong credentials give one generic message that does not reveal whether the email exists. Logout invalidates the session server-side: the old session cookie is rejected afterwards. Sign-in attempts above the limit listed under "Rate limits" in [API_CONTRACTS.md](API_CONTRACTS.md) are rejected with 429. A deactivated user (REQ-A-02) cannot log in. |
| REQ-C-03 | Manage profile | MVP | View and edit own display name and phone. No request changes a user's role or email, or any field of another user's profile. A guest is rejected with 401. |
| REQ-C-04 | Manage addresses | MVP | Create, edit, delete, set default; at most one default per user. Thai address fields: recipient, phone, line, subdistrict, district, province, postal code (5 digits). A postal code that is not exactly 5 digits is rejected. Another user's address id returns 404 on read, edit, and delete. A guest is rejected with 401. |
| REQ-C-05 | Homepage discovery | MVP | Shows active categories and the newest visible products, paginated. Seeded data is labelled as sample. |
| REQ-C-06 | Search, filter, sort | MVP | Keyword search over product title. Filter by category and price range. Sort by newest, price ascending, and price descending. Paginated. Empty result shows an empty state. Only visible products appear (BR-05): a product in an inactive category, from a store whose owner is deactivated, or awaiting re-approval never appears. A sold-out product appears and is marked "สินค้าหมด" (BR-24). The same holds for the homepage (REQ-C-05). |
| REQ-C-07 | Category pages | MVP | Lists visible products in the category with the same filters and pagination. Unknown or inactive category gives 404. While a category is inactive its products are also absent from the homepage, search, and store pages, their product pages give 404, and they cannot be added to a cart or bought (BR-23). |
| REQ-C-08 | Product detail | MVP | Gallery, title, price, description, stock state, store link. A product with stock 0 is shown with the mark "สินค้าหมด" and cannot be bought from the page (BR-24). If the stock drops below the quantity the customer has selected on the page and is at least 1, the selected quantity is lowered to the stock and a message tells the customer (BR-30). Rating shown only if reviews exist. A product that is not visible under BR-05 gives 404 to the public: unpublished, not approved, awaiting re-approval, rejected, taken down, store not approved or suspended, store owner deactivated, or category inactive. |
| REQ-C-09 | Store page | MVP | Store name, logo, description, and its visible products, paginated. Sold-out products are listed and marked "สินค้าหมด" (BR-24). Non-approved store gives 404. A store whose owner's account is deactivated gives 404 (BR-27). |
| REQ-C-10 | Cart | MVP | Login is required: there is no guest cart (Q5). A guest's add-to-cart request is rejected with 401, stores nothing, and the storefront sends the guest to the login page. A logged-in user can add, change quantity, and remove. Quantity outside 1 to 99 is rejected (BR-03). A product that is not visible (BR-05) cannot be added: the request is rejected and no cart line is created. A product from the user's own store is rejected and no cart line is created (BR-16). Another user's cart line id returns 404. Items are grouped by store. Per-store and grand totals are computed by the server from current prices; no client-sent amount is used. A line whose product is no longer visible, or is sold out, is flagged as not buyable and blocks checkout until the customer removes or fixes it (BR-22). A line whose quantity is above the product's current stock, with stock at least 1, has its quantity lowered to the stock and the customer is shown a message naming the affected line (BR-30). What the server does with a request to add or set a quantity above current stock is open (Q24). |
| REQ-C-11 | Checkout | MVP | Choose address, see server-computed totals and shipping, choose mock payment. Creates one order with one seller order per store in a single transaction. Shipping total equals the flat fee multiplied by the number of seller orders (BR-08). Client-sent prices, totals, and fees are ignored. No partial purchase (BR-22): if any cart item is not visible (BR-05) or has stock below its quantity, the whole checkout is rejected, the response identifies each such item, no order is created, no stock changes, and nothing is charged; this holds when only one item of several is affected and when the affected item belongs to a different store from the others. After the customer removes or fixes every such item, checkout succeeds. An address id that does not belong to the customer returns 404 and creates no order. A cart with nothing to buy is rejected and creates no order. A grand total above BR-04 is rejected, creates no order, and changes no stock. A repeat request with the same idempotency key returns the original order and never creates a second one, including when the two requests arrive at the same time. A guest is rejected with 401. |
| REQ-C-12 | Mock payment | MVP | Clearly labelled as a test payment in the UI and stored with provider `MOCK`. Supports a simulated success and a simulated failure. Success sets payment `PAID`. Failure sets payment `FAILED`, restores stock for every item in the order, and returns every item of the order to the customer's cart (BR-20). After a failure the customer can check out again from the cart, which creates a new order; the failed order stays `FAILED`. Any request to pay or retry an order whose payment is `FAILED` or `PAID` is rejected and changes nothing. No seller sees the failed order (REQ-S-07). How returned items combine with items already in the cart is open (Q22). |
| REQ-C-13 | Order confirmation and history | MVP | Confirmation page after checkout. History is paginated and lists only the customer's own orders. Detail shows snapshots, including the store name as it was at purchase (BR-09), per-seller fulfilment status, tracking if entered. A seller order cancelled after payment is shown as "ยกเลิกแล้ว คืนเงินนอกระบบ" (BR-21). Another customer's order id returns 404. A guest is rejected with 401. No cancel action is offered to the customer (Q4). Whether and how an order whose payment failed appears in the history is open (Q21). |
| REQ-C-14 | Reviews | MVP | Rating 1 to 5 and optional text, subject to BR-11. Rejected with no review created: rating outside 1 to 5; item's seller order not `DELIVERED`; reviewer is not the buyer of the item; a second review for the same order item. Text is rendered escaped. |
| REQ-C-15 | Password recovery | LATER | Needs an email provider. Not faked. |
| REQ-C-16 | Wishlist, vouchers, chat | OUT | |

## Seller stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-S-01 | Apply to sell | MVP | Logged-in customer submits store name, description, contact phone. One open application at a time: a second submission while one is `PENDING` is rejected and creates nothing. A user who already owns a store cannot apply (BR-06). Status and, on rejection, the reason are visible to the applicant. A guest is rejected with 401. |
| REQ-S-02 | Store settings | MVP | Approved seller edits name, description, logo. Slug is unique across stores. A seller can edit only their own store. |
| REQ-S-03 | Dashboard summary | MVP | Counts of products, low-stock items (products with stock of 5 or fewer, BR-25), orders by status, and paid sales total, all scoped to the seller's store and computed from real rows. The paid sales total counts only the store's seller orders whose order payment is `PAID` and whose fulfilment status is not `CANCELLED` (BR-21): cancelling a paid seller order lowers the total by that seller order's amount. Seller orders of an order whose payment is `FAILED` are counted in no figure (BR-20). Which amounts make up the total (items only, or items plus shipping fee) is open (Q23). |
| REQ-S-04 | Product CRUD | MVP | Create, edit, publish, unpublish, archive, delete. Fields: title, description, SKU (unique per store), category, price, stock. Price outside BR-02 is rejected. A duplicate SKU within the store is rejected. A new product enters moderation as `PENDING` and is not visible until approved (Q2, BR-17). Editing an `APPROVED` product (BR-18): a change to title, description, category, or pictures returns it to `PENDING` and hides it from the storefront until an admin approves it again; a change to price or stock only leaves it `APPROVED` and visible, with the new value in effect at once. A rejected or taken-down product can be corrected and submitted again, after which it is `PENDING` and in the admin queue (BR-19; the resubmission action is open: Q20). No seller request sets a moderation status to `APPROVED`. Deleting a product that any order references archives it instead (BR-12). Another store's product id returns 404 on read, update, and delete. |
| REQ-S-05 | Image upload | MVP | JPEG, PNG, WebP only; maximum 5 MB each; maximum 8 per product. Content is checked, not only the extension: a file whose content does not match an allowed type is rejected. A ninth image for one product is rejected. Stored under a generated name. |
| REQ-S-06 | Inventory | MVP | Set stock to an absolute value or adjust by a delta. No request results in stock below zero. Another store's product id returns 404. |
| REQ-S-07 | Seller orders | MVP | Paginated list and detail of the seller's own seller orders only, with buyer shipping snapshot. For an order spanning several stores the seller sees only their own portion. Another store's seller order id returns 404. Seller orders of an order whose payment is `FAILED` are absent from the list, and a request for one by id returns 404 (BR-20). The store name shown on an order is the name at purchase (BR-09). |
| REQ-S-08 | Fulfilment updates | MVP | Transitions follow the fulfilment table. Invalid transitions are rejected and change nothing. `PENDING` to `PROCESSING` is rejected unless the order's payment is `PAID`. A seller may cancel their own `PENDING` or `PROCESSING` seller order even when the order is already paid; it is then shown as "ยกเลิกแล้ว คืนเงินนอกระบบ", the payment stays `PAID`, and no refund is recorded (BR-21). Cancelling restores stock for the seller order's items. A `SHIPPED` seller order can only become `DELIVERED`: cancelling it is rejected and changes nothing (BR-29). |
| REQ-S-09 | Non-approved seller limits | MVP | Pending, rejected, or suspended sellers cannot create, publish, or sell products. Server-enforced. A suspended seller can still view and fulfil their existing seller orders (BR-14). |
| REQ-S-10 | Payouts and commission statements | LATER | |

## Admin stories

| Id | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-A-01 | Protected dashboard | MVP | Every admin page and endpoint rejects non-admins on the server: a guest gets 401, a customer or seller gets 403. Summary metrics come from real rows. |
| REQ-A-02 | User management | MVP | Paginated, searchable list. Deactivate and reactivate a user. Deactivation revokes the user's sessions and blocks login until reactivation. An admin cannot deactivate themselves or remove the last admin; both attempts are rejected and change nothing. Deactivating a user who owns a store hides the store and its products: the store page gives 404, its products appear nowhere on the storefront, and they cannot be added to a cart or bought (BR-27). No request in user management gives a user the admin role (BR-26). |
| REQ-A-03 | Seller application review | MVP | Approve, or reject with a reason; rejection without a reason is rejected. Approval creates or activates the store and sets the user's role to `SELLER`. Reviewing an application that is not `PENDING` is rejected. |
| REQ-A-04 | Suspend and reinstate | MVP | A reason is required. Effects per BR-14. Suspending a store that is not `APPROVED`, or reinstating one that is not `SUSPENDED`, is rejected. |
| REQ-A-05 | Product moderation | MVP | Queue of pending products, which holds new products, approved products sent back by an edit (BR-18), and resubmitted products (BR-19). Approve, reject with reason, or take down an approved product with reason; rejection or takedown without a reason is rejected. A rejected or taken-down product is not visible; its seller can correct and resubmit it, and it then reappears in the queue (BR-19). Approval cannot be switched off (BR-17). |
| REQ-A-06 | Category management | MVP | Create, rename, reorder, deactivate. A category with products cannot be hard-deleted. Deactivating a category removes its products from the homepage, search, and store pages, makes their product pages give 404, and makes them impossible to add to a cart or buy (BR-23). |
| REQ-A-07 | Order oversight | MVP | Paginated, filterable list of all orders and details. May cancel or mark delivered per the fulfilment table; any other transition by an admin is rejected. An admin may cancel a `PENDING` or `PROCESSING` seller order that is already paid; it is then shown as "ยกเลิกแล้ว คืนเงินนอกระบบ", the payment stays `PAID`, and no refund is recorded (BR-21). An admin's attempt to cancel a `SHIPPED` seller order is rejected and changes nothing (BR-29). |
| REQ-A-08 | Reports | MVP | Orders, paid revenue, new users, and new sellers over a date range, from real rows. Paid revenue counts only seller orders whose order payment is `PAID` and whose fulfilment status is not `CANCELLED` (BR-21); orders whose payment is `PENDING` or `FAILED` contribute nothing. Which amounts make up paid revenue, and whether the "orders" count includes cancelled and failed orders, is open (Q23). |
| REQ-A-09 | Marketplace settings | MVP | Flat shipping fee (initial value 40.00 THB, Q1) and commission rate (initial value 5 percent, Q3). These are the only two settings: there is no moderation on/off setting (BR-17). A shipping fee below 0.00 THB or above 1,000.00 THB, or a commission rate below 0 or above 100 percent, is rejected and the stored value does not change; the boundary values 0.00 THB, 1,000.00 THB, 0 percent, and 100 percent are accepted (BR-28). A change applies to orders created afterwards and never alters existing orders. |
| REQ-A-10 | Audit log | MVP | Every action in REQ-A-02 to A-07 and A-09 writes who, what, target, before and after summary, and when. Read-only, paginated. No request edits or deletes an audit entry. |
| REQ-A-11 | Admin bootstrap | MVP | First admin is created by a documented script from environment input. No default password. No public endpoint grants admin. The script is the only way an admin account comes to exist in the MVP: no admin screen or endpoint promotes a user to admin (BR-26). |

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
| REQ-N-12 | The marketplace name is a placeholder until the owner provides the real name and logo (Q6). The placeholder name is "ชื่อแบรนด์" (D-025, OQ-15). The name is defined as a single string in exactly one place; changing that one string changes the name everywhere it is displayed (header, footer, page titles). No logo image is required until one is provided. | MVP |

## Confirmed decisions

Confirmed by the owner on 2026-10-11, see [DECISIONS.md](DECISIONS.md) D-017. These are rules, not defaults.

| # | Question | Decision | Status | Stated in |
| --- | --- | --- | --- | --- |
| Q1 | Flat shipping fee amount | 40.00 THB per seller order | Confirmed by owner 2026-10-11, see D-017 | BR-08, REQ-C-11, REQ-A-09 |
| Q2 | Must products be approved before going live? | Yes. Admin approval is required before a product is visible | Confirmed by owner 2026-10-11, see D-017 | Product moderation, REQ-S-04, REQ-A-05, REQ-A-09 |
| Q3 | Commission rate | 5 percent, recorded only, nothing deducted | Confirmed by owner 2026-10-11, see D-017 | BR-13, REQ-A-09 |
| Q4 | Can customers cancel their own orders? | No in the MVP; seller or admin only | Confirmed by owner 2026-10-11, see D-017 | Fulfilment status, REQ-C-13 |
| Q5 | Guest cart before login | No guest cart; login required to add to cart | Confirmed by owner 2026-10-11, see D-017 | Roles, REQ-C-10 |
| Q6 | Marketplace name and logo | Placeholder name "ชื่อแบรนด์" is used (Q18); the real name and logo are to be provided by the owner. Use of a placeholder in one replaceable place is confirmed (D-017); the real name and logo themselves remain outstanding | Partly open | REQ-N-12 |

Answered by the owner on 2026-10-11, see [DECISIONS.md](DECISIONS.md) D-025. These are rules, not defaults. The "Owner question" column gives the id used in D-025 and [STATUS.md](STATUS.md).

| # | Owner question | Question | Decision | Status | Stated in |
| --- | --- | --- | --- | --- | --- |
| Q7 | OQ-04 | Should admins keep a switch that turns product approval off? | No. Approval is always required; the moderation on/off setting is removed from admin settings | Answered by owner 2026-10-11, see D-025 | BR-17, Product moderation, REQ-A-05, REQ-A-09 |
| Q8 | OQ-05 | Which edits to an approved product send it back for approval, and does it stay on sale while it waits? | Only title, description, category, or picture changes. Price and stock changes take effect at once. While it waits the product is hidden from the shop | Answered by owner 2026-10-11, see D-025 | BR-18, BR-05, Product moderation, REQ-S-04, REQ-A-05 |
| Q9 | OQ-06 | Can a rejected or taken-down product be corrected and resubmitted? | Yes | Answered by owner 2026-10-11, see D-025 | BR-19, Product moderation, REQ-S-04, REQ-A-05 |
| Q10 | OQ-07 | After a failed payment, can the customer retry the same order? Do the items return to the cart? Do sellers see the failed order? | No retry. The items return to the cart and the customer checks out again. Sellers do not see orders whose payment failed | Answered by owner 2026-10-11, see D-025 | BR-20, Payment status, REQ-C-12, REQ-S-03, REQ-S-07 |
| Q11 | OQ-08 | May an already-paid order be cancelled, what is shown, and do cancelled orders count in sales and revenue? | A seller or admin may cancel it. Shown as "ยกเลิกแล้ว คืนเงินนอกระบบ". The system records no refund. Cancelled orders are not counted in sales or revenue figures | Answered by owner 2026-10-11, see D-025 | BR-21, Fulfilment status, REQ-C-13, REQ-S-03, REQ-S-08, REQ-A-07, REQ-A-08 |
| Q12 | OQ-09 | If one cart item can no longer be bought, does checkout go ahead with the rest? | No. The whole checkout stops until the customer removes or fixes the item. No partial purchase | Answered by owner 2026-10-11, see D-025 | BR-22, REQ-C-10, REQ-C-11 |
| Q13 | OQ-10 | What does switching a category off do to its products? | They are removed from the whole shop (search, store pages, product pages) and cannot be bought | Answered by owner 2026-10-11, see D-025 | BR-23, BR-05, REQ-C-06, REQ-C-07, REQ-C-08, REQ-A-06 |
| Q14 | OQ-11 | Do sold-out products stay visible? | Yes, marked "สินค้าหมด" | Answered by owner 2026-10-11, see D-025 | BR-24, BR-05, Terms, REQ-C-06, REQ-C-08, REQ-C-09 |
| Q15 | OQ-12 | What counts as "low stock"? | 5 or fewer | Answered by owner 2026-10-11, see D-025 | BR-25, Terms, REQ-S-03 |
| Q16 | OQ-13 | Can an admin promote another user to admin from the admin screens? | No. In the MVP admins are created only by the bootstrap script | Answered by owner 2026-10-11, see D-025 | BR-26, Roles, REQ-A-02, REQ-A-11 |
| Q17 | OQ-14 | What happens to the store when its owner is deactivated? | The store and its products are hidden | Answered by owner 2026-10-11, see D-025 | BR-27, BR-05, REQ-C-08, REQ-C-09, REQ-A-02 |
| Q18 | OQ-15 | Placeholder marketplace name | "ชื่อแบรนด์" | Answered by owner 2026-10-11, see D-025 | REQ-N-12 |
| Q19 | OQ-16 | Limits on admin settings | Flat shipping fee 0 to 1,000 THB; commission 0 to 100 percent | Answered by owner 2026-10-11, see D-025 | BR-28, REQ-A-09 |
| none | OQ-17 | Can a shipped order be cancelled or marked lost? | No. A shipped order can only become delivered | Answered by owner 2026-10-11, see D-025 | BR-29, Fulfilment status, REQ-S-08, REQ-A-07 |
| none | OQ-18 | After a store is renamed, which name do old orders show? | The store name as it was at purchase | Answered by owner 2026-10-11, see D-025 | BR-09, REQ-C-13, REQ-S-07 |
| none | OQ-23 | What happens when stock drops below a quantity the customer already chose? | The quantity is lowered automatically to what is available and the customer is told | Answered by owner 2026-10-11, see D-025 | BR-30, REQ-C-08, REQ-C-10 |

## Open questions awaiting the owner

Q7 to Q19 are answered and are listed under [Confirmed decisions](#confirmed-decisions). The questions below were found on 2026-10-11 while writing those answers into rules: each is a detail the answer does not settle. They are proposed by the product-requirements agent and have not yet been put to the owner. None is decided. The "Recommended default" column is a suggestion only and is **not in effect**; per D-019 nothing here is to be built on a guess.

| # | Question | Affects | Recommended default (not in effect) |
| --- | --- | --- | --- |
| Q20 | How does a seller send a rejected or taken-down product back for approval: does saving a correction send it automatically, or does the seller press a separate "submit again" button? May it be sent again with nothing changed? | BR-19, REQ-S-04 | Saving any correction sends it back automatically; no resubmission without a change |
| Q21 | After a failed payment, does the customer still see the failed order in their order history (marked as payment failed), or does it disappear? What does the admin see for it, and what status do its per-store parts carry? | BR-20, REQ-C-13, REQ-A-07, fulfilment status | The customer and the admin see it, marked as payment failed, with no further action possible on it |
| Q22 | When the items of a failed payment return to the cart and the customer has meanwhile put other things in the cart: if the same product is already there, are the quantities added together (up to the limit of 99 and the stock available) or is the cart's current quantity kept? | BR-20, REQ-C-12 | Add the quantities together, capped at 99 and at available stock, and tell the customer if a cap applied |
| Q23 | What do the sales figures add up: only the price of the goods, or goods plus shipping fee? And does the admin report's "orders" count include cancelled orders and orders whose payment failed? | REQ-S-03, REQ-A-08, BR-21 | Goods only, without shipping fee; the orders count includes only paid, not-cancelled orders |
| Q24 | When a customer asks for more of a product than is in stock (or adds a sold-out product) to the cart: is the request refused, or is the quantity lowered to what is available? | REQ-C-10, BR-24, BR-30 | Refuse a sold-out product; otherwise lower to the available stock and tell the customer |
| Q25 | Does changing only the order of a product's pictures, or which picture is shown first, count as a picture change that needs approval again? | BR-18 | No; only adding, removing, or replacing a picture needs approval again |
| Q26 | When a deactivated store owner is reactivated, or a switched-off category is switched on again, do the hidden products come back to the shop by themselves? The rules are written as "hidden while deactivated or inactive", which implies yes. | BR-23, BR-27 | Yes, they return automatically |
| Q27 | When a store owner is deactivated they cannot log in, so they cannot ship orders already placed with their store. Should the admin simply cancel those orders, or should something else happen? An admin can cancel or mark delivered but cannot mark an order shipped. | BR-27, REQ-A-02, REQ-A-07 | The admin cancels them by hand; nothing automatic |
| Q28 | May the setup script be run again to create a second or third admin, or does it create only the very first one? | BR-26, REQ-A-11 | It may be run again to create further admins |
| Q29 | May the commission rate have decimals (for example 2.5 percent) or whole numbers only? | BR-28, REQ-A-09 | Whole numbers only |
| Q30 | May a seller create a product in, or move a product to, a category that is switched off? | BR-23, REQ-S-04 | No; the request is refused |

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
| REQ-S-03 | T-043, T-044 | none yet |
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
| REQ-N-06 | T-020, T-050 | none yet |
| REQ-N-07 | T-011, T-019 | none yet |
| REQ-N-08 | T-011 | none yet |
| REQ-N-09 | T-014, T-032, T-034 | none yet |
| REQ-N-10 | T-010, T-012 | none yet |
| REQ-N-12 | T-018 | none yet |
| BR-01 to BR-16 | T-013 (schema) | none yet |
| BR-05 | T-020 | none yet |
| BR-07 to BR-15 | T-032 | none yet |
| BR-16 | T-013, T-031, T-032 | none yet |

BR-17 to BR-30 were added on 2026-10-11 from D-025. No task's "Covers" column in PROJECT_PLAN.md lists them yet (**gap**, reported to the orchestrator). The tasks below are the ones STATUS.md names as blocked by the corresponding owner question, plus the task that already covers the story the rule is stated in.

| Requirement | Tasks (from the STATUS.md "Blocks" column) | Test files |
| --- | --- | --- |
| BR-17 (OQ-04) | T-013, T-042, T-050 | none yet |
| BR-18 (OQ-05) | T-013, T-042 | none yet |
| BR-19 (OQ-06) | T-013, T-042, T-050 | none yet |
| BR-20 (OQ-07) | T-013, T-032, T-034 | none yet |
| BR-21 (OQ-08) | T-013, T-032, T-043, T-050 | none yet |
| BR-22 (OQ-09) | T-031, T-032, T-034 | none yet |
| BR-23 (OQ-10) | T-020 | none yet |
| BR-24 (OQ-11) | T-020, T-021 | none yet |
| BR-25 (OQ-12) | T-021, T-042, T-043 | none yet |
| BR-26 (OQ-13) | T-016, T-050 | none yet |
| BR-27 (OQ-14) | T-020, T-050 | none yet |
| BR-28 (OQ-16) | T-013, T-050 | none yet |
| BR-29 (OQ-17) | T-013, T-043 | none yet |
| BR-30 (OQ-23) | T-021, T-031, T-034 | none yet |
| BR-09 store name snapshot (OQ-18) | T-013 | none yet |
| REQ-N-12 placeholder name (OQ-15) | T-018 | none yet |
