import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { unauthenticated } from "@/server/errors";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super("redirect");
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const getActor = vi.fn();
vi.mock("@/server/auth/session", () => ({ getActor: (...args: unknown[]) => getActor(...args) }));

const getProfile = vi.fn();
const listAddresses = vi.fn();
vi.mock("@/modules/profile", async () => {
  // The real schema module is pure (zod only); the service is replaced so no database is reached.
  const schema = await import("@/modules/profile/schema");
  return {
    ...schema,
    getProfile: (...args: unknown[]) => getProfile(...args),
    listAddresses: (...args: unknown[]) => listAddresses(...args),
  };
});

import { AddressesSection, pageQueryFrom } from "./addresses-section";
import { ProfileSection } from "./profile-section";

const actor = { userId: "u1", role: "CUSTOMER", storeId: null, storeStatus: null };

beforeEach(() => {
  getActor.mockReset();
  getProfile.mockReset();
  listAddresses.mockReset();
});

describe("ProfileSection", () => {
  it("redirects a visitor without a session to sign-in, returning to the account page", async () => {
    getActor.mockResolvedValue(null);
    await expect(ProfileSection()).rejects.toMatchObject({ url: "/sign-in?next=%2Faccount" });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("reads the profile of the session's actor and renders it", async () => {
    getActor.mockResolvedValue(actor);
    getProfile.mockResolvedValue({
      id: "u1",
      name: "สมชาย",
      email: "s@example.com",
      phone: "0812345678",
      role: "CUSTOMER",
      store: null,
      sellerApplication: null,
    });
    render(await ProfileSection());
    expect(getProfile).toHaveBeenCalledWith(actor);
    expect(screen.getByText("สมชาย")).toBeTruthy();
    expect(screen.getByText("0812345678")).toBeTruthy();
  });

  it("shows the error state with a retry link when the profile cannot be loaded", async () => {
    getActor.mockResolvedValue(actor);
    getProfile.mockRejectedValue(new Error("db down"));
    render(await ProfileSection());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/account",
    );
  });

  it("redirects when the profile read says the user is no longer active", async () => {
    getActor.mockResolvedValue(actor);
    getProfile.mockRejectedValue(unauthenticated());
    await expect(ProfileSection()).rejects.toMatchObject({ url: "/sign-in?next=%2Faccount" });
  });

  it("shows the error state when the session cannot be read", async () => {
    getActor.mockRejectedValue(new Error("db down"));
    render(await ProfileSection());
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
  });
});

describe("AddressesSection", () => {
  const row = {
    id: "a1",
    recipientName: "สมชาย",
    phone: "0812345678",
    line1: "1",
    subdistrict: "ก",
    district: "ข",
    province: "ค",
    postalCode: "10110",
    isDefault: true,
  };

  it("redirects a visitor without a session, returning to the address page", async () => {
    getActor.mockResolvedValue(null);
    await expect(AddressesSection({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      url: "/sign-in?next=%2Faccount%2Faddresses",
    });
  });

  it("lists with the page from the address bar, scoped to the session's actor", async () => {
    getActor.mockResolvedValue(actor);
    listAddresses.mockResolvedValue({ items: [row], page: 2, pageSize: 20, total: 21 });
    render(await AddressesSection({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(listAddresses).toHaveBeenCalledWith(actor, { page: 2, pageSize: 20 });
    expect(screen.getByText(th.account.addresses.defaultBadge)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: th.pagination.label })).toBeTruthy();
  });

  it("falls back to page 1 for an invalid query", () => {
    expect(pageQueryFrom({ page: "0" })).toEqual({ page: 1, pageSize: 20 });
    expect(pageQueryFrom({ page: ["1", "2"] })).toEqual({ page: 1, pageSize: 20 });
    expect(pageQueryFrom({ pageSize: "500" })).toEqual({ page: 1, pageSize: 20 });
  });

  it("shows the error state when the list cannot be loaded", async () => {
    getActor.mockResolvedValue(actor);
    listAddresses.mockRejectedValue(new Error("db down"));
    render(await AddressesSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
  });

  it("redirects when the service reports the user as no longer signed in", async () => {
    getActor.mockResolvedValue(actor);
    listAddresses.mockRejectedValue(unauthenticated());
    await expect(AddressesSection({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      url: "/sign-in?next=%2Faccount%2Faddresses",
    });
  });
});
