import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import type { SellerOrderListItemDto } from "@/modules/orders/seller-schema";
import { OrdersTable } from "./orders-table";

const order: SellerOrderListItemDto = {
  id: "so1",
  orderNumber: "OD2610110000042",
  createdAt: "2026-10-11T10:00:00.000Z",
  paymentStatus: "PAID",
  fulfilmentStatus: "PENDING",
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

describe("OrdersTable", () => {
  it("opts into the stacked layout", () => {
    render(<OrdersTable items={[order]} />);
    const region = screen.getByRole("region", { name: th.seller.orders.listLabel });
    expect(region.getAttribute("data-stacked")).toBe("true");
  });

  it("labels every data cell with its column name", () => {
    const { container } = render(<OrdersTable items={[order]} />);
    const labels = Array.from(container.querySelectorAll("tbody span[aria-hidden='true']")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      th.seller.orders.columns.placedAt,
      th.seller.orders.columns.status,
      th.seller.orders.columns.items,
      th.seller.orders.columns.subtotal,
      th.seller.orders.columns.shippingFee,
    ]);
  });
});
