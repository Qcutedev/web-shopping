import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { CartDto, CartLineDto } from "@/modules/cart/schema";
import type { AddressDto } from "@/modules/profile/schema";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));
const api = vi.hoisted(() => ({ readCart: vi.fn() }));
vi.mock("@/lib/api-client/cart", () => ({
  readCart: (...args: unknown[]) => api.readCart(...args),
}));
const checkoutApi = vi.hoisted(() => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/api-client/checkout", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client/checkout")>();
  return { ...original, placeOrder: (...args: unknown[]) => checkoutApi.placeOrder(...args) };
});

import { CheckoutView } from "./checkout-view";

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

function cartOf(lines: CartLineDto[] = [line()], over: Partial<CartDto> = {}): CartDto {
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
    canCheckout: lines.length > 0 && lines.every((entry) => entry.buyable),
    ...over,
  };
}

function address(over: Partial<AddressDto> = {}): AddressDto {
  return {
    id: "a1",
    recipientName: "สมชาย ใจดี",
    phone: "0812345678",
    line1: "99/1 ถนนสุขุมวิท",
    subdistrict: "คลองตัน",
    district: "คลองเตย",
    province: "กรุงเทพมหานคร",
    postalCode: "10110",
    isDefault: false,
    ...over,
  };
}

const failed = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  ok: false,
  status,
  code,
  fields: [],
  requestId: null,
  ...extra,
});
const placed = (id = "o1") => ({ ok: true, status: 201, data: { id } });

function submitButton(name: string = th.checkout.submit) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

beforeEach(() => {
  refresh.mockReset();
  push.mockReset();
  api.readCart.mockReset();
  checkoutApi.placeOrder.mockReset();
});

describe("CheckoutView states", () => {
  it("shows the empty state for an empty cart", () => {
    render(<CheckoutView cart={cartOf([])} addresses={[address()]} />);
    expect(screen.getByText(th.checkout.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.checkout.emptyAction })).toBeTruthy();
  });

  it("blocks checkout and points to the cart when a line cannot be bought", () => {
    render(
      <CheckoutView
        cart={cartOf([line({ buyable: false, unbuyableReason: "SOLD_OUT" })])}
        addresses={[address()]}
      />,
    );
    expect(screen.getByText(th.checkout.blockedTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.checkout.backToCart }).getAttribute("href")).toBe(
      "/cart",
    );
    expect(screen.queryByRole("button", { name: th.checkout.submit })).toBeNull();
  });

  it("asks for an address when there is none", () => {
    render(<CheckoutView cart={cartOf()} addresses={[]} />);
    expect(screen.getByText(th.checkout.noAddressTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.checkout.noAddressAction }).getAttribute("href"),
    ).toBe("/account/addresses");
  });

  it("labels the mock payment and the simulated shipping, and shows server totals", () => {
    render(<CheckoutView cart={cartOf()} addresses={[address()]} />);
    expect(screen.getAllByText(th.notice.mockPayment).length).toBeGreaterThan(0);
    expect(screen.getAllByText(th.notice.simulatedShipping).length).toBeGreaterThan(0);
    expect(screen.getByText(th.checkout.paymentMockNote)).toBeTruthy();
    expect(screen.getByText("฿817.00")).toBeTruthy();
    expect(submitButton().textContent).toContain("ชำระเงินจำลอง");
  });

  it("preselects the default address and renders names through bdi", () => {
    const { container } = render(
      <CheckoutView
        cart={cartOf()}
        addresses={[
          address({ id: "a1" }),
          address({ id: "a2", recipientName: "<i>x</i>", isDefault: true }),
        ]}
      />,
    );
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
    expect([...container.querySelectorAll("bdi")].map((node) => node.textContent)).toContain(
      "<i>x</i>",
    );
  });
});

