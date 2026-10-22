import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { notFound as notFoundError, unauthenticated } from "@/server/errors";

// Server sections with the module services mocked at their boundary: no Prisma client, no
// database. The sections are async Server Components; they are awaited and the element rendered.
const NOT_FOUND_SIGNAL = new Error("NEXT_NOT_FOUND");
const REDIRECT_SIGNAL = new Error("NEXT_REDIRECT");
const redirect = vi.fn((to: string): never => {
  throw to === "" ? new Error("empty redirect") : REDIRECT_SIGNAL;
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND_SIGNAL;
  },
  redirect: (to: string) => redirect(to),
  unstable_rethrow: (error: unknown) => {
    if (error === NOT_FOUND_SIGNAL || error === REDIRECT_SIGNAL) throw error;
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const services = vi.hoisted(() => ({
  getOrder: vi.fn(),
  listOrders: vi.fn(),
  getCart: vi.fn(),
  listAddresses: vi.fn(),
}));
vi.mock("@/modules/orders", async () => {
  const schema = await import("@/modules/orders/schema");
  return {
    getOrder: services.getOrder,
    listOrders: services.listOrders,
    DEFAULT_PAGE_SIZE: schema.DEFAULT_PAGE_SIZE,
    orderIdSchema: schema.orderIdSchema,
    paginationQuerySchema: schema.paginationQuerySchema,
    queryRecord: schema.queryRecord,
  };
});
vi.mock("@/modules/cart", () => ({ getCart: services.getCart }));
vi.mock("@/modules/profile", () => ({
  listAddresses: services.listAddresses,
  MAX_PAGE_SIZE: 50,
}));
vi.mock("@/components/account/account-actor", () => ({
  requireAccountActor: vi.fn(async () => ({ userId: "u1", role: "CUSTOMER" })),
}));

import { CartSection } from "@/components/cart/cart-section";
import { CheckoutSection } from "@/components/checkout/checkout-section";
import { OrderSection } from "./order-section";
import { OrdersSection } from "./orders-section";

const emptyCart = {
  stores: [],
  itemsSubtotalSatang: 0,
  shippingTotalSatang: 0,
  grandTotalSatang: 0,
  canCheckout: false,
};

beforeEach(() => {
  Object.values(services).forEach((mock) => mock.mockReset());
  redirect.mockClear();
});

describe("OrderSection", () => {
  it("is the not-found page for a missing or foreign order", async () => {
    services.getOrder.mockRejectedValue(notFoundError());
    await expect(OrderSection({ id: "o1" })).rejects.toBe(NOT_FOUND_SIGNAL);
  });

  it("is the not-found page for a malformed id, without calling the service", async () => {
    await expect(OrderSection({ id: "" })).rejects.toBe(NOT_FOUND_SIGNAL);
    expect(services.getOrder).not.toHaveBeenCalled();
  });

  it("sends an ended session to sign-in and returns to the order", async () => {
    services.getOrder.mockRejectedValue(unauthenticated());
    await expect(OrderSection({ id: "o 1" })).rejects.toBe(REDIRECT_SIGNAL);
    expect(redirect).toHaveBeenCalledWith("/sign-in?next=%2Forders%2Fo%25201");
  });

  it("shows the error state with a retry link for any other failure", async () => {
    services.getOrder.mockRejectedValue(new Error("boom"));
    render(await OrderSection({ id: "o1" }));
    expect(screen.getByText(th.errors.loadFailedTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/orders/o1",
    );
  });
});

describe("OrdersSection", () => {
  it("shows the empty state", async () => {
    services.listOrders.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.orders.emptyTitle)).toBeTruthy();
  });

  it("falls back to the first page for an invalid query", async () => {
    services.listOrders.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    await OrdersSection({ searchParams: Promise.resolve({ page: "abc" }) });
    expect(services.listOrders).toHaveBeenCalledWith(expect.anything(), { page: 1, pageSize: 20 });
  });

  it("shows the error state when the service fails", async () => {
    services.listOrders.mockRejectedValue(new Error("boom"));
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.errors.loadFailedTitle)).toBeTruthy();
  });
});

describe("CartSection and CheckoutSection", () => {
  it("shows the empty cart", async () => {
    services.getCart.mockResolvedValue(emptyCart);
    render(await CartSection());
    expect(screen.getByText(th.cart.emptyTitle)).toBeTruthy();
  });

  it("shows the error state when the cart cannot be read", async () => {
    services.getCart.mockRejectedValue(new Error("boom"));
    render(await CartSection());
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe("/cart");
  });

  it("sends an ended session to sign-in from checkout", async () => {
    services.getCart.mockRejectedValue(unauthenticated());
    await expect(CheckoutSection()).rejects.toBe(REDIRECT_SIGNAL);
    expect(redirect).toHaveBeenCalledWith("/sign-in?next=%2Fcheckout");
  });

  it("reads the cart and the first page of addresses for checkout", async () => {
    services.getCart.mockResolvedValue(emptyCart);
    services.listAddresses.mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
    render(await CheckoutSection());
    expect(services.listAddresses).toHaveBeenCalledWith(expect.anything(), {
      page: 1,
      pageSize: 50,
    });
    expect(screen.getByText(th.checkout.emptyTitle)).toBeTruthy();
  });
});
