import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { formatSatang } from "@/lib/format";
import type {
  CategoryDto,
  Page,
  ProductDetailDto,
  ProductListItemDto,
  ReviewDto,
} from "@/modules/catalog/schema";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CatalogInvalidFilter, CatalogLoadError } from "./catalog-load-error";
import { CategoryChipsView } from "./category-chips-view";
import { ProductCard } from "./product-card";
import { ProductDetailView } from "./product-detail-view";
import { ProductGridSkeleton } from "./product-grid";
import { ProductListView } from "./product-list-view";
import { ReviewsView } from "./reviews-view";
import { SortLinks } from "./sort-links";

function product(overrides: Partial<ProductListItemDto> = {}): ProductListItemDto {
  return {
    id: "p1",
    slug: "เสื้อ-1",
    title: "เสื้อยืดผ้าฝ้าย",
    priceSatang: 29000,
    image: null,
    soldOut: false,
    isSample: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    reviewSummary: null,
    store: { name: "ร้านตัวอย่าง", slug: "shop-a", isSample: false },
    ...overrides,
  };
}

const empty = {
  title: "ว่าง",
  description: "ไม่มีสินค้า",
  action: { href: "/", label: "กลับ" },
};

function pageOf(items: ProductListItemDto[], total: number, page = 1): Page<ProductListItemDto> {
  return { items, page, pageSize: 20, total };
}

