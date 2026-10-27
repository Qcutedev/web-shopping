/**
 * Add-to-cart error states through the real product page: signed out, a product that sold out
 * after the page loaded, the quantity cap of the stepper, and a product shoppers cannot see.
 *
 * Products are made through the API by the second e2e seller and approved by the e2e admin
 * (support/catalog.ts); the customer is registered through the real forms.
 */
import { expect, test, type BrowserContext } from "@playwright/test";
import { th } from "@/i18n/th";
import { SEEDED } from "./support/accounts";
import { createDraft, openSeller, publishAndApprove, setStock } from "./support/catalog";
import { ORIGIN_HEADERS, registerCustomer } from "./support/session";

// A sign-in may wait for the per-address allowance (support/sign-in-budget.ts).
test.setTimeout(150_000);

// A sign-in can wait up to a minute for a slot in the sign-in budget (support/sign-in-budget.ts).
test.describe.configure({ timeout: 180_000 });

let seller: BrowserContext;

test.beforeAll(async ({ browser }) => {
  seller = await openSeller(browser);
});

test.afterAll(async () => {
  await seller.close();
});

test("signed out, adding to the cart is refused and offers a sign-in link that returns here", async ({
  page,
}) => {
  await page.goto(`/products/${SEEDED.productOne.slug}`);
  await page.getByRole("button", { name: th.cart.add.submit }).click();
  const alert = page.getByRole("alert").filter({ hasText: th.errors.unauthenticated });
  await expect(alert).toBeVisible();
  await expect(page.getByText(th.cart.add.success)).toHaveCount(0);
  const link = alert.getByRole("link", { name: th.shell.header.signIn });
  await expect(link).toHaveAttribute("href", /\/sign-in\?.*next=.*products/);

  // The API says the same, and stores nothing.
  const direct = await page.request.get("/api/v1/cart");
  expect(direct.status()).toBe(401);
});

test("a product that sold out after the page loaded is refused and leaves the cart empty", async ({
  browser,
}) => {
  const product = await createDraft(seller.request, "สินค้าหมดทีหลัง", 3);
  await publishAndApprove(browser, seller.request, product.id);
  const customer = await registerCustomer(browser, "soldout");
  try {
    const page = customer.page;
    await page.goto(`/products/${product.slug}`);
    await expect(page.getByText(th.cart.add.stockNote.replace("{stock}", "3"))).toBeVisible();

    // The seller sells the last unit elsewhere while the page is open.
    await setStock(seller.request, product.id, 0);
    await page.getByRole("button", { name: th.cart.add.submit }).click();
    await expect(page.getByText(th.errors.insufficientStock)).toBeVisible();
    await expect(page.getByText(th.cart.add.success)).toHaveCount(0);

    // A fresh load shows the sold-out notice instead of the form.
    await page.reload();
    await expect(page.getByText(th.cart.soldOutRefused)).toBeVisible();
    await expect(page.getByRole("button", { name: th.cart.add.submit })).toHaveCount(0);

    await page.goto("/cart");
    await expect(page.getByText(th.cart.emptyTitle)).toBeVisible();
  } finally {
    await customer.context.close();
  }
});

test("the quantity cannot go above the stock, and the server refuses a direct request above 99", async ({
  browser,
}) => {
  const product = await createDraft(seller.request, "สินค้าจำกัดจำนวน", 2);
  await publishAndApprove(browser, seller.request, product.id);
  const customer = await registerCustomer(browser, "overqty");
  try {
    const page = customer.page;
    await page.goto(`/products/${product.slug}`);
    const quantity = page.getByRole("spinbutton", { name: th.cart.add.quantity });
    await page.getByRole("button", { name: th.cart.increase }).click();
    await expect(quantity).toHaveValue("2");
    // At the stock the plus button is disabled.
    await expect(page.getByRole("button", { name: th.cart.increase })).toBeDisabled();
    // Typing a larger number is clamped to the stock.
    await quantity.fill("50");
    await quantity.blur();
    await expect(quantity).toHaveValue("2");

    await page.getByRole("button", { name: th.cart.add.submit }).click();
    await expect(page.getByText(th.cart.add.success)).toBeVisible();

    // Direct requests: above the cap, zero, negative, and fractional quantities are all refused.
    for (const bad of [100, 0, -1, 1.5]) {
      const response = await customer.context.request.post("/api/v1/cart/items", {
        headers: ORIGIN_HEADERS,
        data: { productId: product.id, quantity: bad },
      });
      expect(response.status(), `quantity ${bad}`).toBe(400);
    }

    // The cart still holds the two units from the page, not more than the stock.
    await page.goto("/cart");
    await expect(page.getByRole("spinbutton").first()).toHaveValue("2");
  } finally {
    await customer.context.close();
  }
});

test("a draft product is not on the storefront and cannot be added to a cart", async ({
  browser,
}) => {
  const product = await createDraft(seller.request, "สินค้าซ่อน", 5);
  const customer = await registerCustomer(browser, "hidden");
  try {
    const page = customer.page;
    await page.goto(`/products/${product.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: th.notFound.title })).toBeVisible();
    await expect(page.getByRole("button", { name: th.cart.add.submit })).toHaveCount(0);
    await expect(page.getByText(product.title)).toHaveCount(0);

    const direct = await customer.context.request.post("/api/v1/cart/items", {
      headers: ORIGIN_HEADERS,
      data: { productId: product.id, quantity: 1 },
    });
    expect([404, 409]).toContain(direct.status());

    await page.goto("/cart");
    await expect(page.getByText(th.cart.emptyTitle)).toBeVisible();
  } finally {
    await customer.context.close();
  }
});
