/**
 * addToCartOnPage and registerCustomer drive the real pages (see support/session.ts).
 *
 * Journeys 3, 4, 5 and 8: a cart with products from two stores, a mock checkout that fails and
 * then one that succeeds, the order in the customer's history with the persisted amounts, stock
 * taken from the products, and a seller moving their part of the order through fulfilment while
 * the customer watches.
 *
 * The customer registers on /sign-up, signs out from the header menu, signs in on /sign-in, and
 * fills the cart with the add-to-cart control of two product pages. Only the delivery address
 * is set up through the address endpoint (setup, not the journey under test). Everything else
 * is the real UI.
 *
 * The tests run in order and share one customer.
 *
 * Amounts (shipping is a flat 40.00 per store, tests/helpers/reset.ts):
 *   store one: 2 x 123.45 = 246.90 + 40.00      store two: 1 x 250.00 + 40.00
 *   items 496.90, shipping 80.00, total 576.90
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { SEEDED, SELLER_TWO_STORAGE_STATE } from "./support/accounts";
import { E2E_ORIGIN } from "./support/constants";
import {
  ORIGIN_HEADERS,
  addToCartOnPage,
  openAs,
  registerCustomer,
  type Person,
} from "./support/session";

test.describe.configure({ mode: "serial" });

let customer: Person;
let orderId = "";

async function post(api: APIRequestContext, url: string, data: unknown): Promise<void> {
  const response = await api.post(url, { headers: ORIGIN_HEADERS, data });
  expect(response.ok(), `${url} answered ${response.status()}`).toBe(true);
}

async function expectNoSideScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
}

test.beforeAll(async ({ browser }) => {
  customer = await registerCustomer(browser, "buyer");
  const api = customer.context.request;
  await post(api, "/api/v1/me/addresses", {
    recipientName: "ผู้ซื้อ E2E",
    phone: "0812345678",
    line1: "99/9 ถนนทดสอบ",
    subdistrict: "ทดสอบ",
    district: "ทดสอบ",
    province: "กรุงเทพมหานคร",
    postalCode: "10110",
    isDefault: true,
  });
  // The cart is filled through the add-to-cart control of two product pages (two stores).
  await addToCartOnPage(customer.page, SEEDED.productOne.slug, 2);
  await addToCartOnPage(customer.page, SEEDED.productTwoA.slug, 1);
  // The header badge is stale until navigation; after a load it shows the 2 cart lines.
  await customer.page.goto("/");
  await expect(
    customer.page.getByRole("link", {
      name: th.shell.header.cart.labelWithCount.replace("{count}", "2"),
    }),
  ).toBeVisible();
});

test.afterAll(async () => {
  await customer.context.close();
});

test("the cart groups lines by store and shows server-computed totals with a simulated-shipping label", async () => {
  const page = customer.page;
  await page.goto("/cart");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(th.cart.title);
  await expect(
    page.getByRole("heading", { level: 2, name: SEEDED.storeOne.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: SEEDED.storeTwo.name, exact: true }),
  ).toBeVisible();
  const summary = page.getByRole("region", { name: th.cart.summaryTitle });
  await expect(summary).toContainText("฿496.90");
  await expect(summary).toContainText("฿80.00");
  await expect(summary).toContainText("฿576.90");
  await expect(summary.getByText(th.notice.simulatedShipping)).toBeVisible();

  // Changing a quantity makes the server recompute the lines and the totals.
  const line = page.getByRole("group", { name: /สินค้าทดสอบชื่อยาวมาก/ });
  await line.getByRole("button", { name: th.cart.increase }).click();
  await expect(summary).toContainText("฿700.35");
  await line.getByRole("button", { name: th.cart.decrease }).click();
  await expect(summary).toContainText("฿576.90");
});

test("a simulated payment failure creates a failed order and puts the items back in the cart", async () => {
  const page = customer.page;
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/cart");
  await expectNoSideScroll(page);
  await page.getByRole("link", { name: th.cart.checkout }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await expectNoSideScroll(page);

  // The payment is labelled as a mock, and so is the shipping.
  await expect(page.getByText(th.checkout.paymentMockNote)).toBeVisible();
  await expect(page.getByText(th.checkout.shippingNote)).toBeVisible();
  await expect(page.getByText("฿576.90").first()).toBeVisible();

  await page.getByLabel(th.checkout.failOption).check();
  await page.getByRole("button", { name: th.checkout.submit }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+/);
  await expect(page.getByText(th.orders.confirmation.failedBody)).toBeVisible();
  await expect(page.getByText(th.order.paymentFailed).first()).toBeVisible();

  // Nothing was taken from stock, and the cart has both stores again.
  await page.goto("/cart");
  await expect(
    page.getByRole("heading", { level: 2, name: SEEDED.storeOne.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: SEEDED.storeTwo.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: th.cart.summaryTitle })).toContainText("฿576.90");
});

test("a mock checkout creates a paid order that the history and the detail page show", async () => {
  const page = customer.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/checkout");
  await expect(page.getByText(th.checkout.paymentMockNote)).toBeVisible();
  await expect(page.getByText(th.notice.mockPayment).first()).toBeVisible();
  await page.getByRole("button", { name: th.checkout.submit }).click();

  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  orderId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(orderId).not.toBe("");
  await expect(page.getByText(th.orders.confirmation.paidTitle)).toBeVisible();
  await expect(page.getByText(th.orders.confirmation.paidBody)).toBeVisible();

  // The persisted order: both stores, quantities, line amounts, and the total.
  await expect(page.getByText(SEEDED.storeOne.name).first()).toBeVisible();
  await expect(page.getByText(SEEDED.storeTwo.name).first()).toBeVisible();
  await expect(page.getByText(SEEDED.productTwoA.title).first()).toBeVisible();
  await expect(page.getByText("฿576.90").first()).toBeVisible();
  await expect(page.getByText(th.orders.detail.addressTitle).first()).toBeVisible();
  await expect(page.getByText("99/9 ถนนทดสอบ").first()).toBeVisible();

  // The cart is empty and the order is in the history, once.
  await page.goto("/cart");
  await expect(page.getByText(th.cart.emptyTitle)).toBeVisible();
  await page.goto("/orders");
  await expect(page.getByText(fillCount(th.orders.count, 2))).toBeVisible();
  const links = page.getByRole("link", { name: th.orders.view });
  await expect(links).toHaveCount(2);
  await links.first().click();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
});

function fillCount(template: string, total: number): string {
  return template.replace("{total}", String(total));
}

test("stock was taken from the bought products", async ({ browser }) => {
  const seller = await openAs(browser, SELLER_TWO_STORAGE_STATE);
  try {
    await seller.page.goto("/seller/products");
    const row = seller.page.getByRole("row").filter({ hasText: SEEDED.productTwoA.title });
    // 100 at the start, 1 bought; the failed order took none.
    await expect(row).toContainText("99 ชิ้น");
  } finally {
    await seller.context.close();
  }
});

test("a seller moves their part through fulfilment and the customer sees each step", async ({
  browser,
}) => {
  const seller = await openAs(browser, SELLER_TWO_STORAGE_STATE);
  try {
    await seller.page.goto("/seller/orders");
    await seller.page.getByRole("link", { name: th.seller.orders.row.view }).first().click();
    await expect(seller.page).toHaveURL(/\/seller\/orders\/[^/]+$/);
    // The seller sees only their own store's amounts: 250.00 + 40.00 shipping.
    await expect(seller.page.getByText("฿250.00").first()).toBeVisible();
    await expect(seller.page.getByText("฿576.90")).toHaveCount(0);

    const customerPage = customer.page;
    const watch = async (label: string) => {
      await customerPage.goto(`/orders/${orderId}`);
      await expect(customerPage.getByText(label).first()).toBeVisible();
    };
    await watch(th.orders.status.fulfilment.PENDING);

    await seller.page
      .getByRole("button", { name: th.seller.orders.actions.confirm, exact: true })
      .click();
    await expect(seller.page.getByText(th.seller.orders.actions.confirmed)).toBeVisible();
    await watch(th.orders.status.fulfilment.PROCESSING);

    await seller.page.getByLabel(th.seller.orders.actions.carrierName).fill("ขนส่งจำลอง");
    await seller.page.getByLabel(th.seller.orders.actions.trackingNumber).fill("MOCK123456");
    await seller.page
      .getByRole("button", { name: th.seller.orders.actions.ship, exact: true })
      .click();
    await expect(seller.page.getByText(th.seller.orders.actions.shipped)).toBeVisible();
    await watch(th.orders.status.fulfilment.SHIPPED);
    await expect(customerPage.getByText("MOCK123456")).toBeVisible();
    await expect(customerPage.getByText(th.orders.detail.shipmentSimulated).first()).toBeVisible();

    await seller.page
      .getByRole("button", { name: th.seller.orders.actions.deliver, exact: true })
      .click();
    await expect(seller.page.getByText(th.seller.orders.actions.delivered)).toBeVisible();
    await watch(th.orders.status.fulfilment.DELIVERED);
  } finally {
    await seller.context.close();
  }
});

test("another account cannot read the customer's order", async ({ browser }) => {
  const seller = await openAs(browser, SELLER_TWO_STORAGE_STATE);
  try {
    const response = await seller.context.request.get(`/api/v1/orders/${orderId}`);
    expect(response.status()).toBe(404);
    const anonymous = await browser.newContext({ baseURL: E2E_ORIGIN });
    try {
      const noSession = await anonymous.request.get(`/api/v1/orders/${orderId}`);
      expect(noSession.status()).toBe(401);
    } finally {
      await anonymous.close();
    }
  } finally {
    await seller.context.close();
  }
});
