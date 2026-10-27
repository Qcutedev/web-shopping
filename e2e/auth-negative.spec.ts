/**
 * Sign-up and sign-in negative paths through the real forms: empty and malformed input, wrong
 * credentials (one generic message for an unknown email and a wrong password), a duplicate email,
 * and a `next` parameter that points off site.
 *
 * Every submit that reaches the server takes a slot from support/sign-in-budget.ts, because the
 * sign-in endpoint allows 5 requests a minute per address.
 */
import { expect, test, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { ADMIN, uniqueEmail } from "./support/accounts";
import { E2E_ORIGIN } from "./support/constants";
import { takeSignIn } from "./support/sign-in-budget";

// A sign-in can wait up to a minute for a slot in the sign-in budget (support/sign-in-budget.ts).
test.describe.configure({ timeout: 180_000 });

const ACCOUNT_BUTTON = new RegExp(th.shell.header.account.buttonLabel.replace("{name}", ".+"));

/**
 * The forms are client components in a dev server that compiles on first use. A click before
 * hydration submits the form natively (a GET with the fields in the URL), so wait until React has
 * attached its props to the form. `networkidle` is no use: the dev server's reloads keep it busy.
 */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form !== null && Object.keys(form).some((key) => key.startsWith("__reactProps"));
  });
}

// The dev server compiles a route on first use and may reload the page once it has. Compile the
// form routes before any test clicks, so a reload cannot land between hydration and a submit.
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: E2E_ORIGIN });
  for (const path of ["/sign-in", "/sign-up"]) {
    // The reload the dev server does after compiling can abort the navigation that triggered it
    // (net::ERR_ABORTED); the route is compiled by then, so a second attempt succeeds. This is
    // the warm-up only: no test assertion is retried.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await page.goto(path, { timeout: 170_000 });
        break;
      } catch (error) {
        if (attempt >= 3 || !String(error).includes("ERR_ABORTED")) throw error;
      }
    }
    await hydrated(page);
  }
  await page.close();
});

async function fillSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel(th.auth.email).fill(email);
  await page.getByLabel(th.auth.password).fill(password);
}

function watchAuthRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/auth/")) requests.push(request.url());
  });
  return requests;
}

test("sign-in with empty fields shows field errors and sends no request", async ({ page }) => {
  const requests = watchAuthRequests(page);
  await page.goto("/sign-in");
  await hydrated(page);
  await page.getByRole("button", { name: th.auth.signInSubmit }).click();
  await expect(page.getByText(th.auth.fieldErrors.email.required)).toBeVisible();
  await expect(page.getByText(th.auth.fieldErrors.password.required)).toBeVisible();
  expect(requests).toEqual([]);
  await expect(page).toHaveURL(/\/sign-in/);
});

test("an unknown email and a wrong password get the same generic message", async ({ page }) => {
  await page.goto("/sign-in");
  await hydrated(page);

  await fillSignIn(page, uniqueEmail("nobody"), "some-Password-123");
  await takeSignIn();
  await page.getByRole("button", { name: th.auth.signInSubmit }).click();
  const alert = page.getByRole("alert").filter({ hasText: th.auth.invalidCredentials });
  await expect(alert).toBeVisible();

  await fillSignIn(page, ADMIN.email, "wrong-Password-123");
  await takeSignIn();
  await page.getByRole("button", { name: th.auth.signInSubmit }).click();
  await expect(alert).toBeVisible();

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: ACCOUNT_BUTTON })).toHaveCount(0);
  const session = await page.request.get("/api/v1/cart");
  expect(session.status()).toBe(401);
});

test("sign-up refuses a malformed email and a short password before any request", async ({
  page,
}) => {
  const requests = watchAuthRequests(page);
  await page.goto("/sign-up");
  await hydrated(page);
  await page.getByLabel(th.auth.name).fill("E2E Bad Input");
  await page.getByLabel(th.auth.email).fill("not-an-email");
  await page.getByLabel(th.auth.password).fill("short");
  await page.getByRole("button", { name: th.auth.signUpSubmit }).click();
  await expect(page.getByText(th.auth.fieldErrors.email.invalid)).toBeVisible();
  await expect(page.getByText(th.auth.fieldErrors.password.tooShort)).toBeVisible();
  expect(requests).toEqual([]);
  await expect(page).toHaveURL(/\/sign-up/);
});

test("sign-up with an email that already has an account is refused with a generic message", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await hydrated(page);
  await page.getByLabel(th.auth.name).fill("E2E Duplicate");
  await page.getByLabel(th.auth.email).fill(ADMIN.email);
  await page.getByLabel(th.auth.password).fill("e2e-Customer-pass-1234");
  await page.getByRole("button", { name: th.auth.signUpSubmit }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: th.auth.signUpNotCompleted }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-up/);
  await expect(page.getByRole("button", { name: ACCOUNT_BUTTON })).toHaveCount(0);
});

test("a sign-in `next` that points off site lands on this site", async ({ page }) => {
  await page.goto(`/sign-in?next=${encodeURIComponent("https://evil.example/phish")}`);
  await hydrated(page);
  await fillSignIn(page, ADMIN.email, ADMIN.password);
  await takeSignIn();
  await page.getByRole("button", { name: th.auth.signInSubmit }).click();
  await expect(page.getByRole("button", { name: ACCOUNT_BUTTON })).toBeVisible({
    timeout: 30_000,
  });
  expect(new URL(page.url()).origin).toBe(E2E_ORIGIN);
});
