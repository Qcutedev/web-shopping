/**
 * Journey 10: journeys 2 to 5 (discovery, a two-store cart, mock checkout, order history) repeated
 * at 360 and at 768 pixels (REQ-N-02; 1280 is the width of the other specs). One new customer per
 * width, registered and signed in through the real pages.
 *
 * At every step the page must not scroll sideways, and each control the journey uses must lie
 * inside the viewport horizontally and be at least 24 by 24 CSS pixels once scrolled into view
 * (reachable and tappable without zooming).
 *
 * The delivery address is set up through the address endpoint (setup, not the journey under test),
 * as in checkout.spec.ts. Stock is taken from the two products by one unit per width; no other
 * spec that runs after this file reads their stock.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { SEEDED } from "./support/accounts";
import { ORIGIN_HEADERS, addToCartOnPage, registerCustomer, type Person } from "./support/session";

const CARD_TITLES = 'a[href^="/products/"] :is(h2, h3)';
const MIN_TARGET = 24;

async function titlesOnPage(page: Page): Promise<string[]> {
  const titles = await page.locator(CARD_TITLES).allInnerTexts();
  return titles.map((title) => title.trim());
}

async function expectNoSideScroll(page: Page, width: number): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.inner).toBe(width);
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
}

/** The control is inside the viewport horizontally and big enough to tap; returns it for use. */
async function reach(control: Locator, width: number): Promise<Locator> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box, "control has a box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.width).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET);
  return control;
}

