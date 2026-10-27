/**
 * Journeys 7 and 9 as one chain, because each step needs the one before it: a seller creates a
 * product and sets its stock; it is invisible to shoppers while it is a draft and while it waits
 * for approval; an admin approves it and it appears on the storefront at the price the seller
 * typed; the admin takes it down with a reason and it leaves the storefront again.
 *
 * The seller is the second e2e seller, not the first one, because the stacked-table spec counts
 * the first seller's products.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { SEEDED, SELLER_TWO_STORAGE_STATE, ADMIN_STORAGE_STATE } from "./support/accounts";
import { E2E_ORIGIN } from "./support/constants";

test.use({ storageState: SELLER_TWO_STORAGE_STATE });

const TITLE = `สินค้าวงจรชีวิต E2E ${Date.now().toString(36)}`;

async function storefrontShows(page: Page, title: string): Promise<boolean> {
  await page.goto(`/search?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return (await page.locator('a[href^="/products/"]').filter({ hasText: title }).count()) > 0;
}

async function adminPage(browser: Browser) {
  const context = await browser.newContext({
    baseURL: E2E_ORIGIN,
    storageState: ADMIN_STORAGE_STATE,
  });
  return { context, page: await context.newPage() };
}

test("seller creates a product, an admin approves then takes it down, and the storefront follows", async ({
  page,
  browser,
}) => {
  // Seller creates a draft with a price in baht and a starting stock.
  await page.goto("/seller/products/new");
  await page.getByLabel(th.seller.products.form.title).fill(TITLE);
  await page.getByLabel(th.seller.products.form.description).fill("รายละเอียดสินค้าสำหรับทดสอบ");
  await page.getByLabel(th.seller.products.form.sku).fill(`E2E-LIFE-${Date.now()}`);
  await page
    .getByLabel(th.seller.products.form.category)
    .selectOption({ label: SEEDED.categoryTwo.name });
  await page.getByLabel(th.seller.products.form.price).fill("259.50");
  await page.getByLabel(th.seller.products.form.stock).fill("7");
  await page.getByRole("button", { name: th.seller.products.form.create }).click();

  await expect(page).toHaveURL(/\/seller\/products\/[^/?]+\?created=1/);
  await expect(page.getByText(th.seller.products.created)).toBeVisible();
  const productId = new URL(page.url()).pathname.split("/").pop();
  expect(productId).toBeTruthy();
  await expect(page.getByRole("status").filter({ hasText: "7" })).toBeVisible();

  // It is in the seller's own list, and a draft is not on the storefront.
  await page.goto("/seller/products");
  await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
  expect(await storefrontShows(page, TITLE)).toBe(false);

  // The seller changes the stock; the page shows the stored value after a reload.
  await page.goto(`/seller/products/${productId}`);
  await page.getByLabel(th.seller.products.stock.set, { exact: true }).fill("40");
  await page.getByRole("button", { name: th.seller.products.stock.setAction }).click();
  await expect(page.getByText(th.seller.products.stock.updated)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "40" })).toBeVisible();

  // Publishing sends it to review: still not on the storefront.
  await page.getByRole("button", { name: th.seller.products.actions.publish, exact: true }).click();
  await expect(page.getByText(th.seller.products.actions.publishedPending)).toBeVisible();
  expect(await storefrontShows(page, TITLE)).toBe(false);

  // The admin approves it.
  const admin = await adminPage(browser);
  try {
    await admin.page.goto(`/admin/products/${productId}`);
    await admin.page.getByRole("button", { name: th.admin.products.approve, exact: true }).click();
    await admin.page
      .getByRole("alertdialog")
      .getByRole("button", { name: th.admin.products.approveConfirmAction })
      .click();
    await expect(admin.page.getByText(th.admin.products.approved)).toBeVisible();

    // Approved: shoppers find it, at the seller's price.
    await expect.poll(() => storefrontShows(page, TITLE)).toBe(true);
    await page.getByRole("link", { name: TITLE }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
    await expect(page.getByText("฿259.50").first()).toBeVisible();

    // The admin takes it down; a reason is required.
    await admin.page.reload();
    await admin.page.getByRole("button", { name: th.admin.products.takedown, exact: true }).click();
    const dialog = admin.page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: th.admin.products.takedownConfirmAction }).click();
    await expect(
      dialog.getByText(th.admin.common.reasonErrors.required, { exact: true }),
    ).toBeVisible();
    await dialog.getByLabel(th.admin.common.reasonLabel).fill("ทดสอบการถอดสินค้า E2E");
    await dialog.getByRole("button", { name: th.admin.products.takedownConfirmAction }).click();
    await expect(admin.page.getByText(th.admin.products.takenDown)).toBeVisible();
  } finally {
    await admin.context.close();
  }

  // Gone from the storefront, and the seller sees why.
  expect(await storefrontShows(page, TITLE)).toBe(false);
  await page.goto(`/seller/products/${productId}`);
  await expect(page.getByText(th.seller.products.takenDownTitle)).toBeVisible();
  await expect(page.getByText("ทดสอบการถอดสินค้า E2E")).toBeVisible();
});
