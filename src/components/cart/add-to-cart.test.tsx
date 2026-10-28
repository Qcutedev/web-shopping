import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";

const addCartItem = vi.fn();
vi.mock("@/lib/api-client/cart", () => ({
  addCartItem: (...args: unknown[]) => addCartItem(...args),
}));

import { AddToCart } from "./add-to-cart";

const props = { productId: "prod-1", slug: "tea", stock: 5, soldOut: false };

function failure(status: number, code: string, extra: Record<string, unknown> = {}) {
  return { ok: false, status, code, fields: [], requestId: null, ...extra };
}

beforeEach(() => addCartItem.mockReset());

describe("AddToCart", () => {
  it("sends only the product id and the quantity, then confirms with a cart link", async () => {
    const user = userEvent.setup();
    addCartItem.mockResolvedValue({ ok: true, status: 201, data: {} });
    render(<AddToCart {...props} />);
    await user.click(screen.getByRole("button", { name: th.cart.increase }));
    await user.click(screen.getByRole("button", { name: th.cart.add.submit }));
    expect(addCartItem).toHaveBeenCalledWith("prod-1", 2);
    expect(await screen.findByText(th.cart.add.success)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.cart.add.viewCart }).getAttribute("href")).toBe(
      "/cart",
    );
  });

  it("disables the submit button while the request is pending and ignores a second submit", async () => {
    const user = userEvent.setup();
    let resolve: (value: unknown) => void = () => {};
    addCartItem.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<AddToCart {...props} />);
    const button = screen.getByRole("button", { name: th.cart.add.submit });
    await user.click(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    expect(addCartItem).toHaveBeenCalledTimes(1);
    resolve({ ok: true, status: 200, data: {} });
    expect(await screen.findByText(th.cart.add.success)).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a sign-in link back to the product when the session is missing", async () => {
    const user = userEvent.setup();
    addCartItem.mockResolvedValue(failure(401, "UNAUTHENTICATED"));
    render(<AddToCart {...props} slug="a b" />);
    await user.click(screen.getByRole("button", { name: th.cart.add.submit }));
    expect(await screen.findByText(th.errors.unauthenticated)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.shell.header.signIn }).getAttribute("href")).toBe(
      "/sign-in?next=%2Fproducts%2Fa%2520b",
    );
  });

  it("says a product of the own store cannot be bought", async () => {
    const user = userEvent.setup();
    addCartItem.mockResolvedValue(
      failure(409, "PRODUCT_UNAVAILABLE", { details: { items: [{ reason: "OWN_STORE" }] } }),
    );
    render(<AddToCart {...props} />);
    await user.click(screen.getByRole("button", { name: th.cart.add.submit }));
    expect(await screen.findByText(th.cart.add.ownStore)).toBeTruthy();
  });

  it.each([
    ["VALIDATION_ERROR", 400, th.cart.add.tooMany],
    ["NETWORK_ERROR", 0, th.errors.network],
    ["RATE_LIMITED", 429, th.errors.rateLimited],
  ])("maps %s to Thai copy and keeps the form usable", async (code, status, text) => {
    const user = userEvent.setup();
    addCartItem.mockResolvedValue(failure(status, code));
    render(<AddToCart {...props} />);
    await user.click(screen.getByRole("button", { name: th.cart.add.submit }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: th.cart.add.submit }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("maps the cart line limit reason", async () => {
    const user = userEvent.setup();
    addCartItem.mockResolvedValue(failure(409, "CONFLICT", { reason: "CART_LINE_LIMIT" }));
    render(<AddToCart {...props} />);
    await user.click(screen.getByRole("button", { name: th.cart.add.submit }));
    expect(await screen.findByText(th.errors.reasons.CART_LINE_LIMIT)).toBeTruthy();
  });

  it("shows no form for a sold-out product", () => {
    render(<AddToCart {...props} stock={0} soldOut />);
    expect(screen.getByText(th.cart.soldOutRefused)).toBeTruthy();
    expect(screen.queryByRole("button", { name: th.cart.add.submit })).toBeNull();
  });

  it("keeps the quantity within the stock", async () => {
    const user = userEvent.setup();
    addCartItem.mockResolvedValue({ ok: true, status: 201, data: {} });
    render(<AddToCart {...props} stock={2} />);
    const plus = screen.getByRole("button", { name: th.cart.increase });
    await user.click(plus);
    await user.click(plus);
    await user.click(screen.getByRole("button", { name: th.cart.add.submit }));
    expect(addCartItem).toHaveBeenCalledWith("prod-1", 2);
  });
});
