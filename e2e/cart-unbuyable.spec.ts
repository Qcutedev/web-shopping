/**
 * Journey 15: a line that cannot be bought. A product in the cart sells out: the cart marks the
 * line "สินค้าหมด" and leaves it out of the total; checkout is not possible until the customer
 * removes the line; afterwards the checkout succeeds (OQ-29, OQ-09).
 *
 * The same journey with a product an admin took down asserts that the line is marked and left out
 * of the total, without asserting the wording of the mark (open question O1).
 */
import { expect, test } from "@playwright/test";
import { th } from "@/i18n/th";
import { createDraft, openSeller, publishAndApprove, setStock } from "./support/catalog";
import { addToCartOnPage, registerCustomer } from "./support/session";
import { addAddress, checkoutOnPage, readOrder, takeDown } from "./support/shop";

test.describe.configure({ timeout: 180_000 });

test("a sold-out line is marked and excluded, checkout waits for its removal, then succeeds", async ({
  browser,
}) => {
  const seller = await openSeller(browser);
  const soldOut = await createDraft(seller.request, "สินค้าจะหมด", 3);
  const kept = await createDraft(seller.request, "สินค้าคงเหลือ", 10);
  await publishAndApprove(browser, seller.request, soldOut.id);
  await publishAndApprove(browser, seller.request, kept.id);
  const customer = await registerCustomer(browser, "unbuyable");
  try {
    const page = customer.page;
    await addAddress(customer.context.request);
    await addToCartOnPage(page, soldOut.slug, 1);
    await addToCartOnPage(page, kept.slug, 2);
    const summary = page.getByRole("region", { name: th.cart.summaryTitle });
    const lineOf = (title: string) => page.getByRole("listitem").filter({ hasText: title });

    // Both lines count: 100.00 + 2 x 100.00 + 40.00 shipping for the one store.
    await page.goto("/cart");
    await expect(summary).toContainText("฿340.00");
    await expect(page.getByRole("link", { name: th.cart.checkout })).toBeVisible();

    // The first product sells out while it sits in the cart.
    await setStock(seller.request, soldOut.id, 0);
    await page.goto("/cart");
    await expect(lineOf(soldOut.title).getByText(th.cart.soldOut, { exact: true })).toBeVisible();
    // It has no quantity control and does not count: 2 x 100.00 + 40.00.
    await expect(lineOf(soldOut.title).getByRole("spinbutton")).toHaveCount(0);
    await expect(summary).toContainText("฿240.00");
    await expect(summary).not.toContainText("฿340.00");
    await expect(lineOf(kept.title).getByText(th.cart.soldOut, { exact: true })).toHaveCount(0);

    // Checkout is not possible: the button is disabled, and the checkout page says so.
    await expect(page.getByRole("button", { name: th.cart.checkout })).toBeDisabled();
    await expect(page.getByRole("link", { name: th.cart.checkout })).toHaveCount(0);
    await page.goto("/checkout");
    await expect(page.getByText(th.checkout.blockedTitle)).toBeVisible();
    await expect(page.getByRole("button", { name: th.checkout.submit })).toHaveCount(0);

    // Removing the line makes checkout possible, and the order holds the other product only.
    await page.goto("/cart");
    await lineOf(soldOut.title).getByRole("button", { name: th.cart.remove }).click();
    await expect(page.getByText(th.cart.removed)).toBeVisible();
    await expect(lineOf(soldOut.title)).toHaveCount(0);
    await expect(summary).toContainText("฿240.00");
    const orderId = await checkoutOnPage(page);
    const order = await readOrder(customer.context.request, orderId);
    expect(order.paymentStatus).toBe("PAID");
    expect(order.grandTotalSatang).toBe(24_000);
    expect(order.sellerOrders[0]!.items.map((item) => [item.productTitle, item.quantity])).toEqual([
      [kept.title, 2],
    ]);
  } finally {
    await customer.context.close();
    await seller.close();
  }
});

test("a line whose product was taken down is marked and excluded, and blocks checkout", async ({
  browser,
}) => {
  const seller = await openSeller(browser);
  const gone = await createDraft(seller.request, "สินค้าถูกถอด", 5);
  const kept = await createDraft(seller.request, "สินค้ายังขาย", 5);
  await publishAndApprove(browser, seller.request, gone.id);
  await publishAndApprove(browser, seller.request, kept.id);
  const customer = await registerCustomer(browser, "takendown");
  try {
    const page = customer.page;
    await addAddress(customer.context.request);
    await addToCartOnPage(page, gone.slug, 1);
    await addToCartOnPage(page, kept.slug, 1);
    await takeDown(browser, gone.id, "ถอดเพื่อทดสอบ E2E");

    await page.goto("/cart");
    const summary = page.getByRole("region", { name: th.cart.summaryTitle });
    // A taken-down line carries no title (SEC-054), so it is found by the fixed label.
    const goneLine = page.getByRole("listitem").filter({ hasText: th.cart.unavailableLine });
    const keptLine = page.getByRole("listitem").filter({ hasText: kept.title });
    // Marked: the line has no quantity control, carries the "not available" mark and a note
    // (role "note", no class name involved); the other line has the control and neither. The
    // texts come from the i18n keys, so a rewording (open question O1) does not break this.
    await expect(goneLine).toHaveCount(1);
    await expect(goneLine.getByRole("spinbutton")).toHaveCount(0);
    await expect(goneLine.getByText(th.cart.notAvailable, { exact: true })).toBeVisible();
    await expect(goneLine.getByRole("note")).toHaveText(th.cart.notAvailableNote);
    await expect(keptLine.getByRole("spinbutton")).toHaveCount(1);
    await expect(keptLine.getByText(th.cart.notAvailable, { exact: true })).toHaveCount(0);
    await expect(keptLine.getByRole("note")).toHaveCount(0);
    // Left out of the total: 100.00 + 40.00 shipping, not 200.00 + 40.00.
    await expect(summary).toContainText("฿140.00");
    await expect(summary).not.toContainText("฿240.00");
    await expect(page.getByRole("button", { name: th.cart.checkout })).toBeDisabled();

    await goneLine.getByRole("button", { name: th.cart.remove }).click();
    await expect(goneLine).toHaveCount(0);
    await expect(page.getByRole("link", { name: th.cart.checkout })).toBeVisible();
  } finally {
    await customer.context.close();
    await seller.close();
  }
});
