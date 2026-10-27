import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  unstable_rethrow: () => undefined,
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const getActor = vi.fn();
vi.mock("@/server/auth/session", () => ({ getActor: (...args: unknown[]) => getActor(...args) }));
const getProfile = vi.fn();
vi.mock("@/modules/profile", () => ({ getProfile: (...args: unknown[]) => getProfile(...args) }));
const getCart = vi.fn();
vi.mock("@/modules/cart", () => ({ getCart: (...args: unknown[]) => getCart(...args) }));

import { HeaderSession } from "./header-session";

const actor = { userId: "u1", role: "CUSTOMER", storeId: null, storeStatus: null };
const cartOf = (...counts: number[]) => ({
  stores: counts.map((n) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `l${i}` })) })),
});

async function renderSession() {
  return render(await HeaderSession());
}

beforeEach(() => {
  getActor.mockReset();
  getProfile.mockReset();
  getCart.mockReset();
});

describe("HeaderSession", () => {
  it("shows sign-up and sign-in and no count for a visitor, and reads nothing else", async () => {
    getActor.mockResolvedValue(null);
    await renderSession();
    expect(screen.getByRole("link", { name: th.shell.header.signUp }).getAttribute("href")).toBe(
      ROUTES.signUp,
    );
    expect(screen.getByRole("link", { name: th.shell.header.signIn }).getAttribute("href")).toBe(
      ROUTES.signIn,
    );
    expect(screen.getByRole("link", { name: th.shell.header.cart.label })).toBeTruthy();
    expect(getProfile).not.toHaveBeenCalled();
    expect(getCart).not.toHaveBeenCalled();
  });

  it("shows the menu and the real line count for a signed-in user, read for the session actor", async () => {
    getActor.mockResolvedValue(actor);
    getProfile.mockResolvedValue({ name: "สมชาย" });
    getCart.mockResolvedValue(cartOf(2, 1));
    await renderSession();
    expect(getProfile).toHaveBeenCalledWith(actor);
    expect(getCart).toHaveBeenCalledWith(actor);
    expect(screen.getByRole("button", { name: /สมชาย/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ตะกร้าสินค้า 3 รายการ" }).textContent).toBe("3");
    expect(screen.queryByRole("link", { name: th.shell.header.signIn })).toBeNull();
    expect(screen.queryByRole("link", { name: th.shell.header.signUp })).toBeNull();
  });

  it("hides the badge for an empty cart", async () => {
    getActor.mockResolvedValue(actor);
    getProfile.mockResolvedValue({ name: "สมชาย" });
    getCart.mockResolvedValue({ stores: [] });
    await renderSession();
    expect(screen.getByRole("link", { name: th.shell.header.cart.label }).textContent).toBe("");
  });

  it("degrades to the fallback name and no badge when the reads fail", async () => {
    getActor.mockResolvedValue(actor);
    getProfile.mockRejectedValue(new Error("db"));
    getCart.mockRejectedValue(new Error("db"));
    await renderSession();
    expect(screen.getByRole("button", { name: th.shell.header.account.fallbackName })).toBeTruthy();
    expect(screen.getByRole("link", { name: th.shell.header.cart.label }).textContent).toBe("");
  });

  it("falls back to the visitor links when the session cannot be read", async () => {
    getActor.mockRejectedValue(new Error("db"));
    await renderSession();
    expect(screen.getByRole("link", { name: th.shell.header.signIn })).toBeTruthy();
  });
});
