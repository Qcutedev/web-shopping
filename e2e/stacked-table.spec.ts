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
import { SELLER_STORAGE_STATE } from "./support/constants";

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

/**
 * Tab from the top of the page and report whether an element matching `selector` ever has focus
 * (CR-131, CR-132). Stops at the first element visited twice or when focus leaves the document
 * (the end of the Tab order). Throws when neither happens within the cap, so a page whose Tab
 * order was never fully walked cannot pass as "not reachable".
 *
 * Focus is followed into open shadow roots (CR-149): the Next dev overlay host (`nextjs-portal`)
 * has several Tab stops of its own while `document.activeElement` stays on the host, so the
 * innermost active element is the one tested and marked. A closed shadow root cannot be entered.
 *
 * One call per fresh `goto` (CR-150): the walk starts from wherever the browser's sequential
 * focus start point is, and `blur()` does not reset that point. A second call on the same page
 * would start after the last stop of the first, so its answer would not cover the whole page.
 */ async function tabbingReaches(page: Page, selector: string): Promise<boolean> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.querySelectorAll("[data-e2e-tab-seen]").forEach((el) => {
      el.removeAttribute("data-e2e-tab-seen");
    });
  });
  const MAX_TABS = 200;
  for (let i = 0; i < MAX_TABS; i += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate((sel) => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (active === null || active === document.body) return "left" as const;
      if (active.matches(sel)) return "found" as const;
      if (active.hasAttribute("data-e2e-tab-seen")) return "wrapped" as const;
      active.setAttribute("data-e2e-tab-seen", "");
      return "continue" as const;
    }, selector);
    if (state === "found") return true;
    // Focus on the body at the first press means the page has nothing focusable at all.
    if (state === "left" || state === "wrapped") {
      if (i === 0) throw new Error("Tab never moved focus into the page");
      return false;
    }
  }
  throw new Error(`Tab order not exhausted in ${MAX_TABS} presses`);
}
for (const width of [360, 767]) {
  test.describe(`stacked Table at ${width} px (below md)`, () => {
    test("wrapper is not a keyboard stop and is not focusable", async ({ page }) => {
      const { region } = await openProducts(page, width);
      await expect(region).not.toHaveAttribute("tabindex", /.*/);
      expect(await tabbingReaches(page, "[data-stacked]")).toBe(false);
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
      await expect.poll(() => isPainted(thead)).toBe(false);
      await expect(region.getByRole("columnheader")).toHaveCount(4);
      await expect(region.getByRole("columnheader", { name: STATUS_LABEL })).toHaveCount(1);
    });

    test("header row appears while a button inside it has keyboard focus, and hides again", async ({
      page,
    }) => {
      const { thead } = await openProducts(page, width);
      await expect.poll(() => isPainted(thead)).toBe(false);
      await thead.evaluate((el) => {
        const cell = el.querySelector("th");
        if (!cell) throw new Error("no header cell");
        const injected = document.createElement("button");
        injected.type = "button";
        injected.id = "e2e-injected-sort-button";
        injected.textContent = "sort";
        cell.append(injected);
      });
      // Reached with the keyboard, not with focus(): a Tab stop in a hidden header is the case.
      expect(await tabbingReaches(page, "#e2e-injected-sort-button")).toBe(true);
      await expect(page.locator("#e2e-injected-sort-button")).toBeFocused();
      await expect.poll(() => isPainted(thead)).toBe(true);
      await expect(page.locator("#e2e-injected-sort-button")).toBeInViewport();
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await expect.poll(() => isPainted(thead)).toBe(false);
    });

    test("every cell shows its column name beside its value", async ({ page }) => {
      const { region } = await openProducts(page, width);
      const status = region
        .locator("tbody tr")
        .first()
        .locator("td")
        .first()
        .getByText(STATUS_LABEL, { exact: true });
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute("aria-hidden", "true");
      // Every data cell of every row has exactly one label, visible, naming one of the columns.
      const columns = await region.getByRole("columnheader").allInnerTexts();
      const cells = region.locator("tbody td");
      const cellCount = await cells.count();
      expect(cellCount).toBeGreaterThan(0);
      for (let i = 0; i < cellCount; i += 1) {
        const cell = cells.nth(i);
        const label = cell.locator(":scope > span[aria-hidden='true']");
        await expect(label).toHaveCount(1);
        await expect(label).toBeVisible();
        const text = (await label.innerText()).trim();
        expect(columns.map((column) => column.trim())).toContain(text);
      }
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
      expect(await tabbingReaches(page, "[data-stacked]")).toBe(true);
    });

    test("header row is visible and per-cell labels are not shown", async ({ page }) => {
      const { region, thead } = await openProducts(page, width);
      await expect.poll(() => isPainted(thead)).toBe(true);
      await expect(region.getByRole("columnheader", { name: STATUS_LABEL })).toBeVisible();
      // Every data cell has its label in the DOM (count first: toBeHidden() also passes for no
      // match) and none is shown from md.
      const labels = region.locator("tbody td > span[aria-hidden='true']");
      const cellCount = await region.locator("tbody td").count();
      expect(cellCount).toBeGreaterThan(0);
      await expect(labels).toHaveCount(cellCount);
      for (const label of await labels.all()) {
        await expect(label).toBeHidden();
      }
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
