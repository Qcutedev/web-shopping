import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { formatSatang } from "@/lib/format";
import { notFound } from "@/server/errors";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super("redirect");
  }
}

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
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

const getOwnStore = vi.fn();
vi.mock("@/modules/sellers", () => ({
  getOwnStore: (...args: unknown[]) => getOwnStore(...args),
  getOwnApplication: vi.fn(),
}));
const listOwnSellerOrders = vi.fn();
const getOwnSellerOrder = vi.fn();
vi.mock("@/modules/orders", () => ({
  listOwnSellerOrders: (...args: unknown[]) => listOwnSellerOrders(...args),
  getOwnSellerOrder: (...args: unknown[]) => getOwnSellerOrder(...args),
}));
const changeOrderStatus = vi.fn();
vi.mock("@/lib/api-client/seller", () => ({
  changeOrderStatus: (...args: unknown[]) => changeOrderStatus(...args),
}));

import { OrderSection } from "./order-section";
import { OrderStatusPanel, allowedSellerMoves } from "./order-status-panel";
import { OrdersSection } from "./orders-section";

const seller = { userId: "u2", role: "SELLER", storeId: "s1", storeStatus: "APPROVED" };

const listItem = {
  id: "so1",
  orderNumber: "OD2610110000042",
  createdAt: "2026-10-11T10:00:00.000Z",
  paymentStatus: "PAID" as const,
  fulfilmentStatus: "PENDING" as const,
  cancellationKind: null,
  storeName: "ร้านทดสอบ",
  itemsSubtotalSatang: 77_700,
  shippingFeeSatang: 4_000,
  shippingFeeIsSimulated: true,
  commissionRateBps: 500,
  shipment: null,
  items: [
    {
      id: "i1",
      productId: "p1",
      productTitle: "เสื้อยืด",
      productSku: "SKU-1",
      image: null,
      unitPriceSatang: 25_900,
      quantity: 3,
      lineTotalSatang: 77_700,
    },
  ],
};

const detail = {
  ...listItem,
  paidAt: "2026-10-11T11:30:00.000Z",
  shippingAddress: {
    recipientName: "สมชาย ใจดี",
    phone: "0812345678",
    line1: "99/1 ถนนสุขุมวิท",
    subdistrict: "คลองเตย",
    district: "คลองเตย",
    province: "กรุงเทพมหานคร",
    postalCode: "10110",
  },
};

function failure(code: string, status: number) {
  return { ok: false as const, status, code, fields: [], requestId: null };
}

beforeEach(() => {
  getActor.mockReset();
  getOwnStore.mockReset();
  listOwnSellerOrders.mockReset();
  getOwnSellerOrder.mockReset();
  changeOrderStatus.mockReset();
  refresh.mockReset();
});

describe("OrdersSection", () => {
  it("lists the store's orders with the filter from the address bar", async () => {
    getActor.mockResolvedValue(seller);
    listOwnSellerOrders.mockResolvedValue({ items: [listItem], page: 1, pageSize: 20, total: 1 });
    render(await OrdersSection({ searchParams: Promise.resolve({ fulfilmentStatus: "PENDING" }) }));
    expect(listOwnSellerOrders).toHaveBeenCalledWith(seller, {
      page: 1,
      pageSize: 20,
      fulfilmentStatus: "PENDING",
    });
    const list = screen.getByRole("list", { name: th.seller.orders.listLabel });
    expect(within(list).getByText(/OD2610110000042/)).toBeTruthy();
    expect(within(list).getByText(formatSatang(77_700))).toBeTruthy();
    expect(within(list).getByText(th.notice.simulatedShipping)).toBeTruthy();
    expect(within(list).getByText(th.seller.status.payment.PAID)).toBeTruthy();
    // The list carries no buyer address and no paid time.
    expect(screen.queryByText(/คลองเตย/)).toBeNull();
  });

  it("shows the empty state", async () => {
    getActor.mockResolvedValue(seller);
    listOwnSellerOrders.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.seller.orders.emptyTitle)).toBeTruthy();
  });

  it("shows the filtered empty state with a reset link", async () => {
    getActor.mockResolvedValue(seller);
    listOwnSellerOrders.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    render(await OrdersSection({ searchParams: Promise.resolve({ fulfilmentStatus: "SHIPPED" }) }));
    expect(screen.getByText(th.seller.orders.filteredEmptyTitle)).toBeTruthy();
  });

  it("marks a cancelled order as refunded outside the system", async () => {
    getActor.mockResolvedValue(seller);
    listOwnSellerOrders.mockResolvedValue({
      items: [
        { ...listItem, fulfilmentStatus: "CANCELLED", cancellationKind: "REFUND_OUTSIDE_SYSTEM" },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.seller.orders.row.cancelledNote)).toBeTruthy();
  });

  it("still lists for a suspended store, with the notice", async () => {
    getActor.mockResolvedValue({ ...seller, storeStatus: "SUSPENDED" });
    getOwnStore.mockResolvedValue({ statusReason: null });
    listOwnSellerOrders.mockResolvedValue({ items: [listItem], page: 1, pageSize: 20, total: 1 });
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.seller.suspended.title)).toBeTruthy();
    expect(screen.getByText(/OD2610110000042/)).toBeTruthy();
  });

  it("shows the error state with a retry link", async () => {
    getActor.mockResolvedValue(seller);
    listOwnSellerOrders.mockRejectedValue(new Error("db down"));
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/seller/orders",
    );
  });
});

