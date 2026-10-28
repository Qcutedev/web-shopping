/**
 * Journey 16: an admin rejects a product with a reason; the seller sees the reason, saves a
 * correction, and with no further button the product is back in the admin's queue; after approval
 * it is on the storefront (OQ-06, OQ-36).
 *
 * The product is made by the second e2e seller and published through the API (setup); the
 * rejection, the correction, and the approval are driven through the pages.
 */
import { expect, test } from "@playwright/test";
import { th } from "@/i18n/th";
import { ADMIN_STORAGE_STATE, SELLER_TWO_STORAGE_STATE } from "./support/accounts";
import { createDraft } from "./support/catalog";
import { ORIGIN_HEADERS, openAs } from "./support/session";

test.use({ storageState: SELLER_TWO_STORAGE_STATE });

test("a rejected product is corrected, returns to the queue by itself, and is approved onto the storefront", async ({
  page,
  browser,
}) => {
  const REASON = "ภาพและรายละเอียดไม่ชัดเจน E2E";
  const product = await createDraft(page.request, "สินค้าถูกปฏิเสธ", 4);
  const corrected = `${product.title} แก้ไขแล้ว`;
  const publish = await page.request.post(`/api/v1/seller/products/${product.id}/publish`, {
    headers: ORIGIN_HEADERS,
    data: {},
  });
  expect(publish.ok()).toBe(true);

  const admin = await openAs(browser, ADMIN_STORAGE_STATE);
  try {
    // Positive control: the product is in the admin's queue before the rejection, so its absence
    // afterwards means something.
    await admin.page.goto("/admin/products");
    await expect(admin.page.getByRole("link", { name: product.title })).toBeVisible();

    // The admin rejects it; a reason is required.
    await admin.page.goto(`/admin/products/${product.id}`);
    await admin.page.getByRole("button", { name: th.admin.products.reject, exact: true }).click();
    const dialog = admin.page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: th.admin.products.rejectConfirmAction }).click();
    await expect(
      dialog.getByText(th.admin.common.reasonErrors.required, { exact: true }),
    ).toBeVisible();
    await dialog.getByLabel(th.admin.common.reasonLabel).fill(REASON);
    await dialog.getByRole("button", { name: th.admin.products.rejectConfirmAction }).click();
    await expect(admin.page.getByText(th.admin.products.rejected)).toBeVisible();

    // Rejected: the queue no longer lists it. (It was never approved, so it was never on the
    // storefront; the storefront is checked after approval below.)
    await admin.page.goto("/admin/products");
    await expect(admin.page.getByRole("link", { name: product.title })).toHaveCount(0);

    // The seller sees the decision and the reason, and the way to resubmit.
    await page.goto(`/seller/products/${product.id}`);
    await expect(page.getByText(th.seller.products.rejectedTitle)).toBeVisible();
    await expect(page.getByText(REASON)).toBeVisible();
    await expect(page.getByText(th.seller.products.resubmitNote)).toBeVisible();

    // The seller saves a correction. There is no separate resubmit step.
    await page.getByLabel(th.seller.products.form.title).fill(corrected);
    await page.getByRole("button", { name: th.seller.products.form.save }).click();
    await expect(page.getByText(th.seller.products.form.saved)).toBeVisible();
    await page.reload();
    await expect(page.getByText(th.seller.products.rejectedTitle)).toHaveCount(0);
    await expect(page.getByText(th.seller.products.pendingNote)).toBeVisible();

    // Back in the admin's queue under the corrected title.
    await admin.page.goto("/admin/products");
    await expect(admin.page.getByRole("link", { name: corrected })).toBeVisible();

    // Approval puts it on the storefront.
    await admin.page.goto(`/admin/products/${product.id}`);
    await admin.page.getByRole("button", { name: th.admin.products.approve, exact: true }).click();
    await admin.page
      .getByRole("alertdialog")
      .getByRole("button", { name: th.admin.products.approveConfirmAction })
      .click();
    await expect(admin.page.getByText(th.admin.products.approved)).toBeVisible();
    await expect
      .poll(
        async () => {
          await page.goto(`/search?q=${encodeURIComponent(corrected)}`);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          return page.locator('a[href^="/products/"]').filter({ hasText: corrected }).count();
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  } finally {
    await admin.context.close();
  }
});
