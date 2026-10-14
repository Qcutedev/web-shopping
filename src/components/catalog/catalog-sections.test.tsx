import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import type { ProductDetailDto } from "@/modules/catalog/schema";
import { AppError } from "@/server/errors";

const catalog = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getStore: vi.fn(),
  listCategories: vi.fn(),
  listProductReviews: vi.fn(),
}));
vi.mock("@/modules/catalog", () => catalog);

const NOT_FOUND_SIGNAL = new Error("NEXT_NOT_FOUND");
const FRAMEWORK_SIGNAL = Object.assign(new Error("framework signal"), { framework: true });
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND_SIGNAL;
  },
  unstable_rethrow: (error: unknown) => {
    if ((error as { framework?: boolean }).framework === true) throw error;
  },
}));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

import { CategoryChips } from "./category-chips";
import { ProductDetailSection } from "./product-detail-section";
import { ProductListSection } from "./product-list-section";
import { ReviewsSection } from "./reviews-section";
import { StoreSection } from "./store-section";

const query = { page: 1, pageSize: 20, sort: "newest" as const };
const notFoundError = () => new AppError("NOT_FOUND");
const internalError = () =>
  new AppError("INTERNAL_ERROR", { cause: new Error("db password=secret") });

/** Server Components are async functions: await the element, then render it. */
async function renderSection(section: Promise<ReactElement | null>) {
  return render((await section) ?? <></>);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ProductDetailSection", () => {
  const detail: ProductDetailDto = {
    id: "p1",
    slug: "shirt",
    title: "เสื้อ",
    description: "d",
    priceSatang: 100,
    stock: 1,
    soldOut: false,
    images: [],
    category: { name: "เสื้อผ้า", slug: "clothes" },
    store: { name: "ร้าน", slug: "shop", isSample: false },
    reviewSummary: null,
    isSample: false,
  };

  it("NOT_FOUND calls notFound", async () => {
    catalog.getProduct.mockRejectedValue(notFoundError());
    await expect(ProductDetailSection({ slug: "x" })).rejects.toBe(NOT_FOUND_SIGNAL);
  });

  it("other failure: alert with generic copy, no error message, retry link", async () => {
    catalog.getProduct.mockRejectedValue(internalError());
    await renderSection(ProductDetailSection({ slug: "x" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(th.errors.loadFailed);
    expect(alert.textContent).not.toContain("password");
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/products/x",
    );
  });

  it("rethrows a framework signal", async () => {
    catalog.getProduct.mockRejectedValue(FRAMEWORK_SIGNAL);
    await expect(ProductDetailSection({ slug: "x" })).rejects.toBe(FRAMEWORK_SIGNAL);
  });

  it("success: returns the product view", async () => {
    catalog.getProduct.mockResolvedValue(detail);
    const element = await ProductDetailSection({ slug: "shirt" });
    expect(element).toBeTruthy();
    expect(catalog.getProduct).toHaveBeenCalledWith("shirt");
  });
});

describe("StoreSection", () => {
  it("NOT_FOUND calls notFound", async () => {
    catalog.getStore.mockRejectedValue(notFoundError());
    await expect(StoreSection({ slug: "x", query })).rejects.toBe(NOT_FOUND_SIGNAL);
  });

  it("other failure: alert with generic copy and no error message", async () => {
    catalog.getStore.mockRejectedValue(internalError());
    await renderSection(StoreSection({ slug: "x", query }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(th.errors.loadFailed);
    expect(alert.textContent).not.toContain("password");
  });

  it("rethrows a framework signal", async () => {
    catalog.getStore.mockRejectedValue(FRAMEWORK_SIGNAL);
    await expect(StoreSection({ slug: "x", query })).rejects.toBe(FRAMEWORK_SIGNAL);
  });
});

describe("ProductListSection", () => {
  const props = {
    hrefForPage: (page: number) => `/search?page=${page}`,
    retryHref: "/search",
    empty: { title: "ว่าง", description: "d", action: { href: "/", label: "กลับ" } },
  };

  it("NOT_FOUND calls notFound", async () => {
    await expect(
      ProductListSection({ ...props, load: () => Promise.reject(notFoundError()) }),
    ).rejects.toBe(NOT_FOUND_SIGNAL);
  });

  it("other failure: alert, generic copy, no message, retry link", async () => {
    await renderSection(
      ProductListSection({ ...props, load: () => Promise.reject(internalError()) }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(th.errors.loadFailed);
    expect(alert.textContent).not.toContain("password");
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/search",
    );
  });

  it("rethrows a framework signal", async () => {
    await expect(
      ProductListSection({ ...props, load: () => Promise.reject(FRAMEWORK_SIGNAL) }),
    ).rejects.toBe(FRAMEWORK_SIGNAL);
  });
});

describe("CategoryChips", () => {
  it("failed read renders nothing", async () => {
    catalog.listCategories.mockRejectedValue(internalError());
    expect(await CategoryChips({})).toBeNull();
  });

  it("rethrows a framework signal", async () => {
    catalog.listCategories.mockRejectedValue(FRAMEWORK_SIGNAL);
    await expect(CategoryChips({})).rejects.toBe(FRAMEWORK_SIGNAL);
  });
});

describe("ReviewsSection", () => {
  it("failed read shows the reviews-failed note", async () => {
    catalog.listProductReviews.mockRejectedValue(internalError());
    await renderSection(ReviewsSection({ slug: "x" }));
    expect(screen.getByRole("alert").textContent).toBe(th.catalog.product.reviewsFailed);
  });

  it("NOT_FOUND calls notFound", async () => {
    catalog.listProductReviews.mockRejectedValue(notFoundError());
    await expect(ReviewsSection({ slug: "x" })).rejects.toBe(NOT_FOUND_SIGNAL);
  });

  it("rethrows a framework signal", async () => {
    catalog.listProductReviews.mockRejectedValue(FRAMEWORK_SIGNAL);
    await expect(ReviewsSection({ slug: "x" })).rejects.toBe(FRAMEWORK_SIGNAL);
  });
});