describe("ProductCard", () => {
  it("is one link to the encoded product path with title, store, and price from the server", () => {
    render(<ProductCard product={product()} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(`/products/${encodeURIComponent("เสื้อ-1")}`);
    expect(within(link).getByRole("heading", { name: "เสื้อยืดผ้าฝ้าย" })).toBeTruthy();
    expect(within(link).getByText("ร้านตัวอย่าง")).toBeTruthy();
    expect(within(link).getByText(formatSatang(29000))).toBeTruthy();
    expect(screen.queryByText(th.catalog.soldOut)).toBeNull();
  });

  it("marks a sold-out product with text and a sample product with the sample label", () => {
    render(<ProductCard product={product({ soldOut: true, isSample: true })} />);
    expect(screen.getByText(th.catalog.soldOut)).toBeTruthy();
    expect(screen.getByText(th.notice.sampleData)).toBeTruthy();
  });

  it("isolates the store name for bidirectional text", () => {
    const { container } = render(<ProductCard product={product()} />);
    const bdis = [...container.querySelectorAll("bdi")].map((node) => node.textContent);
    expect(bdis).toEqual(["เสื้อยืดผ้าฝ้าย", "ร้านตัวอย่าง"]);
  });

  it("renders markup in a title as text", () => {
    const { container } = render(
      <ProductCard product={product({ title: "<img src=x onerror=alert(1)>" })} />,
    );
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("ProductListView", () => {
  const href = (page: number) => `/search?page=${page}`;

  it("success: lists products and the count, with a pager when there is more than one page", () => {
    render(
      <ProductListView
        data={pageOf([product(), product({ id: "p2", slug: "b" })], 45)}
        hrefForPage={href}
        empty={empty}
        showCount
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("พบสินค้า 45 รายการ");
    expect(screen.getByRole("list", { name: th.catalog.productListLabel })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: th.pagination.label })).toBeTruthy();
  });

  it("empty: shows the message and one next action", () => {
    render(<ProductListView data={pageOf([], 0)} hrefForPage={href} empty={empty} />);
    expect(screen.getByText("ว่าง")).toBeTruthy();
    expect(screen.getByRole("link", { name: "กลับ" }).getAttribute("href")).toBe("/");
  });

  it("past the last page: links back to page 1", () => {
    render(<ProductListView data={pageOf([], 5, 9)} hrefForPage={href} empty={empty} />);
    expect(screen.getByText(th.catalog.list.pageEmptyTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.catalog.list.pageEmptyAction }).getAttribute("href"),
    ).toBe("/search?page=1");
  });
});

describe("loading and error states", () => {
  it("skeleton announces loading", () => {
    render(<ProductGridSkeleton count={2} />);
    expect(screen.getByRole("status").textContent).toBe(th.catalog.loading);
  });

  it("error: alert with Thai copy and a retry link", () => {
    render(<CatalogLoadError retryHref="/search?q=a" />);
    expect(screen.getByRole("alert").textContent).toContain(th.errors.loadFailed);
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/search?q=a",
    );
  });

  it("invalid filter: alert and a reset link", () => {
    render(<CatalogInvalidFilter resetHref="/search" />);
    expect(screen.getByRole("alert").textContent).toContain(th.catalog.filterInvalid);
  });
});

describe("SortLinks and CategoryChipsView", () => {
  it("marks the current sort and links each order", () => {
    render(<SortLinks current="price_asc" hrefForSort={(s) => `/search?sort=${s}`} />);
    const current = screen.getByRole("link", { name: th.catalog.sort.price_asc });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("lists categories and marks the one being viewed; renders nothing when empty", () => {
    const categories: CategoryDto[] = [
      { id: "c1", name: "เสื้อผ้า", slug: "clothes", isSample: true },
      { id: "c2", name: "ชา", slug: "tea", isSample: true },
    ];
    const { container, rerender } = render(
      <CategoryChipsView categories={categories} currentSlug="tea" />,
    );
    expect(screen.getByRole("link", { name: "ชา" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "เสื้อผ้า" }).getAttribute("href")).toBe(
      "/categories/clothes",
    );
    rerender(<CategoryChipsView categories={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("ProductDetailView", () => {
  const detail: ProductDetailDto = {
    id: "p1",
    slug: "shirt",
    title: "เสื้อยืดผ้าฝ้าย",
    description: "บรรทัดแรก\nบรรทัดสอง <b>x</b>",
    priceSatang: 129900,
    stock: 3,
    soldOut: false,
    images: [{ key: "k1", url: "/api/files/k1" }],
    category: { name: "เสื้อผ้า", slug: "clothes" },
    store: { name: "ร้านตัวอย่าง", slug: "shop-a", isSample: true },
    reviewSummary: { averageRating: 4.5, count: 2 },
    isSample: true,
  };

  it("shows h1, price, labels, store link, and the rating summary", () => {
    const { container } = render(<ProductDetailView product={detail} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("เสื้อยืดผ้าฝ้าย");
    expect(screen.getByText(formatSatang(129900))).toBeTruthy();
    expect(screen.getAllByText(th.notice.sampleData).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "ร้านตัวอย่าง" }).getAttribute("href")).toBe(
      "/stores/shop-a",
    );
    expect(screen.getByText("คะแนน 4.5 จาก 5 (2 รีวิว)")).toBeTruthy();
    expect(container.querySelector("a bdi")?.textContent).toBe("ร้านตัวอย่าง");
    expect(screen.getByRole("img").getAttribute("alt")).toBe(
      `${String.fromCodePoint(0x2068)}เสื้อยืดผ้าฝ้าย${String.fromCodePoint(0x2069)} รูปที่ 1 จาก 1`,
    );
  });

  it("renders the description as text, not markup", () => {
    const { container } = render(<ProductDetailView product={detail} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>x</b>");
  });

  it("marks sold out, and omits the rating row when there are no reviews", () => {
    render(<ProductDetailView product={{ ...detail, soldOut: true, reviewSummary: null }} />);
    expect(screen.getByText(th.catalog.soldOut)).toBeTruthy();
    expect(screen.queryByText(/คะแนน/)).toBeNull();
  });

  it("has a placeholder, not a broken image, when the product has no picture", () => {
    render(<ProductDetailView product={{ ...detail, images: [] }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(th.catalog.noImage)).toBeTruthy();
  });
});

describe("ReviewsView", () => {
  it("lists rating, plain-text comment, and date; says so when there are none", () => {
    const reviews: ReviewDto[] = [
      { id: "r1", rating: 5, comment: "<script>x</script>", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "r2", rating: 3, comment: null, createdAt: "2026-10-02T00:00:00.000Z" },
    ];
    const { container, rerender } = render(<ReviewsView reviews={reviews} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>x</script>")).toBeTruthy();
    expect(screen.getByText(th.catalog.product.noComment)).toBeTruthy();
    rerender(<ReviewsView reviews={[]} />);
    expect(screen.getByText(th.catalog.product.reviewsEmpty)).toBeTruthy();
  });
});
