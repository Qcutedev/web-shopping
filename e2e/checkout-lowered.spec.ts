/**
 * Journey 14: the cart holds more than the stock that is left. The customer submits checkout; the
 * page says the quantity was lowered (owner-approved text, OQ-30, D-029 point 2) with the new
 * total; no order exists yet; the customer confirms; the order is placed for the lowered quantity.
 */
import { expect, test } from "@playwright/test";
import { th } from "@/i18n/th";
import { createDraft, openSeller, publishAndApprove, setStock } from "./support/catalog";
import { addToCartOnPage, registerCustomer } from "./support/session";
import { addAddress, readOrder } from "./support/shop";

test.describe.configure({ timeout: 180_000 });

test("checkout stops for a lowered quantity, nothing is ordered until the customer confirms", async ({
  browser,
}) => {
  const seller = await openSeller(browser);
  const product = await createDraft(seller.request, "สินค้าลดจำนวน", 5);
  await publishAndApprove(browser, seller.request, product.id);
  const customer = await registerCustomer(browser, "lowered");
  try {
    const page = customer.page;
    await addAddress(customer.context.request);
    await addToCartOnPage(page, product.slug, 4);

    // Someone else buys elsewhere: 2 are left, the cart still holds 4.
    await setStock(seller.request, product.id, 2);

    await page.goto("/checkout");
    await page.getByRole("button", { name: th.checkout.submit }).click();
    const alert = page.getByRole("status").filter({ hasText: th.checkout.refusedTitle });
    await expect(alert).toBeVisible();
    await expect(alert.getByText(th.checkout.refusedBody)).toBeVisible();
    const list = alert.getByRole("list", { name: th.checkout.refusedListLabel });
    await expect(list).toContainText(th.quantity.lowered.replaceAll("{available}", "2"));
    // The new total: 2 x 100.00 + 40.00 shipping, computed by the server.
    await expect(alert).toContainText(`${th.checkout.refusedNewTotal} ฿240.00`);
    await expect(page.getByRole("button", { name: th.checkout.confirmAgain })).toBeVisible();
    await expect(page).toHaveURL(/\/checkout/);

    // No order exists yet (checked in a second tab so the refusal stays on screen), and the
    // product's stock was not touched.
    const other = await customer.context.newPage();
    await other.goto("/orders");
    await expect(other.getByText(th.orders.emptyTitle)).toBeVisible();
    await other.close();
    const before = await seller.request.get(`/api/v1/seller/products/${product.id}`);
    expect(((await before.json()) as { data: { stock: number } }).data.stock).toBe(2);

    // The customer confirms: the order is for 2, at the total that was shown.
    await page.getByRole("button", { name: th.checkout.confirmAgain }).click();
    await expect(page).toHaveURL(/\/orders\/[^/]+$/);
    const orderId = new URL(page.url()).pathname.split("/").pop() ?? "";
    await expect(page.getByText("฿240.00").first()).toBeVisible();
    const order = await readOrder(customer.context.request, orderId);
    expect(order.paymentStatus).toBe("PAID");
    expect(order.grandTotalSatang).toBe(24_000);
    expect(order.sellerOrders).toHaveLength(1);
    expect(order.sellerOrders[0]!.items.map((item) => item.quantity)).toEqual([2]);

    const after = await seller.request.get(`/api/v1/seller/products/${product.id}`);
    expect(((await after.json()) as { data: { stock: number } }).data.stock).toBe(0);
  } finally {
    await customer.context.close();
    await seller.close();
  }
});
