/**
 * T-081 accessibility part (REQ-N-03): an automated axe scan of the customer, seller, and admin
 * pages at 360, 768, and 1280 px, with WCAG 2.0 and 2.1 level A and AA rules. The seller and admin
 * pages must also not scroll sideways at 360 and 768.
 *
 * No rule is disabled and no element is excluded. A violation fails the test with the rule id,
 * impact, and selectors. Each width is checked with a soft assertion, so one run lists every
 * width of a page. Passing is not a claim of AA conformance: axe finds only part of WCAG (see
 * docs/TEST_STRATEGY.md "Accessibility checks").
 *
 * Sessions are real: the customer is registered and signed in through the pages
 * (support/session.ts); the seller and admin use the sessions global-setup saved from the real
 * sign-in endpoint. The customer places one mock order (1 unit of a seeded product, stock 100)
 * so the orders pages have something to show. Seller apply is scanned as that new customer, since
 * the seeded sellers are already approved.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { ADMIN_STORAGE_STATE, SEEDED } from "./support/accounts";
import { E2E_ORIGIN, SELLER_STORAGE_STATE } from "./support/constants";
import { ORIGIN_HEADERS, addToCartOnPage, registerCustomer, type Person } from "./support/session";

const WIDTHS = [360, 768, 1280] as const;
const NARROW = [360, 768] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Waits until the page body has rendered its main heading. */
async function ready(page: Page): Promise<void> {
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 60_000 });
}

async function scan(page: Page, label: string, width: number): Promise<void> {
  await ready(page);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const lines = result.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id} [${violation.impact ?? "n/a"}] ${node.target.join(" ")}`,
    ),
  );
  expect.soft(lines, `${label} at ${width} px: axe violations`).toEqual([]);
}

async function expectNoSideScroll(page: Page, label: string, width: number): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect.soft(sizes.inner, `${label}: viewport width`).toBe(width);
  expect
    .soft(sizes.scroll, `${label} at ${width} px: scrollWidth`)
    .toBeLessThanOrEqual(sizes.inner);
}

async function scanAtWidths(
  page: Page,
  path: string,
  label: string,
  options: { sideScroll?: boolean } = {},
): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(path);
    await scan(page, label, width);
    if (options.sideScroll && (NARROW as readonly number[]).includes(width)) {
      await expectNoSideScroll(page, label, width);
    }
  }
}

test.describe("customer pages", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let customer: Person;

  // Registering signs in once, which may wait a minute for a slot in the sign-in budget.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    customer = await registerCustomer(browser, "a11y");
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

  test("home", async () => {
    await scanAtWidths(customer.page, "/", "home");
  });

  test("search", async () => {
    await scanAtWidths(customer.page, "/search", "search");
    await scanAtWidths(
      customer.page,
      "/search?q=%E0%B8%81%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9B%E0%B9%8B%E0%B8%B2",
      "search results",
    );
  });

  test("product", async () => {
    await scanAtWidths(customer.page, `/products/${SEEDED.productOne.slug}`, "product");
  });

  test("cart and checkout", async () => {
    const page = customer.page;
    await addToCartOnPage(page, SEEDED.productOne.slug, 1);
    await scanAtWidths(page, "/cart", "cart");
    await scanAtWidths(page, "/checkout", "checkout");
  });

  test("orders and order detail", async () => {
    const page = customer.page;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/checkout");
    await page.getByRole("button", { name: th.checkout.submit }).click();
    await expect(page).toHaveURL(/\/orders\/[^/]+$/, { timeout: 60_000 });
    const detailPath = new URL(page.url()).pathname;
    await scanAtWidths(page, "/orders", "orders");
    await scanAtWidths(page, detailPath, "order detail");
  });

  test("seller apply", async () => {
    await scanAtWidths(customer.page, "/seller/apply", "seller apply", { sideScroll: true });
  });
});

test.describe("sign-in and sign-up (anonymous)", () => {
  test.setTimeout(180_000);
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: E2E_ORIGIN });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("sign-in", async () => {
    await scanAtWidths(page, "/sign-in", "sign-in");
  });

  test("sign-up", async () => {
    await scanAtWidths(page, "/sign-up", "sign-up");
  });
});

test.describe("seller pages", () => {
  test.use({ storageState: SELLER_STORAGE_STATE });
  test.setTimeout(180_000);

  const PAGES: Array<[string, string]> = [
    ["/seller", "seller dashboard"],
    ["/seller/products", "seller products"],
    ["/seller/products/new", "seller new product"],
    ["/seller/orders", "seller orders"],
    ["/seller/store", "seller store"],
  ];
  for (const [path, label] of PAGES) {
    test(label, async ({ page }) => {
      await scanAtWidths(page, path, label, { sideScroll: true });
    });
  }
});

test.describe("admin pages", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });
  test.setTimeout(180_000);

  const PAGES: Array<[string, string]> = [
    ["/admin", "admin dashboard"],
    ["/admin/applications", "admin applications"],
    ["/admin/stores", "admin stores"],
    ["/admin/products", "admin products"],
    ["/admin/orders", "admin orders"],
    ["/admin/users", "admin users"],
    ["/admin/categories", "admin categories"],
    ["/admin/reviews", "admin reviews"],
    ["/admin/reports", "admin reports"],
    ["/admin/audit-logs", "admin audit logs"],
    ["/admin/settings", "admin settings"],
  ];
  for (const [path, label] of PAGES) {
    test(label, async ({ page }) => {
      await scanAtWidths(page, path, label, { sideScroll: true });
    });
  }
});
