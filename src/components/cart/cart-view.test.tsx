import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { CartDto, CartLineDto } from "@/modules/cart/schema";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const api = { setCartItemQuantity: vi.fn(), removeCartItem: vi.fn() };
vi.mock("@/lib/api-client/cart", () => ({
  setCartItemQuantity: (...args: unknown[]) => api.setCartItemQuantity(...args),
  removeCartItem: (...args: unknown[]) => api.removeCartItem(...args),
}));

import { CartView } from "./cart-view";

function line(over: Partial<CartLineDto> = {}): CartLineDto {
  return {
    id: "l1",
    productId: "p1",
    slug: "tea",
    title: "ชาเขียว",
    image: null,
    unitPriceSatang: 25_900,
    quantity: 3,
    lineTotalSatang: 77_700,
    stock: 10,
    buyable: true,
    unbuyableReason: null,
    quantityLowered: false,
    ...over,
  };
}

function cartOf(lines: CartLineDto[], over: Partial<CartDto> = {}): CartDto {
  return {
    stores: lines.length
      ? [
          {
            store: { name: "ร้านชา", slug: "tea-shop", isSample: false },
            items: lines,
            itemsSubtotalSatang: 77_700,
            shippingFeeSatang: 4_000,
            shippingFeeIsSimulated: true,
          },
        ]
      : [],
    itemsSubtotalSatang: 77_700,
    shippingTotalSatang: 4_000,
    grandTotalSatang: 81_700,
    canCheckout: lines.every((entry) => entry.buyable) && lines.length > 0,
    ...over,
  };
}

const ok = { ok: true, status: 200, data: {} };
const failure = (status: number, code: string, reason?: string) => ({
  ok: false,
  status,
  code,
  ...(reason ? { reason } : {}),
  fields: [],
  requestId: null,
});

beforeEach(() => {
  refresh.mockReset();
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe("CartView", () => {
  it("shows the empty state with a way to shop", () => {
    render(<CartView cart={cartOf([])} />);
    expect(screen.getByText(th.cart.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.cart.emptyAction }).getAttribute("href")).toBe("/");
  });

  it("shows server amounts, the simulated shipping label, and a checkout link", () => {
    render(<CartView cart={cartOf([line()])} />);
    expect(screen.getAllByText("฿777.00").length).toBeGreaterThan(0);
    expect(screen.getByText("฿817.00")).toBeTruthy();
    expect(screen.getAllByText(th.notice.simulatedShipping).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: th.cart.checkout }).getAttribute("href")).toBe(
      "/checkout",
    );
  });

  it("tells the customer when a quantity was lowered to the stock", () => {
    render(<CartView cart={cartOf([line({ quantity: 2, stock: 2, quantityLowered: true })])} />);
    expect(screen.getByText(fill(th.quantity.lowered, { available: 2 }))).toBeTruthy();
  });

  it("marks a sold-out line, hides its stepper, and blocks checkout", () => {
    render(
      <CartView cart={cartOf([line({ buyable: false, unbuyableReason: "SOLD_OUT", stock: 0 })])} />,
    );
    expect(screen.getByText(th.cart.soldOut)).toBeTruthy();
    expect(screen.getByText(th.cart.soldOutNote)).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("link", { name: th.cart.checkout })).toBeNull();
    expect(
      (screen.getByRole("button", { name: th.cart.checkout }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(th.cart.blockedNote)).toBeTruthy();
  });

  it("marks a hidden product line without price and total", () => {
    render(
      <CartView
        cart={cartOf([
          line({
            buyable: false,
            unbuyableReason: "NOT_AVAILABLE",
            unitPriceSatang: null,
            lineTotalSatang: null,
            stock: null,
          }),
        ])}
      />,
    );
    expect(screen.getByText(th.cart.notAvailable)).toBeTruthy();
    expect(screen.queryByText(th.cart.unitPrice, { exact: false })).toBeNull();
  });

  it("changes a quantity through the endpoint, confirms, and refreshes", async () => {
    api.setCartItemQuantity.mockResolvedValue(ok);
    render(<CartView cart={cartOf([line()])} />);
    await userEvent.click(screen.getByRole("button", { name: th.cart.increase }));
    await waitFor(() => expect(api.setCartItemQuantity).toHaveBeenCalledWith("l1", 4));
    expect(await screen.findByText(th.cart.quantityUpdated)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("removes a line and disables its button while the request runs", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.removeCartItem.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<CartView cart={cartOf([line()])} />);
    const button = screen.getByRole("button", { name: `${th.cart.remove} ชาเขียว` });
    await userEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    await userEvent.click(button);
    expect(api.removeCartItem).toHaveBeenCalledTimes(1);
    resolve(ok);
    expect(await screen.findByText(th.cart.removed)).toBeTruthy();
  });

  it("shows the Thai copy of a refusal and refreshes on a conflict", async () => {
    api.setCartItemQuantity.mockResolvedValue(failure(409, "INSUFFICIENT_STOCK"));
    render(<CartView cart={cartOf([line()])} />);
    await userEvent.click(screen.getByRole("button", { name: th.cart.increase }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(th.errors.insufficientStock)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("passes the reason of a CART_LINE_LIMIT conflict to the message", async () => {
    api.removeCartItem.mockResolvedValue(failure(409, "CONFLICT", "CART_LINE_LIMIT"));
    render(<CartView cart={cartOf([line()])} />);
    await userEvent.click(screen.getByRole("button", { name: `${th.cart.remove} ชาเขียว` }));
    expect(await screen.findByText(th.errors.reasons.CART_LINE_LIMIT)).toBeTruthy();
  });

  it("offers sign-in when the session ended", async () => {
    api.removeCartItem.mockResolvedValue(failure(401, "UNAUTHENTICATED"));
    render(<CartView cart={cartOf([line()])} />);
    await userEvent.click(screen.getByRole("button", { name: `${th.cart.remove} ชาเขียว` }));
    const link = await screen.findByRole("link", { name: th.shell.header.signIn });
    expect(link.getAttribute("href")).toBe("/sign-in?next=%2Fcart");
  });

  it("renders store and product names through bdi", () => {
    const { container } = render(<CartView cart={cartOf([line({ title: "<b>x</b>" })])} />);
    const texts = [...container.querySelectorAll("bdi")].map((node) => node.textContent);
    expect(texts).toContain("<b>x</b>");
    expect(texts).toContain("ร้านชา");
    expect(container.querySelector("b")).toBeNull();
  });
});
