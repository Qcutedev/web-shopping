import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import type { SellerProductDto } from "@/modules/inventory/schema";
import { ProductsTable } from "./products-table";

const product: SellerProductDto = {
  id: "p1",
  slug: "s",
  title: "เสื้อยืด",
  description: "รายละเอียด",
  sku: "SKU-1",
  category: { id: "c1", name: "แฟชั่น", isActive: true },
  priceSatang: 25_900,
  stock: 4,
  lowStock: true,
  soldOut: false,
  status: "PUBLISHED",
  moderationStatus: "APPROVED",
  moderationNote: null,
  images: [],
  isSample: false,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

describe("ProductsTable", () => {
  it("opts into the stacked layout", () => {
    render(<ProductsTable items={[product]} />);
    const region = screen.getByRole("region", { name: th.seller.products.listLabel });
    expect(region.getAttribute("data-stacked")).toBe("true");
  });

  it("labels every data cell with its column name", () => {
    const { container } = render(<ProductsTable items={[product]} />);
    const labels = Array.from(container.querySelectorAll("tbody span[aria-hidden='true']")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      th.seller.products.columns.status,
      th.seller.products.columns.price,
      th.seller.products.columns.stock,
    ]);
  });
});
