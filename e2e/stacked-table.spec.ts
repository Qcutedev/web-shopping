/**
 * CR-118 (docs/reviews/T-044-code-review.md): the stacked variant of the Table primitive, in a
 * real browser against the real compiled CSS, on the seller products page (the stacked Table
 * there is the same component every stacked table uses).
 *
 * Below md (767.98px and narrower) the finding requires: the scroll wrapper is not a keyboard
 * stop; the header row is hidden from sight but still in the accessibility tree; it appears while
 * a button inside it has keyboard focus; each cell shows its column name; the page does not
 * scroll sideways. From md the table is the normal table: wrapper focusable, header visible,
 * per-cell labels hidden.
 *
 * No product page has a sortable stacked column yet, so the sort-button case injects a real
 * <button> into a header cell of the real table and focuses it. That exercises the CSS rule
 * (`:not(:focus-within)`) and nothing of the sort logic, which table.test.tsx covers.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { SELLER_STORAGE_STATE } from "./support/environment";

test.use({ storageState: SELLER_STORAGE_STATE });

const PRODUCTS_URL = "/seller/products";
const STATUS_LABEL = th.seller.products.columns.status;

async function openProducts(
  page: Page,
  width: number,
): Promise<{ region: Locator; thead: Locator }> {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(PRODUCTS_URL, { waitUntil: "networkidle" });
  const region = page.locator("[data-stacked]");
  await expect(region).toBeVisible();
  await expect(region.locator("tbody tr")).toHaveCount(3);
  return { region, thead: region.locator("thead") };
}

/** True when the element occupies at least a 2x2 px box (the sr-only clip is 1x1). */
async function isPainted(el: Locator): Promise<boolean> {
  const box = await el.boundingBox();
  return box !== null && box.width > 1 && box.height > 1;
}

/** Tab through the whole page once and report whether the wrapper ever had focus. */
async function tabbingReachesRegion(page: Page, region: Locator): Promise<boolean> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press("Tab");
    const onRegion = await region.evaluate((el) => el === document.activeElement);
    if (onRegion) return true;
    const onBody = await page.evaluate(() => document.activeElement === document.body);
    if (onBody && i > 0) return false;
  }
  return false;
}

for (const width of [360, 767]) {
  test.describe(`stacked Table at ${width} px (below md)`, () => {
    test("wrapper is not a keyboard stop and is not focusable", async ({ page }) => {
      const { region } = await openProducts(page, width);
      await expect(region).not.toHaveAttribute("tabindex", /.*/);
      expect(await tabbingReachesRegion(page, region)).toBe(false);
    });

    test("the page does not scroll sideways and the wrapper does not scroll", async ({ page }) => {
      const { region } = await openProducts(page, width);
      const page_ = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(page_.scroll).toBeLessThanOrEqual(page_.inner);
      const wrapper = await region.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(wrapper.scroll).toBeLessThanOrEqual(wrapper.client);
    });

    test("header row is hidden from sight but still named for assistive technology", async ({
      page,
    }) => {
      const { region, thead } = await openProducts(page, width);
      expect(await isPainted(thead)).toBe(false);
      await expect(region.getByRole("columnheader")).toHaveCount(4);
      await expect(region.getByRole("columnheader", { name: STATUS_LABEL })).toHaveCount(1);
    });

    test("header row appears while a button inside it has keyboard focus, and hides again", async ({
      page,
    }) => {
      const { thead } = await openProducts(page, width);
      expect(await isPainted(thead)).toBe(false);
      const button = await thead.evaluateHandle((el) => {
        const cell = el.querySelector("th");
        if (!cell) throw new Error("no header cell");
        const injected = document.createElement("button");
        injected.type = "button";
        injected.id = "e2e-injected-sort-button";
        injected.textContent = "sort";
        cell.append(injected);
        return injected;
      });
      await button.asElement()?.focus();
      await expect(page.locator("#e2e-injected-sort-button")).toBeFocused();
      expect(await isPainted(thead)).toBe(true);
      await expect(page.locator("#e2e-injected-sort-button")).toBeInViewport();
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      expect(await isPainted(thead)).toBe(false);
    });

    test("every cell shows its column name beside its value", async ({ page }) => {
      const { region } = await openProducts(page, width);
      const row = region.locator("tbody tr").first();
      const label = row.locator("td").first().getByText(STATUS_LABEL, { exact: true });
      await expect(label).toBeVisible();
      // The per-cell label is hidden from assistive technology (the column header names it).
      await expect(label).toHaveAttribute("aria-hidden", "true");
    });

    test("rows are cards: each row is its own block, one under another", async ({ page }) => {
      const { region } = await openProducts(page, width);
      const rows = region.locator("tbody tr");
      const first = await rows.nth(0).boundingBox();
      const second = await rows.nth(1).boundingBox();
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
      expect(first!.width).toBeGreaterThan(width * 0.8);
    });
  });
}

for (const width of [768, 1280]) {
  test.describe(`stacked Table at ${width} px (md and wider, normal table)`, () => {
    test("wrapper is a labelled, focusable region and Tab reaches it", async ({ page }) => {
      const { region } = await openProducts(page, width);
      await expect(region).toHaveAttribute("tabindex", "0");
      await expect(region).toHaveAttribute("aria-labelledby", /.+/);
      expect(await tabbingReachesRegion(page, region)).toBe(true);
    });

    test("header row is visible and per-cell labels are not shown", async ({ page }) => {
      const { region, thead } = await openProducts(page, width);
      expect(await isPainted(thead)).toBe(true);
      await expect(region.getByRole("columnheader", { name: STATUS_LABEL })).toBeVisible();
      const label = region
        .locator("tbody tr")
        .first()
        .locator("td")
        .first()
        .locator("span[aria-hidden='true']")
        .first();
      await expect(label).toBeHidden();
    });

    test("table lays out as columns: cells of a row share one line", async ({ page }) => {
      const { region } = await openProducts(page, width);
      const cells = region.locator("tbody tr").first().locator("th, td");
      const a = await cells.nth(0).boundingBox();
      const b = await cells.nth(1).boundingBox();
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
    });
  });
}

test("resizing across md adds and removes the wrapper's keyboard stop", async ({ page }) => {
  const { region } = await openProducts(page, 1280);
  await expect(region).toHaveAttribute("tabindex", "0");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(region).not.toHaveAttribute("tabindex", /.*/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(region).toHaveAttribute("tabindex", "0");
});
