/**
 * Keyboard-only variants of journeys 3 and 4 at 1280 px (REQ-N-03; TEST_STRATEGY "Accessibility
 * checks"). Journey 3: reach a product from a list, raise the quantity, add it to the cart, and
 * reach the cart. Journey 4: reach checkout, choose a delivery address, submit, and read the order.
 *
 * After the customer is registered (setup, with the pointer), every step is a key press: Tab,
 * Shift+Tab, Enter, Space, arrow keys. Opening a list page by address is a `goto`, as the address
 * bar is not a pointer action. At every stop the control has a visible focus ring; a walk fails if
 * focus leaves the page, loops, or does not arrive. A pointer counter in the page proves that no
 * pointer event happened after setup.
 *
 * Prices: 2 x 123.45 + 250.00 = 496.90 of goods, 2 x 40.00 shipping, 576.90 in total.
 */
import { expect, test } from "@playwright/test";
import { th } from "@/i18n/th";
import { SEEDED } from "./support/accounts";
import {
  countPointerEvents,
  expectFocusVisible,
  expectNotTrapped,
  pointerCount,
  pressUntilFocused,
} from "./support/keyboard";
import { ORIGIN_HEADERS, registerCustomer, type Person } from "./support/session";

const WIDTH = 1280;
const SECOND_ADDRESS_LINE = "55/5 ถนนที่สอง";

