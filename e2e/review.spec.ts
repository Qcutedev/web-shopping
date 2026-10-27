/**
 * Journey 12: after the seller marks the order delivered, the customer reviews the item once;
 * the review appears on the product page; a second attempt is not offered and is rejected by the
 * server. The review text is markup and must be shown as literal text.
 *
 * The product is made by the second e2e seller and approved by the e2e admin (support/catalog.ts);
 * the customer is registered through the real forms and buys through the real pages. The seller
 * moves the order to delivered through the API (setup; journey 8 drives that through the UI).
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { createDraft, openSeller, publishAndApprove } from "./support/catalog";
import { ORIGIN_HEADERS, addToCartOnPage, registerCustomer } from "./support/session";
import { addAddress, checkoutOnPage, moveSellerOrder, readOrder } from "./support/shop";

test.describe.configure({ timeout: 180_000 });

// Markup that would run script or create an element if it were rendered as HTML.
const MARKUP = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>bold</b>';

let seller: BrowserContext;

test.beforeAll(async ({ browser }) => {
  seller = await openSeller(browser);
});

test.afterAll(async () => {
  await seller.close();
});

async function expectLiteral(scope: ReturnType<Page["locator"]>, page: Page): Promise<void> {
  await expect(scope.getByText(MARKUP, { exact: false })).toBeVisible();
  // No element was made from the text, and nothing ran.
  await expect(scope.locator("img, script, b")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
}

test("a delivered item is reviewed once, the review shows as plain text on the product page", async ({
  browser,
}) => {
  const product = await createDraft(seller.request, "สินค้ารีวิว", 5);
  await publishAndApprove(browser, seller.request, product.id);
  const customer = await registerCustomer(browser, "reviewer");
  const dialogs: string[] = [];
  try {
    const page = customer.page;
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await addAddress(customer.context.request);
    await addToCartOnPage(page, product.slug, 1);
    const orderId = await checkoutOnPage(page);
    const order = await readOrder(customer.context.request, orderId);
    const sellerOrder = order.sellerOrders[0]!;
    const item = sellerOrder.items[0]!;

    // Not delivered yet: no review form is offered, and the server refuses a direct request.
    await expect(page.getByRole("button", { name: th.orders.review.write })).toHaveCount(0);
    const early = await customer.context.request.post(
      `/api/v1/orders/${orderId}/items/${item.id}/review`,
      { headers: ORIGIN_HEADERS, data: { rating: 5 } },
    );
    expect(early.status()).toBe(409);

    await moveSellerOrder(seller.request, sellerOrder.id, ["PROCESSING", "SHIPPED", "DELIVERED"]);

    // Delivered: the form opens; a missing rating is refused in the browser.
    await page.goto(`/orders/${orderId}`);
    await page.getByRole("button", { name: th.orders.review.write }).click();
    const form = page.getByRole("form", { name: th.orders.review.formTitle });
    await form.getByRole("button", { name: th.orders.review.submit }).click();
    await expect(form.getByText(th.orders.review.ratingRequired)).toBeVisible();

    await form.getByLabel(th.orders.review.ratingOption.replace("{rating}", "4")).check();
    await form.getByLabel(th.orders.review.commentLabel).fill(MARKUP);
    await form.getByRole("button", { name: th.orders.review.submit }).click();
    await expect(page.getByText(th.orders.review.submitted)).toBeVisible();
    const own = page.getByRole("article").filter({ hasText: "bold" });
    await expectLiteral(own, page);

    // The review is on the product page, again as literal text.
    await expect
      .poll(
        async () => {
          await page.goto(`/products/${product.slug}`);
          return page.getByText("bold").count();
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    const reviews = page.getByRole("region", { name: th.catalog.product.reviewsTitle });
    await expect(reviews.getByRole("article")).toHaveCount(1);
    await expectLiteral(reviews, page);

    // A second attempt: the order page offers no form, and the server answers 409.
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText(th.orders.review.yourReview)).toBeVisible();
    await expect(page.getByRole("button", { name: th.orders.review.write })).toHaveCount(0);
    const again = await customer.context.request.post(
      `/api/v1/orders/${orderId}/items/${item.id}/review`,
      { headers: ORIGIN_HEADERS, data: { rating: 1, comment: "ซ้ำ" } },
    );
    expect(again.status()).toBe(409);

    expect(dialogs).toEqual([]);
  } finally {
    await customer.context.close();
  }
});
