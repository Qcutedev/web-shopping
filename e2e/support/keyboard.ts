/**
 * Helpers for keyboard-only specs (REQ-N-03). They move focus with real key presses and fail when
 * the target is never reached, when focus is trapped, or when the focused control shows no ring.
 *
 * `pointerCount` counts the pointer events the page saw, so a spec can prove that no mouse was used.
 */
import { expect, type Locator, type Page } from "@playwright/test";

const MAX_PRESSES = 80;

/**
 * Counts `pointerdown`, `mousedown` and `touchstart` in the page and keeps the count in
 * sessionStorage, so it survives navigation. A key press never fires these events; a click by
 * Playwright's mouse does. Install after any setup that uses the pointer.
 */
export async function countPointerEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const bump = (): void => {
      const now = Number(sessionStorage.getItem("e2e-pointer-events") ?? "0");
      sessionStorage.setItem("e2e-pointer-events", String(now + 1));
    };
    for (const name of ["pointerdown", "mousedown", "touchstart"]) {
      window.addEventListener(name, bump, true);
    }
  });
}

/** Pointer events seen on the current page since `countPointerEvents` was installed. */
export async function pointerCount(page: Page): Promise<number> {
  return page.evaluate(() => Number(sessionStorage.getItem("e2e-pointer-events") ?? "0"));
}

/**
 * The focused control has a keyboard focus ring: it matches `:focus-visible` and has a solid
 * outline of at least 2 px in a colour that is not transparent (the design system's `focus-ring`).
 */
export async function expectFocusVisible(target: Locator): Promise<void> {
  const state = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      focused: el === document.activeElement,
      visible: el.matches(":focus-visible"),
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      color: style.outlineColor,
    };
  });
  expect(state.focused, "target has focus").toBe(true);
  expect(state.visible, "target matches :focus-visible").toBe(true);
  expect(state.style, "outline style").not.toBe("none");
  expect(state.width, "outline width in px").toBeGreaterThanOrEqual(2);
  expect(state.color, "outline colour").not.toMatch(/rgba\(.*,\s*0\)$|transparent/);
}

/**
 * Presses `key` until `target` has focus, then checks that it shows a focus ring. Focus may leave
 * the page once (the end of the Tab order) and come back in at the other end. Throws when it
 * leaves twice, comes back to an element it already visited before the target (a loop or a
 * trap), or after MAX_PRESSES. Follows focus into open shadow roots (the Next dev overlay has Tab
 * stops of its own). One call walks from the current focus position, not from the page start.
 * Returns the number of stops passed on the way.
 */
export async function pressUntilFocused(
  page: Page,
  target: Locator,
  key: "Tab" | "Shift+Tab" = "Tab",
): Promise<number> {
  await page.evaluate(() => {
    document.querySelectorAll("[data-e2e-key-seen]").forEach((el) => {
      el.removeAttribute("data-e2e-key-seen");
    });
  });
  let wraps = 0;
  for (let press = 1; press <= MAX_PRESSES; press += 1) {
    await page.keyboard.press(key);
    const found = await target.evaluate((el) => el === document.activeElement);
    if (found) {
      await expectFocusVisible(target);
      return press;
    }
    const state = await page.evaluate(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (active === null || active === document.body) return "left" as const;
      if (active.hasAttribute("data-e2e-key-seen")) return "looped" as const;
      active.setAttribute("data-e2e-key-seen", "");
      return "moved" as const;
    });
    if (state === "left") {
      // After a client-side navigation the browser continues from the old position of the removed
      // link, so the walk may pass the end of the page once and come back in at the start (the
      // way a person would). A second pass means the target is not in the Tab order.
      wraps += 1;
      if (wraps > 1) throw new Error(`${key} passed the end of the page twice without the target`);
    }
    if (state === "looped") throw new Error(`${key} looped on an element before the target (trap)`);
  }
  throw new Error(`${key} did not reach the target in ${MAX_PRESSES} presses`);
}

/** The identity of the focused element, shadow roots followed, as a short description. */
async function focusedIdentity(page: Page): Promise<string> {
  return page.evaluate(() => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active === null || active === document.body) return "body";
    const marker = "data-e2e-identity";
    if (!active.hasAttribute(marker)) {
      active.setAttribute(marker, String(Math.random()));
    }
    return active.getAttribute(marker) ?? "body";
  });
}

/**
 * Focus is not trapped at the current stop: Tab moves it elsewhere and Shift+Tab moves it back
 * elsewhere again. Leaves focus where it started.
 */
export async function expectNotTrapped(page: Page): Promise<void> {
  const here = await focusedIdentity(page);
  await page.keyboard.press("Tab");
  const next = await focusedIdentity(page);
  expect(next, "Tab moved focus").not.toBe(here);
  await page.keyboard.press("Shift+Tab");
  const back = await focusedIdentity(page);
  expect(back, "Shift+Tab returned focus to the starting stop").toBe(here);
}
