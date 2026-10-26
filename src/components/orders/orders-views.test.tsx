import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { OrderDto } from "@/modules/orders/schema";
import { OrderDetailView } from "./order-detail-view";
import { OrderListView } from "./order-list-view";

function order(over: Partial<OrderDto> = {}): OrderDto {
  return {
    id: "o1",
    orderNumber: "OD2610110000042",
    createdAt: "2026-10-11T03:20:00.000Z",
    paidAt: "2026-10-11T03:20:01.000Z",
    paymentStatus: "PAID",
    payment: { provider: "MOCK", isSimulated: true, failureReason: null },
    itemsSubtotalSatang: 77_700,
    shippingTotalSatang: 4_000,
    grandTotalSatang: 81_700,
    shippingAddress: {
      recipientName: "สมชาย ใจดี",
      phone: "0812345678",
      line1: "99/1",
      subdistrict: "คลองตัน",
      district: "คลองเตย",
      province: "กรุงเทพมหานคร",
      postalCode: "10110",
    },
    sellerOrders: [
      {
        id: "s1",
        storeName: "ร้านชา",
        storeSlug: "tea-shop",
        fulfilmentStatus: "PENDING",
        cancellationKind: null,
        itemsSubtotalSatang: 77_700,
        shippingFeeSatang: 4_000,
        shippingFeeIsSimulated: true,
        shipment: null,
        items: [
          {
            id: "i1",
            productId: "p1",
            productTitle: "ชาเขียว",
            productSku: "TEA-1",
            image: null,
            unitPriceSatang: 25_900,
            quantity: 3,
            lineTotalSatang: 77_700,
            review: null,
          },
        ],
      },
    ],
    cartReturn: null,
    ...over,
  };
}

describe("OrderListView", () => {
  it("shows the empty state with a way to shop", () => {
    render(<OrderListView orders={[]} total={0} firstPageHref="/orders" />);
    expect(screen.getByText(th.orders.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.orders.emptyAction })).toBeTruthy();
  });

  it("offers a way back when the page is past the last one", () => {
    render(<OrderListView orders={[]} total={4} firstPageHref="/orders" />);
    expect(screen.getByRole("link", { name: th.orders.pageEmptyAction }).getAttribute("href")).toBe(
      "/orders",
    );
  });

  it("lists orders with status, mock label, total, and a link; marks a failed one", () => {
    render(
      <OrderListView
        orders={[
          order(),
          order({
            id: "o2",
            orderNumber: "OD2",
            paymentStatus: "FAILED",
            paidAt: null,
            payment: { provider: "MOCK", isSimulated: true, failureReason: "SIMULATED_DECLINE" },
          }),
        ]}
        total={2}
        firstPageHref="/orders"
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("฿817.00")).toBeTruthy();
    expect(within(items[0]!).getByText(th.notice.mockPayment)).toBeTruthy();
    expect(within(items[1]!).getByText(th.order.paymentFailed)).toBeTruthy();
    expect(
      within(items[0]!)
        .getByRole("link", { name: /ดูรายละเอียด/ })
        .getAttribute("href"),
    ).toBe("/orders/o1");
    expect(screen.getByText(fill(th.orders.count, { total: 2 }))).toBeTruthy();
  });
});

