/**
 * Journey 6: a customer applies to sell, an admin rejects with a reason, the customer reapplies,
 * the admin approves, and the applicant's role follows. The applicant registers and signs in
 * through the real /sign-up and /sign-in pages.
 *
 * Also checks that a seller is refused the admin pages (the server says so, not only the menu).
 */
import { expect, test, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { ADMIN_STORAGE_STATE } from "./support/accounts";
import { SELLER_STORAGE_STATE } from "./support/constants";
import { openAs, registerCustomer } from "./support/session";

async function fillAndSubmit(page: Page, storeName: string): Promise<void> {
  await page.getByLabel(th.seller.apply.fields.storeName).fill(storeName);
  await page.getByLabel(th.seller.apply.fields.description).fill("ร้านสำหรับทดสอบการสมัคร E2E");
  await page.getByLabel(th.seller.apply.fields.contactPhone).fill("0812345678");
  await page.getByRole("button", { name: th.seller.apply.submit }).click();
}

test("applicant is rejected with a reason, reapplies, is approved, and becomes a seller", async ({
  browser,
}) => {
  const storeName = `ร้านสมัคร E2E ${Date.now().toString(36)}`;
  const reason = "ข้อมูลร้านไม่ครบถ้วน E2E";
  const applicant = await registerCustomer(browser, "applicant");
  const admin = await openAs(browser, ADMIN_STORAGE_STATE);
  try {
    // A customer has no store: the seller page offers the application.
    await applicant.page.goto("/seller");
    await expect(applicant.page.getByText(th.seller.guard.customerTitle)).toBeVisible();
    await applicant.page.getByRole("link", { name: th.seller.guard.customerAction }).click();
    await expect(applicant.page).toHaveURL(/\/seller\/apply/);

    // An empty form is refused in the browser before anything is sent.
    await applicant.page.getByRole("button", { name: th.seller.apply.submit }).click();
    await expect(
      applicant.page.getByText(th.seller.fieldErrors.storeName.required, { exact: true }),
    ).toBeVisible();

    await fillAndSubmit(applicant.page, storeName);
    await expect(applicant.page.getByText(th.seller.apply.statusTitle)).toBeVisible();
    await expect(
      applicant.page.getByText(th.seller.status.application.PENDING).first(),
    ).toBeVisible();

    // The admin sees the application with the applicant's email. Rejecting needs a reason.
    await admin.page.goto("/admin/applications");
    const row = admin.page.getByRole("row").filter({ hasText: storeName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(applicant.email);
    await row.getByRole("button", { name: th.admin.applications.reject, exact: true }).click();
    const dialog = admin.page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: th.admin.applications.rejectConfirmAction }).click();
    await expect(
      dialog.getByText(th.admin.common.reasonErrors.required, { exact: true }),
    ).toBeVisible();
    await dialog.getByLabel(th.admin.common.reasonLabel).fill(reason);
    await dialog.getByRole("button", { name: th.admin.applications.rejectConfirmAction }).click();
    await expect(admin.page.getByText(th.admin.applications.rejected)).toBeVisible();

    // The applicant sees the decision and the reason, and is still a customer.
    await applicant.page.goto("/seller/apply");
    await expect(
      applicant.page.getByText(th.seller.status.application.REJECTED).first(),
    ).toBeVisible();
    await expect(applicant.page.getByText(reason)).toBeVisible();
    await applicant.page.goto("/seller");
    await expect(applicant.page.getByText(th.seller.guard.customerTitle)).toBeVisible();

    // Reapply with the same name (the rejected application created no store), then approval.
    await applicant.page.goto("/seller/apply");
    await fillAndSubmit(applicant.page, storeName);
    await expect(applicant.page.getByText(th.seller.apply.pendingNote)).toBeVisible();

    await admin.page.goto("/admin/applications");
    const pending = admin.page
      .getByRole("row")
      .filter({ hasText: storeName })
      .filter({ has: admin.page.getByRole("button", { name: th.admin.applications.approve }) });
    await expect(pending).toHaveCount(1);
    await pending.getByRole("button", { name: th.admin.applications.approve, exact: true }).click();
    await admin.page
      .getByRole("alertdialog")
      .getByRole("button", { name: th.admin.applications.approveConfirmAction })
      .click();
    await expect(admin.page.getByText(th.admin.applications.approved)).toBeVisible();

    // Now a seller: the "no store" guard is gone and the store carries the applied name.
    await applicant.page.goto("/seller");
    await expect(applicant.page.getByText(th.seller.guard.customerTitle)).toHaveCount(0);
    await applicant.page.goto("/seller/store");
    await expect(applicant.page.getByLabel(th.seller.store.fields.name)).toHaveValue(storeName);
  } finally {
    await applicant.context.close();
    await admin.context.close();
  }
});

test("a seller is refused the admin pages", async ({ browser }) => {
  const seller = await openAs(browser, SELLER_STORAGE_STATE);
  try {
    await seller.page.goto("/admin/applications");
    await expect(seller.page.getByText(th.admin.guard.forbiddenTitle)).toBeVisible();
    await expect(
      seller.page.getByRole("button", { name: th.admin.applications.approve }),
    ).toHaveCount(0);
  } finally {
    await seller.context.close();
  }
});
