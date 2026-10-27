/**
 * Helpers for specs that act as several people at once. Each person gets a browser context of
 * their own, so cookies never mix.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { uniqueEmail } from "./accounts";
import { E2E_ORIGIN } from "./constants";
import { takeSignIn } from "./sign-in-budget";

/** Header the API requires on every mutation (API_CONTRACTS 1.1). */
export const ORIGIN_HEADERS = { Origin: E2E_ORIGIN } as const;

export interface Person {
  context: BrowserContext;
  page: Page;
  name: string;
  email: string;
}

/** Opens a context with the saved session of an account made by global-setup. */
export async function openAs(browser: Browser, storageState: string): Promise<Person> {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState });
  return { context, page: await context.newPage(), name: "", email: "" };
}

/**
 * Registers a new customer through the real /sign-up page, signs out through the header account
 * menu, and signs in again through the real /sign-in page. The session cookie lands in the
 * context, so the pages then run as that customer. A failed step throws with the page's alert
 * text, so a broken form is reported as such.
 */
export async function registerCustomer(browser: Browser, prefix: string): Promise<Person> {
  const name = `E2E ${prefix}`;
  const email = uniqueEmail(prefix);
  const password = "e2e-Customer-pass-1234";
  // The accessible name is matched exactly: the name is plain text, never a pattern.
  const ACCOUNT_BUTTON = th.shell.header.account.buttonLabel.replace("{name}", name);
  const context = await browser.newContext({ baseURL: E2E_ORIGIN });
  const page = await context.newPage();

  await page.goto("/sign-up");
  await page.getByLabel(th.auth.name).fill(name);
  await page.getByLabel(th.auth.email).fill(email);
  await page.getByLabel(th.auth.password).fill(password);
  await page.getByRole("button", { name: th.auth.signUpSubmit }).click();
  await expect(page.getByRole("button", { name: ACCOUNT_BUTTON })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: ACCOUNT_BUTTON }).click();
  await page.getByRole("button", { name: th.shell.header.account.signOut }).click();
  await expect(page.getByRole("link", { name: th.shell.header.signIn }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: ACCOUNT_BUTTON })).toHaveCount(0);

  await page.goto("/sign-in");
  await page.getByLabel(th.auth.email).fill(email);
  await page.getByLabel(th.auth.password).fill(password);
  await takeSignIn();
  await page.getByRole("button", { name: th.auth.signInSubmit }).click();
  await expect(page.getByRole("button", { name: ACCOUNT_BUTTON })).toBeVisible({ timeout: 30_000 });
  return { context, page, name, email };
}

/** Adds a product to the cart through the product page's add-to-cart control. */
export async function addToCartOnPage(page: Page, slug: string, quantity = 1): Promise<void> {
  await page.goto(`/products/${slug}`);
  for (let step = 1; step < quantity; step += 1) {
    await page.getByRole("button", { name: th.cart.increase }).click();
  }
  await expect(page.getByRole("spinbutton", { name: th.cart.add.quantity })).toHaveValue(
    String(quantity),
  );
  await page.getByRole("button", { name: th.cart.add.submit }).click();
  await expect(page.getByText(th.cart.add.success)).toBeVisible();
}