describe("CheckoutView submit", () => {
  it("sends only the address, MOCK, and the outcome, then opens the order", async () => {
    checkoutApi.placeOrder.mockResolvedValue(placed("o 1"));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/o%201"));
    const [body, key] = checkoutApi.placeOrder.mock.calls[0] ?? [];
    expect(body).toEqual({ addressId: "a1", paymentMethod: "MOCK", mockOutcome: "SUCCESS" });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("asks the mock provider to fail when the test option is ticked", async () => {
    checkoutApi.placeOrder.mockResolvedValue(placed());
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(screen.getByRole("checkbox", { name: th.checkout.failOption }));
    await userEvent.click(submitButton());
    await waitFor(() => expect(checkoutApi.placeOrder).toHaveBeenCalled());
    expect(checkoutApi.placeOrder.mock.calls[0]?.[0]).toMatchObject({ mockOutcome: "FAIL" });
  });

  it("disables the submit control while pending and sends once", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    checkoutApi.placeOrder.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    const button = submitButton();
    await userEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(
      (screen.getByRole("checkbox", { name: th.checkout.failOption }) as HTMLInputElement).disabled,
    ).toBe(true);
    await userEvent.click(button);
    expect(checkoutApi.placeOrder).toHaveBeenCalledTimes(1);
    resolve(placed());
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("reuses the key when the outcome is unknown and shows the unknown state", async () => {
    checkoutApi.placeOrder.mockResolvedValue(failed(0, "NETWORK_ERROR"));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    expect(await screen.findByText(th.checkout.unknownTitle)).toBeTruthy();
    // One notice, not a second banner with the network message.
    expect(screen.queryByText(th.errors.network)).toBeNull();
    // The cart is unchanged, so the check resends with the same key.
    api.readCart.mockResolvedValue({ ok: true, status: 200, data: cartOf() });
    checkoutApi.placeOrder.mockResolvedValue(placed("o9"));
    await userEvent.click(screen.getByRole("button", { name: th.checkout.unknownCheck }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/o9"));
    const keys = checkoutApi.placeOrder.mock.calls.map((call) => call[1]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("locks the submit control and every input while the outcome is unknown", async () => {
    checkoutApi.placeOrder.mockResolvedValue(failed(0, "NETWORK_ERROR"));
    render(
      <CheckoutView
        cart={cartOf()}
        addresses={[address({ id: "a1", isDefault: true }), address({ id: "a2" })]}
      />,
    );
    await userEvent.click(submitButton());
    await screen.findByText(th.checkout.unknownTitle);
    expect(submitButton().disabled).toBe(true);
    const inputs = [
      ...(screen.getAllByRole("radio") as HTMLInputElement[]),
      screen.getByRole("checkbox", { name: th.checkout.failOption }) as HTMLInputElement,
    ];
    expect(inputs).toHaveLength(3);
    // The radios are disabled through their fieldset, so ask the `:disabled` pseudo-class.
    expect(inputs.map((input) => input.matches(":disabled"))).toEqual([true, true, true]);
    // Submitting by Enter is also ignored: no second request, the key stays as it was.
    await userEvent.click(submitButton());
    fireEvent.submit(submitButton().closest("form") as HTMLFormElement);
    expect(checkoutApi.placeOrder).toHaveBeenCalledTimes(1);
    // The check button is the one control that proceeds.
    expect(
      (screen.getByRole("button", { name: th.checkout.unknownCheck }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("unlocks the form again when the check finds the cart changed", async () => {
    checkoutApi.placeOrder.mockResolvedValue(failed(500, "INTERNAL_ERROR"));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    await screen.findByText(th.checkout.unknownTitle);
    api.readCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: cartOf([line({ quantity: 2, quantityLowered: true })], { grandTotalSatang: 1 }),
    });
    await userEvent.click(screen.getByRole("button", { name: th.checkout.unknownCheck }));
    await screen.findByText(th.checkout.unknownChanged);
    expect(submitButton().disabled).toBe(false);
    expect((screen.getAllByRole("radio")[0] as HTMLInputElement).matches(":disabled")).toBe(false);
  });

  it("refreshes the page when the chosen address no longer exists", async () => {
    checkoutApi.placeOrder.mockResolvedValue(failed(404, "NOT_FOUND"));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    expect(await screen.findByText(th.errors.notFound)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(submitButton().disabled).toBe(false);
  });

  it("says sold out only for zero stock; an unknown figure gets the general stock text", async () => {
    const refused = (availableStock: number | null) =>
      failed(409, "INSUFFICIENT_STOCK", {
        details: {
          items: [
            {
              cartItemId: "l1",
              productId: "p1",
              reason: "INSUFFICIENT_STOCK",
              requestedQuantity: 3,
              availableStock,
            },
          ],
        },
      });
    checkoutApi.placeOrder.mockResolvedValueOnce(refused(0));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    const soldOutAlert = (await screen.findByText(th.checkout.refusedTitle)).closest(
      "[role=status]",
    ) as HTMLElement;
    expect(soldOutAlert.textContent).toContain(th.checkout.refusedSoldOut);

    checkoutApi.placeOrder.mockResolvedValueOnce(refused(null));
    await userEvent.click(submitButton(th.checkout.confirmAgain));
    await waitFor(() => expect(checkoutApi.placeOrder).toHaveBeenCalledTimes(2));
    const alert = (await screen.findByText(th.checkout.refusedTitle)).closest(
      "[role=status]",
    ) as HTMLElement;
    await waitFor(() => expect(alert.textContent).toContain(th.errors.insufficientStock));
    expect(alert.textContent).not.toContain(th.checkout.refusedSoldOut);
  });

  it("names a hidden line (null title) with the unavailable label in the refusal list", async () => {
    checkoutApi.placeOrder.mockResolvedValueOnce(
      failed(409, "INSUFFICIENT_STOCK", {
        details: {
          items: [
            {
              cartItemId: "l1",
              productId: "p1",
              reason: "NOT_AVAILABLE",
              requestedQuantity: 3,
              availableStock: null,
            },
          ],
        },
      }),
    );
    render(
      <CheckoutView
        cart={cartOf([line({ slug: null, title: null, image: null })])}
        addresses={[address({ isDefault: true })]}
      />,
    );
    await userEvent.click(submitButton());
    const list = await screen.findByRole("list", { name: th.checkout.refusedListLabel });
    expect(list.textContent).toBe(`${th.cart.unavailableLine}: ${th.checkout.refusedNotAvailable}`);
  });

  it("does not resend when the cart changed after an unknown outcome", async () => {
    checkoutApi.placeOrder.mockResolvedValue(failed(500, "INTERNAL_ERROR"));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    await screen.findByText(th.checkout.unknownTitle);
    api.readCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: cartOf([line({ quantity: 2, quantityLowered: true })], { grandTotalSatang: 1 }),
    });
    await userEvent.click(screen.getByRole("button", { name: th.checkout.unknownCheck }));
    expect(await screen.findByText(th.checkout.unknownChanged)).toBeTruthy();
    expect(checkoutApi.placeOrder).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the refusal, the new total, uses a new key, and never resends by itself", async () => {
    checkoutApi.placeOrder.mockResolvedValueOnce(
      failed(409, "INSUFFICIENT_STOCK", {
        details: {
          items: [
            {
              cartItemId: "l1",
              productId: "p1",
              reason: "INSUFFICIENT_STOCK",
              requestedQuantity: 5,
              availableStock: 3,
            },
          ],
          totals: {
            itemsSubtotalSatang: 50_000,
            shippingTotalSatang: 4_000,
            grandTotalSatang: 54_000,
          },
        },
      }),
    );
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    const alert = await screen.findByText(th.checkout.refusedTitle);
    const region = alert.closest("[role=status]") as HTMLElement;
    expect(within(region).getByText("ชาเขียว").tagName).toBe("BDI");
    expect(region.textContent).toContain(fill(th.quantity.lowered, { available: 3 }));
    expect(region.textContent).toContain("฿540.00");
    expect(refresh).toHaveBeenCalled();
    expect(checkoutApi.placeOrder).toHaveBeenCalledTimes(1);

    checkoutApi.placeOrder.mockResolvedValueOnce(placed());
    await userEvent.click(submitButton(th.checkout.confirmAgain));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const keys = checkoutApi.placeOrder.mock.calls.map((call) => call[1]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("maps the CART_LINE_LIMIT reason to its Thai copy", async () => {
    checkoutApi.placeOrder.mockResolvedValue(
      failed(409, "CONFLICT", { reason: "CART_LINE_LIMIT" }),
    );
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    expect(await screen.findByText(th.errors.reasons.CART_LINE_LIMIT)).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it("shows a total above the limit as its own message", async () => {
    checkoutApi.placeOrder.mockResolvedValue(failed(422, "ORDER_LIMIT_EXCEEDED"));
    render(<CheckoutView cart={cartOf()} addresses={[address({ isDefault: true })]} />);
    await userEvent.click(submitButton());
    expect(await screen.findByText(th.errors.orderLimit)).toBeTruthy();
  });
});
