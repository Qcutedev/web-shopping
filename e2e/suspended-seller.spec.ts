/**
 * Journey 13: an admin suspends a store. Its products leave the storefront. The seller, still
 * logged in with the same session, completes an existing order, can open the product list, and is
 * refused when saving a product change (BR-14, D-027, D-028).
 *
 * The store is made for this spec (a fresh applicant, approved by the e2e admin), because
 * suspending one of the shared seeded stores would break the specs that run after it.
 */
import { expect, test } from "@playwright/test";
import { th } from "@/i18n/th";
import { ADMIN_STORAGE_STATE } from "./support/accounts";
import { createDraft, publishAndApprove } from "./support/catalog";
import { ORIGIN_HEADERS, addToCartOnPage, openAs, registerCustomer } from "./support/session";
import {
  addAddress,
  categoryTwoId,
  checkoutOnPage,
  readOrder,
  registerSellerWithStore,
} from "./support/shop";

test.describe.configure({ timeout: 240_000 });

test("a suspended store leaves the storefront but its seller can still finish an order", async ({
  browser,
}) => {
  const REASON = "ระงับเพื่อทดสอบ E2E";
  const { owner, storeName } = await registerSellerWithStore(browser, "suspendable");
  const categoryId = await categoryTwoId(browser);
  const product = await createDraft(owner.context.request, "สินค้าร้านถูกระงับ", 5, categoryId);
  await publishAndApprove(browser, owner.context.request, product.id);
  const customer = await registerCustomer(browser, "suspbuyer");
  const admin = await openAs(browser, ADMIN_STORAGE_STATE);
  try {
    // A customer buys from the store while it is active.
    await addAddress(customer.context.request);
    await addToCartOnPage(customer.page, product.slug, 1);
    const orderId = await checkoutOnPage(customer.page);

    // The product is on the storefront before the suspension.
    await customer.page.goto(`/products/${product.slug}`);
    await expect(
      customer.page.getByRole("heading", { level: 1, name: product.title }),
    ).toBeVisible();

    // The admin suspends the store; a reason is required.
    await admin.page.goto("/admin/stores");
    const row = admin.page.getByRole("row").filter({ hasText: storeName });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: th.admin.stores.suspend, exact: true }).click();
    const dialog = admin.page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: th.admin.stores.suspendConfirmAction }).click();
    await expect(
      dialog.getByText(th.admin.common.reasonErrors.required, { exact: true }),
    ).toBeVisible();
    await dialog.getByLabel(th.admin.common.reasonLabel).fill(REASON);
    await dialog.getByRole("button", { name: th.admin.stores.suspendConfirmAction }).click();
    await expect(admin.page.getByText(th.admin.stores.suspended)).toBeVisible();

    // The products left the storefront: the product page is not found, and search finds nothing.
    await customer.page.goto(`/products/${product.slug}`);
    await expect(
      customer.page.getByRole("heading", { level: 1, name: th.notFound.title }),
    ).toBeVisible();
    await customer.page.goto(`/search?q=${encodeURIComponent(product.title)}`);
    await expect(customer.page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      customer.page.locator('a[href^="/products/"]').filter({ hasText: product.title }),
    ).toHaveCount(0);

    // The seller, with the same session as before, sees the notice and can open the list.
    const seller = owner.page;
    await seller.goto("/seller/products");
    await expect(seller.getByText(th.seller.suspended.title)).toBeVisible();
    await expect(seller.getByText(REASON)).toBeVisible();
    await expect(seller.getByRole("link", { name: product.title })).toBeVisible();

    // The existing order can be completed: confirm, ship, deliver, and the customer sees it.
    await seller.goto("/seller/orders");
    await seller.getByRole("link", { name: th.seller.orders.row.view }).first().click();
    await expect(seller).toHaveURL(/\/seller\/orders\/[^/]+$/);
    await seller
      .getByRole("button", { name: th.seller.orders.actions.confirm, exact: true })
      .click();
    await expect(seller.getByText(th.seller.orders.actions.confirmed)).toBeVisible();
    await seller.getByLabel(th.seller.orders.actions.carrierName).fill("ขนส่งจำลอง");
    await seller.getByLabel(th.seller.orders.actions.trackingNumber).fill("MOCK-SUSP-1");
    await seller.getByRole("button", { name: th.seller.orders.actions.ship, exact: true }).click();
    await expect(seller.getByText(th.seller.orders.actions.shipped)).toBeVisible();
    await seller
      .getByRole("button", { name: th.seller.orders.actions.deliver, exact: true })
      .click();
    await expect(seller.getByText(th.seller.orders.actions.delivered)).toBeVisible();
    const delivered = await readOrder(customer.context.request, orderId);
    expect(delivered.sellerOrders[0]!.fulfilmentStatus).toBe("DELIVERED");

    // Saving a product change is refused: the form is locked, and the server says no as well.
    await seller.goto(`/seller/products/${product.id}`);
    await expect(seller.getByText(th.seller.products.suspendedNote)).toBeVisible();
    await expect(seller.getByLabel(th.seller.products.form.title)).toBeDisabled();
    await expect(seller.getByRole("button", { name: th.seller.products.form.save })).toBeDisabled();
    const patch = await owner.context.request.patch(`/api/v1/seller/products/${product.id}`, {
      headers: ORIGIN_HEADERS,
      data: { priceSatang: 20_000 },
    });
    expect(patch.status()).toBe(403);
    expect(((await patch.json()) as { error: { code: string } }).error.code).toBe(
      "SELLER_NOT_APPROVED",
    );
    const stock = await owner.context.request.patch(`/api/v1/seller/products/${product.id}/stock`, {
      headers: ORIGIN_HEADERS,
      data: { set: 50 },
    });
    expect(stock.status()).toBe(403);
    // The price did not change.
    const read = await owner.context.request.get(`/api/v1/seller/products/${product.id}`);
    expect(((await read.json()) as { data: { priceSatang: number } }).data.priceSatang).toBe(
      10_000,
    );
  } finally {
    await owner.context.close();
    await customer.context.close();
    await admin.context.close();
  }
});
