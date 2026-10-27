/**
 * Session 116 security review of commit 2bd6ded (header session, account menu, cart count).
 * Owner: security. Review: docs/reviews/S116-security.md. No finding; these cases pin what holds.
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

import { AccountMenu } from "@/components/shell/account-menu";
import { HeaderSession } from "@/components/shell/header-session";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const HOSTILE = '<img src=x onerror="alert(1)">';

beforeEach(() => {
  getActor.mockReset();
  getProfile.mockReset();
  countCartLines.mockReset();
});

function childrenOf(node: unknown): ReactElement[] {
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: unknown };
  const list = Array.isArray(props.children) ? props.children : [props.children];
  return list.filter(isValidElement) as ReactElement[];
}

describe("S116 2bd6ded: only the name and a number cross to the client", () => {
  it("HeaderSession hands AccountMenu { name } and CartLink { count } only, never the profile", async () => {
    getActor.mockResolvedValue({ userId: "u1", role: "ADMIN", storeId: null, storeStatus: null });
    getProfile.mockResolvedValue({
      name: "Admin",
      email: "admin@example.test",
      phone: "0812345678",
      role: "ADMIN",
      store: null,
    });
    countCartLines.mockResolvedValue(2);
    const tree = await HeaderSession();
    const [menu, cart] = childrenOf(tree);
    expect(menu?.type).toBe(AccountMenu);
    expect(Object.keys(menu?.props as object)).toEqual(["name"]);
    expect(Object.keys(cart?.props as object)).toEqual(["count"]);
    expect(JSON.stringify(menu?.props)).not.toContain("admin@example.test");
  });

  it("services are called with the session's actor and nothing from the request", async () => {
    const actor = { userId: "u2", role: "CUSTOMER", storeId: null, storeStatus: null };
    getActor.mockResolvedValue(actor);
    getProfile.mockResolvedValue({ name: "x" });
    countCartLines.mockResolvedValue(0);
    await HeaderSession();
    expect(getProfile.mock.calls).toEqual([[actor]]);
    expect(countCartLines.mock.calls).toEqual([[actor]]);
  });
});

describe("S116 2bd6ded: AccountMenu rendering", () => {
  it("a hostile display name is text inside <bdi>, never markup", () => {
    const html = renderToStaticMarkup(createElement(AccountMenu, { name: HOSTILE }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).toMatch(/<bdi>&lt;img/);
  });

  it("offers no admin or seller link, whatever the name", () => {
    const html = renderToStaticMarkup(createElement(AccountMenu, { name: "Admin" }));
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/account", "/orders"]);
  });

  it("imports nothing server-side (client bundle) and signs out through the API client", () => {
    const source = read("src/components/shell/account-menu.tsx");
    expect(source.startsWith('"use client";')).toBe(true);
    expect(source).not.toMatch(/from "@\/(server|modules)\//);
    expect(source).not.toMatch(/from "@\/(server|modules)"/);
    expect(source).toMatch(/import \{ signOut \} from "@\/lib\/api-client\/auth";/);
  });

  it("header-session.tsx is a Server Component (no 'use client') so its imports stay on the server", () => {
    const source = read("src/components/shell/header-session.tsx");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(read("src/components/shell/storefront-shell.tsx")).not.toMatch(/["']use client["']/);
  });
});