test.describe("journeys 3 and 4, keyboard only, 1280 px", () => {
  test.describe.configure({ mode: "serial" });

  let customer: Person;

  test.beforeAll(async ({ browser }) => {
    customer = await registerCustomer(browser, "kbd");
    await customer.page.setViewportSize({ width: WIDTH, height: 800 });
    // Two addresses, so choosing one with the arrow keys changes something.
    for (const [line1, isDefault] of [
      ["99/9 ถนนทดสอบ", true],
      [SECOND_ADDRESS_LINE, false],
    ] as const) {
      const response = await customer.context.request.post("/api/v1/me/addresses", {
        headers: ORIGIN_HEADERS,
        data: {
          recipientName: "ผู้ซื้อ E2E",
          phone: "0812345678",
          line1,
          subdistrict: "ทดสอบ",
          district: "ทดสอบ",
          province: "กรุงเทพมหานคร",
          postalCode: "10110",
          isDefault,
        },
      });
      expect(response.ok(), `address answered ${response.status()}`).toBe(true);
    }
    await countPointerEvents(customer.page);
  });

  test.afterAll(async () => {
    await customer.context.close();
  });

  test("journey 3: reach two products, add them to the cart, open the cart", async () => {
    const page = customer.page;

    // Product one (store one), from its category page.
    await page.goto(`/categories/${SEEDED.categoryOne.slug}`);
    expect(await page.evaluate(() => window.innerWidth)).toBe(WIDTH);
    const productOneLink = page.locator(`a[href="/products/${SEEDED.productOne.slug}"]`).first();
    await expect(productOneLink).toBeVisible({ timeout: 30_000 });
    await pressUntilFocused(page, productOneLink);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/products/${SEEDED.productOne.slug}$`));

    // Quantity 2: Tab to the plus button, Enter. Then Tab to the add button, Enter.
    const increase = page.getByRole("button", { name: th.cart.increase });
    await pressUntilFocused(page, increase);
    await page.keyboard.press("Enter");
    const quantity = page.getByRole("spinbutton", { name: th.cart.add.quantity });
    await expect(quantity).toHaveValue("2");
    await expectNotTrapped(page);
    const add = page.getByRole("button", { name: th.cart.add.submit });
    await pressUntilFocused(page, add);
    await page.keyboard.press("Enter");
    await expect(page.getByText(th.cart.add.success)).toBeVisible();

    // Product two (store two): its category page, Tab to the card link, Enter, add one.
    await page.goto(`/categories/${SEEDED.categoryTwo.slug}`);
    const productTwoLink = page.locator(`a[href="/products/${SEEDED.productTwoA.slug}"]`).first();
    await expect(productTwoLink).toBeVisible({ timeout: 30_000 });
    await pressUntilFocused(page, productTwoLink);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/products/${SEEDED.productTwoA.slug}$`));
    const addTwo = page.getByRole("button", { name: th.cart.add.submit });
    await pressUntilFocused(page, addTwo);
    await page.keyboard.press("Enter");
    await expect(page.getByText(th.cart.add.success)).toBeVisible();

    // The "view cart" link is the stop before the add button (alert action): Shift+Tab, Enter.
    // (The add button loses focus while it is disabled during the request; see the last test.)
    const viewCart = page.getByRole("link", { name: th.cart.add.viewCart });
    await pressUntilFocused(page, viewCart, "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(th.cart.title);
    const summary = page.getByRole("region", { name: th.cart.summaryTitle });
    await expect(summary).toContainText("฿496.90");
    await expect(summary).toContainText("฿80.00");
    await expect(summary).toContainText("฿576.90");
    expect(await pointerCount(page)).toBe(0);
  });

  test("journey 4: choose an address with the arrow keys and place the mock order", async () => {
    const page = customer.page;

    // From the cart, Tab to the checkout link, Enter.
    await page.goto("/cart");
    const toCheckout = page.getByRole("link", { name: th.cart.checkout });
    await expect(toCheckout).toBeVisible({ timeout: 30_000 });
    await pressUntilFocused(page, toCheckout);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByText(th.checkout.paymentMockNote)).toBeVisible();
    await expect(page.getByText("฿576.90").first()).toBeVisible();

    // Tab into the address group: the default address is the checked radio and gets the stop.
    const group = page.getByRole("radiogroup", { name: th.checkout.addressLegend });
    const checked = group.getByRole("radio", { checked: true });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await pressUntilFocused(page, checked);
    await expect(group).toContainText("99/9 ถนนทดสอบ");
    // An arrow key chooses the other address; it becomes the checked radio and keeps the ring.
    await page.keyboard.press("ArrowDown");
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
    const chosen = group.getByRole("radio", { checked: true });
    await expect(chosen).toBeFocused();
    await expectFocusVisible(chosen);
    await expect(
      group.locator("label", { hasText: SECOND_ADDRESS_LINE }).getByRole("radio"),
    ).toBeChecked();
    await expectNotTrapped(page);

    // The test-only failure option is a stop on the way: Tab to it, Space on, Space off.
    const failOption = page.getByRole("checkbox", { name: th.checkout.failOption });
    await pressUntilFocused(page, failOption);
    await page.keyboard.press("Space");
    await expect(failOption).toBeChecked();
    await page.keyboard.press("Space");
    await expect(failOption).not.toBeChecked();
    await expectNotTrapped(page);

    // Submit with Enter on the confirm button.
    const submit = page.getByRole("button", { name: th.checkout.submit });
    await pressUntilFocused(page, submit);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/orders\/[^/]+$/);
    await expect(page.getByText(th.orders.confirmation.paidTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(SEEDED.storeOne.name).first()).toBeVisible();
    await expect(page.getByText(SEEDED.storeTwo.name).first()).toBeVisible();
    await expect(page.getByText("฿576.90").first()).toBeVisible();
    // The address chosen with the arrow key, not the default one, is on the order.
    const addressLine = page.getByText(SECOND_ADDRESS_LINE).first();
    await expect(addressLine).toBeVisible();
    await expect(addressLine.locator("..")).not.toContainText("99/9 ถนนทดสอบ");
    expect(await pointerCount(page)).toBe(0);

    // The order is in the history and the cart is empty.
    await page.goto("/orders");
    await expect(page.getByText(th.orders.count.replace("{total}", "1"))).toBeVisible({
      timeout: 30_000,
    });
    await page.goto("/cart");
    await expect(page.getByText(th.cart.emptyTitle)).toBeVisible();
  });

  test("focus stays on the add button after a successful add", async () => {
    const page = customer.page;
    await page.goto(`/products/${SEEDED.productTwoB.slug}`);
    const add = page.getByRole("button", { name: th.cart.add.submit });
    await pressUntilFocused(page, add);
    await page.keyboard.press("Enter");
    await expect(page.getByText(th.cart.add.success)).toBeVisible();
    // A keyboard user who pressed the button expects to be where they were. The button is
    // natively disabled while the request runs (Button `loading`), and the browser drops focus
    // to the page body, so the next Tab starts from the top of the page.
    await expect(add).toBeFocused();
    await expectFocusVisible(add);
    expect(await pointerCount(page)).toBe(0);
  });
});
