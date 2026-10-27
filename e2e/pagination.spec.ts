/**
 * Journey 2, the "paginate" step. The storefront page size is 20 and is not settable from the URL,
 * so the five seeded products never fill a page. This spec adds a store with 45 products in a
 * category of its own (tests/e2e-support/seed-pagination.ts) before its tests and removes them
 * after, so browse.spec.ts and the others, which count the five seeded products, are not affected
 * (workers is 1, so the specs never overlap).
 *
 * 45 products at 20 per page: page 1 has 20, page 2 has 20, page 3 has 5.
 */
import { expect, test, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { PAGING, SEEDED } from "./support/accounts";
import { runE2eScript } from "./support/child-steps";

test.describe.configure({ mode: "serial" });

const CARD_TITLES = 'a[href^="/products/"] :is(h2, h3)';
const CATEGORY = `/categories/${PAGING.categorySlug}`;
const pagerName = th.pagination.label;
// The first visit of a page compiles it in the dev server, so the first wait is long.
const FIRST_LOAD = { timeout: 30_000 };
const pageLabel = (n: number) => th.pagination.page.replace("{page}", String(n));

test.beforeAll(() => {
  runE2eScript("pagination seed remove (stale)", "seed-pagination.ts", ["remove"]);
  runE2eScript("pagination seed add", "seed-pagination.ts", ["add"]);
});

test.afterAll(() => {
  runE2eScript("pagination seed remove", "seed-pagination.ts", ["remove"]);
});

async function titlesOnPage(page: Page): Promise<string[]> {
  const titles = await page.locator(CARD_TITLES).allInnerTexts();
  return titles.map((title) => title.trim());
}

function numbered(from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n += 1) out.push(PAGING.title(n));
  return out;
}

async function expectNoSideScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
}

test("a category of 45 products is cut into pages of 20, 20 and 5 and the pager walks them", async ({
  page,
}) => {
  await page.goto(`${CATEGORY}?sort=price_asc`);
  const pager = page.getByRole("navigation", { name: pagerName });
  await expect(pager).toBeVisible(FIRST_LOAD);
  await expect(page.getByText(th.catalog.search.count.replace("{total}", "45"))).toBeVisible();

  // Page 1: products 1 to 20, current page marked, no previous page.
  expect(await titlesOnPage(page)).toEqual(numbered(1, 20));
  await expect(pager.getByRole("link", { name: pageLabel(1) })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(pager.locator('[aria-disabled="true"]')).toHaveCount(1);
  await expect(pager.locator('[aria-disabled="true"]')).toHaveAttribute(
    "aria-label",
    th.pagination.previous,
  );

  // Next: page 2, products 21 to 40, the sort is kept in the address and on the sort link.
  await pager.getByRole("link", { name: th.pagination.next }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/sort=price_asc/);
  await expect.poll(() => titlesOnPage(page)).toEqual(numbered(21, 40));
  await expect(pager.getByRole("link", { name: pageLabel(2) })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(pager.getByRole("link", { name: pageLabel(1) })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page
      .getByRole("navigation", { name: th.catalog.sort.label })
      .getByRole("link", { name: th.catalog.sort.price_asc }),
  ).toHaveAttribute("aria-current", "true");

  // A numbered link to the last page: 5 products, no next page.
  await pager.getByRole("link", { name: pageLabel(3) }).click();
  await expect(page).toHaveURL(/page=3/);
  await expect.poll(() => titlesOnPage(page)).toEqual(numbered(41, 45));
  await expect(pager.locator('[aria-disabled="true"]')).toHaveAttribute(
    "aria-label",
    th.pagination.next,
  );

  // Previous goes back to page 2 with its own 20 products.
  await pager.getByRole("link", { name: th.pagination.previous }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect.poll(() => titlesOnPage(page)).toEqual(numbered(21, 40));

  // Back to the first page: the link has the plain address of the sort, with no page parameter.
  await pager.getByRole("link", { name: pageLabel(1) }).click();
  await expect.poll(() => titlesOnPage(page)).toEqual(numbered(1, 20));
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
});

test("pages never repeat or lose a product: the three pages together hold all 45 once", async ({
  page,
}) => {
  const seen: string[] = [];
  for (const n of [1, 2, 3]) {
    await page.goto(`${CATEGORY}?sort=price_desc${n > 1 ? `&page=${n}` : ""}`);
    await expect(page.getByRole("navigation", { name: pagerName })).toBeVisible(FIRST_LOAD);
    seen.push(...(await titlesOnPage(page)));
  }
  expect(seen).toHaveLength(45);
  expect(new Set(seen).size).toBe(45);
  expect(seen).toEqual(numbered(1, 45).reverse());
});

test("search results are paged too and keep the search text from page to page", async ({
  page,
}) => {
  await page.goto("/search?q=สินค้าแบ่งหน้า");
  await expect(page.getByText(th.catalog.search.count.replace("{total}", "45"))).toBeVisible(
    FIRST_LOAD,
  );
  expect(await titlesOnPage(page)).toHaveLength(20);
  const pager = page.getByRole("navigation", { name: pagerName });
  await pager.getByRole("link", { name: th.pagination.next }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(new URL(page.url()).searchParams.get("q")).toBe("สินค้าแบ่งหน้า");
  await expect.poll(async () => (await titlesOnPage(page)).length).toBe(20);
  await pager.getByRole("link", { name: pageLabel(3) }).click();
  await expect.poll(async () => (await titlesOnPage(page)).length).toBe(5);
  // The count line is about the whole result, not the page.
  await expect(page.getByText(th.catalog.search.count.replace("{total}", "45"))).toBeVisible();
});

test("a page past the last one says so and links back to page 1", async ({ page }) => {
  await page.goto(`${CATEGORY}?page=9`);
  await expect(page.getByText(th.catalog.list.pageEmptyTitle)).toBeVisible(FIRST_LOAD);
  expect(await titlesOnPage(page)).toEqual([]);
  await page.getByRole("link", { name: th.catalog.list.pageEmptyAction }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("page")).toBe(false);
  await expect.poll(async () => (await titlesOnPage(page)).length).toBe(20);
});

test("a list that fits one page shows no pager", async ({ page }) => {
  // Other specs add products to the seeded categories, so a search that finds one product is used.
  await page.goto("/search?q=กระเป๋า");
  await expect.poll(() => titlesOnPage(page)).toEqual([SEEDED.productTwoB.title]);
  await expect(page.getByRole("navigation", { name: pagerName })).toHaveCount(0);
});

for (const width of [360, 768]) {
  test(`the pager fits and works at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${CATEGORY}?sort=price_asc`);
    const pager = page.getByRole("navigation", { name: pagerName });
    await expect(pager).toBeVisible(FIRST_LOAD);
    await expectNoSideScroll(page);

    // Every visible control of the pager is at least 44 px square (reachable without zooming).
    const next = pager.getByRole("link", { name: th.pagination.next });
    await next.scrollIntoViewIfNeeded();
    const box = await next.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const bounds = await pager.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);

    await next.click();
    await expect(page).toHaveURL(/page=2/);
    await expect.poll(() => titlesOnPage(page)).toEqual(numbered(21, 40));
    await expectNoSideScroll(page);
  });
}
