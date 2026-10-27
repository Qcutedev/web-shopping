/**
 * Journey 2 (discovery), as far as the storefront has the controls: home, category page, search,
 * the price and category filter form, sort links, and the product page. Signed out, as a visitor.
 *
 * The data is the e2e seed: store one has three products in category one; store two has two
 * products in category two (tests/e2e-support/database.ts and seed-extra.ts). Pagination is in
 * pagination.spec.ts: five products never fill a page.
 */
import { expect, test, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { SEEDED } from "./support/accounts";

const CARD_TITLES = 'a[href^="/products/"] :is(h2, h3)';

async function titlesOnPage(page: Page): Promise<string[]> {
  const titles = await page.locator(CARD_TITLES).allInnerTexts();
  return titles.map((title) => title.trim());
}

test("home lists products of both stores and the categories", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: th.catalog.home.newestTitle })).toBeVisible();
  const titles = await titlesOnPage(page);
  expect(titles).toContain(SEEDED.productTwoA.title);
  expect(titles).toContain(SEEDED.productTwoB.title);
  expect(titles.some((title) => title.includes("สินค้าทดสอบชื่อยาวมาก"))).toBe(true);
  await expect(page.getByRole("link", { name: SEEDED.categoryTwo.name }).first()).toBeVisible();
});

test("a category page shows only the products of that category", async ({ page }) => {
  await page.goto(`/categories/${SEEDED.categoryTwo.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(SEEDED.categoryTwo.name);
  const titles = await titlesOnPage(page);
  expect([...titles].sort()).toEqual([SEEDED.productTwoA.title, SEEDED.productTwoB.title].sort());
});

test("search finds a product by title and says so when nothing matches", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("searchbox", { name: th.shell.header.search.label }).fill("กระเป๋า");
  await page.getByRole("button", { name: th.shell.header.search.submit }).first().click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("กระเป๋า");
  expect(await titlesOnPage(page)).toEqual([SEEDED.productTwoB.title]);

  await page.goto("/search?q=ไม่มีสินค้านี้แน่นอนxyz");
  await expect(page.getByText(th.catalog.search.emptyTitle)).toBeVisible();
  expect(await titlesOnPage(page)).toEqual([]);
});

test("the filter form narrows the list by category and price", async ({ page }) => {
  await page.goto("/search");
  expect((await titlesOnPage(page)).length).toBe(5);

  await page.getByLabel(th.catalog.filter.category).selectOption(SEEDED.categoryTwo.slug);
  await page.getByRole("button", { name: th.catalog.filter.apply }).click();
  await expect(page).toHaveURL(new RegExp(`category=${SEEDED.categoryTwo.slug}`));
  await expect.poll(async () => (await titlesOnPage(page)).length).toBe(2);

  // 500 baht keeps only the 999.00 baht bag.
  await page.getByLabel(th.catalog.filter.minPrice).fill("500");
  await page.getByRole("button", { name: th.catalog.filter.apply }).click();
  await expect.poll(async () => titlesOnPage(page)).toEqual([SEEDED.productTwoB.title]);

  await page.getByRole("link", { name: th.catalog.filter.reset }).click();
  await expect.poll(async () => (await titlesOnPage(page)).length).toBe(5);
});

test("sort links reorder the list by price and mark the current order", async ({ page }) => {
  await page.goto(`/categories/${SEEDED.categoryTwo.slug}`);
  const sortNav = page.getByRole("navigation", { name: th.catalog.sort.label });

  await sortNav.getByRole("link", { name: th.catalog.sort.price_asc }).click();
  await expect(page).toHaveURL(/sort=price_asc/);
  await expect(sortNav.getByRole("link", { name: th.catalog.sort.price_asc })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(await titlesOnPage(page)).toEqual([SEEDED.productTwoA.title, SEEDED.productTwoB.title]);

  await sortNav.getByRole("link", { name: th.catalog.sort.price_desc }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  expect(await titlesOnPage(page)).toEqual([SEEDED.productTwoB.title, SEEDED.productTwoA.title]);
});

test("the product page shows the server's price and links to its store", async ({ page }) => {
  await page.goto(`/products/${SEEDED.productTwoA.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEEDED.productTwoA.title);
  await expect(page.getByText("฿250.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "ร้านทดสอบ E2E สอง" })).toBeVisible();
});

test("an unknown product slug shows the not-found page", async ({ page }) => {
  // The HTTP status is not asserted: the page streams, so the server answers 200 before the
  // not-found boundary renders (reported as an observation in the T-060 report).
  await page.goto("/products/ไม่มีสินค้านี้");
  await expect(page.getByText(th.notFound.title)).toBeVisible();
});