describe("OrderDetailView", () => {
  it("offers the review form only for an item of a delivered seller order", () => {
    const base = order();
    const delivered = order({
      sellerOrders: [{ ...base.sellerOrders[0]!, fulfilmentStatus: "DELIVERED" }],
    });
    const { unmount } = render(<OrderDetailView order={base} />);
    expect(screen.queryByRole("button", { name: th.orders.review.write })).toBeNull();
    unmount();
    render(<OrderDetailView order={delivered} />);
    expect(screen.getByRole("button", { name: th.orders.review.write })).toBeTruthy();
  });

  it("confirms a paid order and labels the mock payment and simulated shipping", () => {
    render(<OrderDetailView order={order()} />);
    expect(screen.getByText(th.orders.confirmation.paidTitle)).toBeTruthy();
    expect(screen.getAllByText(th.notice.mockPayment).length).toBeGreaterThan(0);
    expect(screen.getAllByText(th.notice.simulatedShipping).length).toBeGreaterThan(0);
    expect(screen.getAllByText("฿817.00").length).toBeGreaterThan(0);
    expect(screen.getByText("OD2610110000042")).toBeTruthy();
  });

  it("shows a failed payment, its reason, and the items returned to the cart", () => {
    render(
      <OrderDetailView
        order={order({
          paymentStatus: "FAILED",
          paidAt: null,
          payment: { provider: "MOCK", isSimulated: true, failureReason: "SIMULATED_DECLINE" },
          cartReturn: {
            capped: true,
            items: [{ productId: "p1", orderedQuantity: 3, cartQuantity: 99, capped: true }],
          },
          sellerOrders: [
            {
              ...order().sellerOrders[0]!,
              fulfilmentStatus: "CANCELLED",
              cancellationKind: "PAYMENT_FAILED",
            },
          ],
        })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(th.order.paymentFailed)).toBeTruthy();
    expect(within(alert).getByText(th.orders.confirmation.failedBody)).toBeTruthy();
    expect(within(alert).getByText(th.orders.detail.cartReturnBody)).toBeTruthy();
    expect(
      within(alert).getByText(fill(th.cart.returnedQuantityCut, { quantity: 99 }), {
        exact: false,
      }),
    ).toBeTruthy();
    expect(within(alert).getByRole("link", { name: th.orders.confirmation.goToCart })).toBeTruthy();
    expect(screen.getByText(th.orders.detail.cancelledPaymentFailed)).toBeTruthy();
    expect(screen.queryByText(th.orders.detail.paidAt)).toBeNull();
  });

  it("does not claim items came back when nothing returned to the cart", () => {
    for (const cartReturn of [null, { capped: false, items: [] }]) {
      const { unmount } = render(
        <OrderDetailView
          order={order({
            paymentStatus: "FAILED",
            paidAt: null,
            payment: { provider: "MOCK", isSimulated: true, failureReason: "SIMULATED_DECLINE" },
            cartReturn,
          })}
        />,
      );
      const alert = screen.getByRole("alert");
      expect(within(alert).getByText(th.orders.confirmation.failedBody)).toBeTruthy();
      expect(alert.textContent).not.toContain(th.orders.detail.cartReturnBody);
      unmount();
    }
  });

  it("names the payment method with the mock label, never the raw provider", () => {
    render(<OrderDetailView order={order()} />);
    const term = screen.getByText(th.orders.detail.paymentMethod);
    expect(term.nextElementSibling?.textContent).toBe(th.orders.detail.paymentMock);
    expect(screen.queryByText("MOCK")).toBeNull();
  });

  it("explains a timeout failure and a pending payment", () => {
    const { rerender } = render(
      <OrderDetailView
        order={order({
          paymentStatus: "FAILED",
          paidAt: null,
          payment: { provider: "MOCK", isSimulated: true, failureReason: "TIMEOUT" },
        })}
      />,
    );
    expect(screen.getByText(th.orders.confirmation.failedTimeoutBody)).toBeTruthy();
    rerender(<OrderDetailView order={order({ paymentStatus: "PENDING", paidAt: null })} />);
    expect(screen.getAllByText(th.orders.confirmation.pendingTitle).length).toBeGreaterThan(0);
  });

  it("renders store, product, and recipient names through bdi", () => {
    const { container } = render(
      <OrderDetailView
        order={order({
          shippingAddress: { ...order().shippingAddress, recipientName: "<b>x</b>" },
        })}
      />,
    );
    const texts = [...container.querySelectorAll("bdi")].map((node) => node.textContent);
    expect(texts).toEqual(expect.arrayContaining(["<b>x</b>", "ร้านชา", "ชาเขียว"]));
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows a simulated shipment", () => {
    const base = order();
    render(
      <OrderDetailView
        order={order({
          sellerOrders: [
            {
              ...base.sellerOrders[0]!,
              fulfilmentStatus: "SHIPPED",
              shipment: {
                carrierName: null,
                trackingNumber: "TH123",
                isSimulated: true,
                shippedAt: "2026-10-12T03:00:00.000Z",
                deliveredAt: null,
              },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("TH123")).toBeTruthy();
    expect(screen.getByText(th.orders.detail.shipmentSimulated)).toBeTruthy();
  });
});
