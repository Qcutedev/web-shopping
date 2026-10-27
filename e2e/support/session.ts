/**
 * Helpers for specs that act as several people at once. Each person gets a browser context of
 * their own, so cookies never mix.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { uniqueEmail } from "./accounts";
import { E2E_ORIGIN } from "./constants";

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
 * Registers a new customer through the real sign-up endpoint and signs in. There is no sign-up
 * or sign-in page yet (docs/STATUS.md), so the endpoints are the only way in; the cookie lands in
 * the context and the pages then run as that customer.
 */
export async function registerCustomer(browser: Browser, prefix: string): Promise<Person> {
  const name = `E2E ${prefix}`;
  const email = uniqueEmail(prefix);
  const password = "e2e-Customer-pass-1234";
  const context = await browser.newContext({ baseURL: E2E_ORIGIN });
  const signUp = await context.request.post("/api/v1/auth/sign-up", {
    headers: ORIGIN_HEADERS,
    data: { name, email, password },
  });
  if (!signUp.ok()) throw new Error(`sign-up answered ${signUp.status()}`);
  const signIn = await context.request.post("/api/v1/auth/sign-in", {
    headers: ORIGIN_HEADERS,
    data: { email, password },
  });
  if (!signIn.ok()) throw new Error(`sign-in answered ${signIn.status()}`);
  return { context, page: await context.newPage(), name, email };
}