for (const width of [360, 768]) {
  test.describe(`journeys 2 to 5 at ${width} px`, () => {
    test.describe.configure({ mode: "serial" });

    let customer: Person;

    test.beforeAll(async ({ browser }) => {
      customer = await registerCustomer(browser, `vp${width}`);
      await customer.page.setViewportSize({ width, height: 800 });
      const response = await customer.context.request.post("/api/v1/me/addresses", {
        headers: ORIGIN_HEADERS,
        data: {
          recipientName: "ผู้ซื้อ E2E",
          phone: "0812345678",
          line1: "99/9 ถนนทดสอบ",
          subdistrict: "ทดสอบ",
          district: "ทดสอบ",
          province: "กรุงเทพมหานคร",
          postalCode: "10110",
          isDefault: true,
        },
      });
      expect(response.ok(), `address answered ${response.status()}`).toBe(true);
    });

    test.afterAll(async () => {
      await customer.context.close();
    });

    test("journey 2: browse, category, search, filter and sort", async () => {
      const page = customer.page;
      await page.goto("/");
      await expect(page.getByRole("heading", { name: th.catalog.home.newestTitle })).toBeVisible({
        timeout: 30_000,
      });
      const titles = await titlesOnPage(page);
      expect(titles).toContain(SEEDED.productTwoA.title);
      expect(titles).toContain(SEEDED.productTwoB.title);
      await expectNoSideScroll(page, width);

      await page.goto(`/categories/${SEEDED.categoryTwo.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(SEEDED.categoryTwo.name);
      // Earlier specs add products to this category, so the two seeded ones are looked for, not counted.
      const categoryTitles = await titlesOnPage(page);
      expect(categoryTitles).toContain(SEEDED.productTwoA.title);
      expect(categoryTitles).toContain(SEEDED.productTwoB.title);
      await expectNoSideScroll(page, width);

      // Sort links are reachable and reorder the list.
      const sortNav = page.getByRole("navigation", { name: th.catalog.sort.label });
      const priceDesc = await reach(
        sortNav.getByRole("link", { name: th.catalog.sort.price_desc }),
        width,
      );
      await priceDesc.click();
      await expect(page).toHaveURL(/sort=price_desc/);
      // 999.00 comes before 250.00 in descending order.
      await expect
        .poll(async () => {
          const titles = await titlesOnPage(page);
          const bag = titles.indexOf(SEEDED.productTwoB.title);
          const shirt = titles.indexOf(SEEDED.productTwoA.title);
          return bag >= 0 && shirt >= 0 && bag < shirt;
        })
        .toBe(true);
      await expectNoSideScroll(page, width);

      // Search by title.
      await page.goto("/search");
      const box = await reach(
        page.getByRole("searchbox", { name: th.shell.header.search.label }),
        width,
      );
      await box.fill("กระเป๋า");
      const submit = await reach(
        page.getByRole("button", { name: th.shell.header.search.submit }).first(),
        width,
      );
      await submit.click();
      await expect(page).toHaveURL(/\/search\?q=/);
      await expect.poll(() => titlesOnPage(page)).toEqual([SEEDED.productTwoB.title]);
      await expectNoSideScroll(page, width);

      // The filter form narrows by category and price.
      await page.goto("/search");
      await expect.poll(async () => (await titlesOnPage(page)).length).toBeGreaterThanOrEqual(5);
      const category = await reach(page.getByLabel(th.catalog.filter.category), width);
      await category.selectOption(SEEDED.categoryTwo.slug);
      const minPrice = await reach(page.getByLabel(th.catalog.filter.minPrice), width);
      await minPrice.fill("500");
      const apply = await reach(page.getByRole("button", { name: th.catalog.filter.apply }), width);
      await apply.click();
      // 500 baht keeps the 999.00 bag and drops the 250.00 shirt.
      await expect.poll(() => titlesOnPage(page)).toContain(SEEDED.productTwoB.title);
      expect(await titlesOnPage(page)).not.toContain(SEEDED.productTwoA.title);
      await expectNoSideScroll(page, width);
    });

    test("journey 3: products of two stores go into the cart", async () => {
      const page = customer.page;
      await page.goto(`/products/${SEEDED.productOne.slug}`);
      await expectNoSideScroll(page, width);
      await reach(page.getByRole("button", { name: th.cart.add.submit }), width);
      await addToCartOnPage(page, SEEDED.productOne.slug, 1);
      await addToCartOnPage(page, SEEDED.productTwoA.slug, 1);

      await page.goto("/cart");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(th.cart.title);
      await expect(
        page.getByRole("heading", { level: 2, name: SEEDED.storeOne.name, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: SEEDED.storeTwo.name, exact: true }),
      ).toBeVisible();
      // 123.45 + 250.00 = 373.45 of goods, 2 x 40.00 shipping, 453.45 in total.
      const summary = page.getByRole("region", { name: th.cart.summaryTitle });
      await expect(summary).toContainText("฿373.45");
      await expect(summary).toContainText("฿80.00");
      await expect(summary).toContainText("฿453.45");
      await reach(page.getByRole("button", { name: th.cart.increase }).first(), width);
      await expectNoSideScroll(page, width);
    });

    test("journey 4: mock checkout places a paid order", async () => {
      const page = customer.page;
      await page.goto("/cart");
      const checkout = await reach(page.getByRole("link", { name: th.cart.checkout }), width);
      await checkout.click();
      await expect(page).toHaveURL(/\/checkout/);
      await expect(page.getByText(th.checkout.paymentMockNote)).toBeVisible();
      await expect(page.getByText(th.checkout.shippingNote)).toBeVisible();
      await expect(page.getByText("฿453.45").first()).toBeVisible();
      await expectNoSideScroll(page, width);

      const submit = await reach(page.getByRole("button", { name: th.checkout.submit }), width);
      await submit.click();
      await expect(page).toHaveURL(/\/orders\/[^/]+$/);
      await expect(page.getByText(th.orders.confirmation.paidTitle)).toBeVisible();
      await expect(page.getByText(SEEDED.storeOne.name).first()).toBeVisible();
      await expect(page.getByText(SEEDED.storeTwo.name).first()).toBeVisible();
      await expect(page.getByText("฿453.45").first()).toBeVisible();
      await expectNoSideScroll(page, width);
    });

    test("journey 5: the order is in the history with its persisted details", async () => {
      const page = customer.page;
      await page.goto("/orders");
      await expect(page.getByText(th.orders.count.replace("{total}", "1"))).toBeVisible({
        timeout: 30_000,
      });
      await expectNoSideScroll(page, width);
      const view = await reach(page.getByRole("link", { name: th.orders.view }), width);
      await view.click();
      await expect(page).toHaveURL(/\/orders\/[^/]+$/);
      await expect(page.getByText(SEEDED.productTwoA.title).first()).toBeVisible();
      await expect(page.getByText("฿453.45").first()).toBeVisible();
      await expect(page.getByText("99/9 ถนนทดสอบ").first()).toBeVisible();
      await expectNoSideScroll(page, width);
      // The cart was emptied by the order.
      await page.goto("/cart");
      await expect(page.getByText(th.cart.emptyTitle)).toBeVisible();
      await expectNoSideScroll(page, width);
    });
  });
}
