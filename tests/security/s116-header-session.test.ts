/**
 * Session 116 security review of commit 2bd6ded (header session, account menu, cart count).
 * Owner: security. Review: docs/reviews/S116-security.md. No finding; these cases pin what holds.
 * Updated 2026-10-31 for the session 138 design accepted by the owner: the account menu also gets
 * `isAdmin`, `isSeller`, and the badge counts (docs/SECURITY.md, "Scans and reviews performed").
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 * Pure: no database, no network. Rendered with react-dom/server in Node.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  unstable_rethrow: () => undefined,
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const getActor = vi.fn();
vi.mock("@/server/auth/session", () => ({ getActor: (...args: unknown[]) => getActor(...args) }));
const getProfile = vi.fn();
vi.mock("@/modules/profile", () => ({ getProfile: (...args: unknown[]) => getProfile(...args) }));
// Since 21c9c33 (CR-S116-02) the header calls countCartLines (one COUNT), not getCart.
const countCartLines = vi.fn();
vi.mock("@/modules/cart", () => ({
  countCartLines: (...args: unknown[]) => countCartLines(...args),
}));
// Since session 138 (owner decision 2026-10-31) the header also reads the badge counts.
const getNavCounts = vi.fn();
vi.mock("@/modules/notifications", () => ({
  getNavCounts: (...args: unknown[]) => getNavCounts(...args),
}));

import { AccountMenu } from "@/components/shell/account-menu";
import { HeaderSession } from "@/components/shell/header-session";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const HOSTILE = '<img src=x onerror="alert(1)">';

beforeEach(() => {
  getActor.mockReset();
  getProfile.mockReset();
  countCartLines.mockReset();
  getNavCounts.mockReset();
});

/** The four badge counts, the only numbers besides the cart count that cross to the client. */
const NAV_COUNT_KEYS = ["ordersOnTheWay", "sellerToShip", "pendingApplications", "pendingProducts"];
const COUNTS = { ordersOnTheWay: 1, sellerToShip: 0, pendingApplications: 3, pendingProducts: 4 };

function childrenOf(node: unknown): ReactElement[] {
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: unknown };
  const list = Array.isArray(props.children) ? props.children : [props.children];
  return list.filter(isValidElement) as ReactElement[];
}

// Contract accepted by the owner on 2026-10-31 (session 138 design): AccountMenu receives
// { name, isAdmin, isSeller, counts } and CartLink { count }. Booleans and counts only; no id,
// email, phone, role string, store id, or token. Any extra key fails here.
describe("S116 2bd6ded, S138: only the name, two booleans, and counts cross to the client", () => {
  it("HeaderSession hands AccountMenu { name, isAdmin, isSeller, counts } and CartLink { count } only", async () => {
    getActor.mockResolvedValue({ userId: "u1", role: "ADMIN", storeId: null, storeStatus: null });
    getProfile.mockResolvedValue({
      name: "Admin",
      email: "admin@example.test",
      phone: "0812345678",
      role: "ADMIN",
      store: null,
    });
    countCartLines.mockResolvedValue(2);
    getNavCounts.mockResolvedValue(COUNTS);
    const tree = await HeaderSession();
    const [menu, cart] = childrenOf(tree);
    expect(menu?.type).toBe(AccountMenu);
    expect(Object.keys(menu?.props as object)).toEqual(["name", "isAdmin", "isSeller", "counts"]);
    expect(menu?.props).toEqual({ name: "Admin", isAdmin: true, isSeller: false, counts: COUNTS });
    expect(Object.keys((menu?.props as { counts: object }).counts)).toEqual(NAV_COUNT_KEYS);
    expect(Object.keys(cart?.props as object)).toEqual(["count"]);
    const text = JSON.stringify([menu?.props, cart?.props]);
    for (const leak of ["admin@example.test", "0812345678", "u1", "ADMIN"]) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it("services are called with the session's actor and nothing from the request", async () => {
    const actor = { userId: "u2", role: "CUSTOMER", storeId: null, storeStatus: null };
    getActor.mockResolvedValue(actor);
    getProfile.mockResolvedValue({ name: "x" });
    countCartLines.mockResolvedValue(0);
    getNavCounts.mockResolvedValue({ ...COUNTS, pendingApplications: 0, pendingProducts: 0 });
    await HeaderSession();
    expect(getProfile.mock.calls).toEqual([[actor]]);
    expect(countCartLines.mock.calls).toEqual([[actor]]);
    expect(getNavCounts.mock.calls).toEqual([[actor]]);
  });

  it("a failed count read shows no badge (all zero) and does not block the menu", async () => {
    getActor.mockResolvedValue({ userId: "u3", role: "SELLER", storeId: "s3", storeStatus: null });
    getProfile.mockResolvedValue({ name: "Seller" });
    countCartLines.mockResolvedValue(0);
    getNavCounts.mockRejectedValue(new Error("db down: SELECT ... s3"));
    const [menu] = childrenOf(await HeaderSession());
    expect(menu?.props).toEqual({
      name: "Seller",
      isAdmin: false,
      isSeller: true,
      counts: { ordersOnTheWay: 0, sellerToShip: 0, pendingApplications: 0, pendingProducts: 0 },
    });
  });
});

describe("S116 2bd6ded: AccountMenu rendering", () => {
  it("a hostile display name is text inside <bdi>, never markup", () => {
    const html = renderToStaticMarkup(createElement(AccountMenu, { name: HOSTILE }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).toMatch(/<bdi>&lt;img/);
  });

  it("offers no admin or seller link, whatever the name or the counts, unless the server says so", () => {
    const html = renderToStaticMarkup(
      createElement(AccountMenu, {
        name: "Admin",
        counts: { ordersOnTheWay: 0, sellerToShip: 5, pendingApplications: 6, pendingProducts: 7 },
      }),
    );
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/account", "/orders"]);
    // Seller and admin counts are not shown to a menu without the matching flag.
    expect(html).not.toContain("data-notify-badge");
  });

  it("the seller link needs isSeller, the admin link needs isAdmin; nothing else is added", () => {
    const hrefsOf = (props: { isAdmin?: boolean; isSeller?: boolean }) =>
      [
        ...renderToStaticMarkup(createElement(AccountMenu, { name: "x", ...props })).matchAll(
          /href="([^"]*)"/g,
        ),
      ].map((match) => match[1]);
    expect(hrefsOf({ isSeller: true })).toEqual(["/account", "/orders", "/seller"]);
    expect(hrefsOf({ isAdmin: true })).toEqual(["/account", "/orders", "/admin"]);
  });

  it("imports nothing server-side at run time (client bundle) and signs out through the API client", () => {
    const source = read("src/components/shell/account-menu.tsx");
    expect(source.startsWith('"use client";')).toBe(true);
    // Exactly one import names a module: a type-only import, erased at compile time, so no module
    // code reaches the client bundle. Any value import from src/server or src/modules fails.
    const serverImports = source
      .split(/\r?\n/)
      .filter((line) => /from "@\/(server|modules)(\/|")/.test(line));
    expect(serverImports).toEqual(['import type { NavCounts } from "@/modules/notifications";']);
    expect(source).toMatch(/import \{ signOut \} from "@\/lib\/api-client\/auth";/);
  });

  it("header-session.tsx is a Server Component (no 'use client') so its imports stay on the server", () => {
    const source = read("src/components/shell/header-session.tsx");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(read("src/components/shell/storefront-shell.tsx")).not.toMatch(/["']use client["']/);
  });
});