describe("OrderSection", () => {
  it("shows the paid time, the buyer's address, the items, and no whole-order total", async () => {
    getActor.mockResolvedValue(seller);
    getOwnSellerOrder.mockResolvedValue(detail);
    render(await OrderSection({ params: Promise.resolve({ id: "so1" }) }));
    expect(getOwnSellerOrder).toHaveBeenCalledWith(seller, "so1");
    expect(screen.getByText(th.seller.orders.detail.paidAt)).toBeTruthy();
    expect(screen.getByText("สมชาย ใจดี")).toBeTruthy();
    expect(screen.getByText(/99\/1 ถนนสุขุมวิท/)).toBeTruthy();
    expect(screen.getByText("เสื้อยืด")).toBeTruthy();
    expect(screen.getAllByText(formatSatang(77_700)).length).toBeGreaterThan(0);
    expect(screen.getByText(formatSatang(4_000))).toBeTruthy();
    // 77,700 + 4,000 would be a total the server never sent.
    expect(screen.queryByText(formatSatang(81_700))).toBeNull();
    expect(screen.getByText(th.seller.orders.detail.noShipment)).toBeTruthy();
  });

  it("shows the shipment of a shipped order labelled as simulated", async () => {
    getActor.mockResolvedValue(seller);
    getOwnSellerOrder.mockResolvedValue({
      ...detail,
      fulfilmentStatus: "SHIPPED",
      shipment: {
        carrierName: "ขนส่งทดสอบ",
        trackingNumber: "TH123",
        isSimulated: true,
        shippedAt: "2026-10-12T04:00:00.000Z",
        deliveredAt: null,
      },
    });
    render(await OrderSection({ params: Promise.resolve({ id: "so1" }) }));
    expect(screen.getByText("ขนส่งทดสอบ")).toBeTruthy();
    expect(screen.getByText("TH123")).toBeTruthy();
    expect(screen.getAllByText(th.notice.simulatedShipping).length).toBeGreaterThan(0);
  });

  it("shows one not-found message for an unknown, foreign, or unpaid order", async () => {
    getActor.mockResolvedValue(seller);
    getOwnSellerOrder.mockRejectedValue(notFound());
    render(await OrderSection({ params: Promise.resolve({ id: "other-store-order" }) }));
    expect(screen.getByText(th.seller.guard.notFoundTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.seller.orders.backToList }).getAttribute("href"),
    ).toBe("/seller/orders");
  });

  it("lets a suspended store fulfil an existing order", async () => {
    getActor.mockResolvedValue({ ...seller, storeStatus: "SUSPENDED" });
    getOwnStore.mockResolvedValue({ statusReason: "x" });
    getOwnSellerOrder.mockResolvedValue(detail);
    render(await OrderSection({ params: Promise.resolve({ id: "so1" }) }));
    expect(
      (
        screen.getByRole("button", {
          name: th.seller.orders.actions.confirm,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

describe("allowedSellerMoves", () => {
  it("follows the transition table for a seller", () => {
    expect(allowedSellerMoves("PENDING")).toEqual(["PROCESSING", "CANCELLED"]);
    expect(allowedSellerMoves("PROCESSING")).toEqual(["SHIPPED", "CANCELLED"]);
    expect(allowedSellerMoves("SHIPPED")).toEqual(["DELIVERED"]);
    expect(allowedSellerMoves("DELIVERED")).toEqual([]);
    expect(allowedSellerMoves("CANCELLED")).toEqual([]);
  });
});

describe("OrderStatusPanel", () => {
  it("confirms a pending order and shows the new state", async () => {
    const user = userEvent.setup();
    changeOrderStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...detail, fulfilmentStatus: "PROCESSING" },
    });
    render(<OrderStatusPanel orderId="so1" status="PENDING" />);
    await user.click(screen.getByRole("button", { name: th.seller.orders.actions.confirm }));
    expect(changeOrderStatus).toHaveBeenCalledWith("so1", { to: "PROCESSING" });
    expect(await screen.findByText(th.seller.orders.actions.confirmed)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    // The next move is offered from the server's new status.
    expect(screen.getByRole("button", { name: th.seller.orders.actions.ship })).toBeTruthy();
  });

  it("disables the buttons while a request is pending and sends once", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    changeOrderStatus.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<OrderStatusPanel orderId="so1" status="PENDING" />);
    const confirm = screen.getByRole("button", { name: th.seller.orders.actions.confirm });
    await user.click(confirm);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: th.seller.orders.actions.cancel }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(confirm);
    expect(changeOrderStatus).toHaveBeenCalledTimes(1);
    finish({ ok: true, status: 200, data: { ...detail, fulfilmentStatus: "PROCESSING" } });
  });

  it("ships with an optional carrier and tracking number, omitting blank fields", async () => {
    const user = userEvent.setup();
    changeOrderStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...detail, fulfilmentStatus: "SHIPPED" },
    });
    render(<OrderStatusPanel orderId="so1" status="PROCESSING" />);
    expect(screen.getByText(th.notice.simulatedShipping)).toBeTruthy();
    await user.type(screen.getByLabelText(th.seller.orders.actions.trackingNumber), "TH123");
    await user.click(screen.getByRole("button", { name: th.seller.orders.actions.ship }));
    expect(changeOrderStatus).toHaveBeenCalledWith("so1", {
      to: "SHIPPED",
      trackingNumber: "TH123",
    });
    expect(await screen.findByText(th.seller.orders.actions.shipped)).toBeTruthy();
  });

  it("offers no cancel once shipped, only delivery", () => {
    render(<OrderStatusPanel orderId="so1" status="SHIPPED" />);
    expect(screen.queryByRole("button", { name: th.seller.orders.actions.cancel })).toBeNull();
    expect(screen.getByRole("button", { name: th.seller.orders.actions.deliver })).toBeTruthy();
    expect(screen.getByText(th.seller.orders.actions.shippedLocked)).toBeTruthy();
  });

  it("offers nothing for a delivered or cancelled order", () => {
    const { unmount } = render(<OrderStatusPanel orderId="so1" status="DELIVERED" />);
    expect(screen.getByText(th.seller.orders.actions.noActions)).toBeTruthy();
    unmount();
    render(<OrderStatusPanel orderId="so1" status="CANCELLED" />);
    expect(screen.getByText(th.seller.orders.actions.noActions)).toBeTruthy();
  });

  it("asks before cancelling, names the outside-the-system refund, and cancels on confirm", async () => {
    const user = userEvent.setup();
    changeOrderStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...detail,
        fulfilmentStatus: "CANCELLED",
        cancellationKind: "REFUND_OUTSIDE_SYSTEM",
      },
    });
    render(<OrderStatusPanel orderId="so1" status="PROCESSING" />);
    await user.click(screen.getByRole("button", { name: th.seller.orders.actions.cancel }));
    expect(screen.getByText(th.seller.orders.actions.cancelConfirmNote)).toBeTruthy();
    expect(changeOrderStatus).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: th.seller.orders.actions.cancelConfirmAction }),
    );
    expect(changeOrderStatus).toHaveBeenCalledWith("so1", { to: "CANCELLED" });
    expect(await screen.findByText(th.seller.orders.actions.cancelled)).toBeTruthy();
  });

  it("shows Thai copy for a refused move and refreshes to the stored state", async () => {
    const user = userEvent.setup();
    changeOrderStatus.mockResolvedValue(failure("INVALID_STATE_TRANSITION", 409));
    render(<OrderStatusPanel orderId="so1" status="PENDING" />);
    await user.click(screen.getByRole("button", { name: th.seller.orders.actions.confirm }));
    expect(await screen.findByText(th.seller.errors.invalidTransition)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: th.seller.orders.actions.confirm,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
