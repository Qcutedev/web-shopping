import { render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import type {
  CategoryDto,
  Page,
  ProductDetailDto,
  ProductListItemDto,
  StoreDto,
} from "@/modules/catalog/schema";
import { AppError } from "@/server/errors";

// T-021 page-level tests (CR-T021-03). The pages are real; the catalog module is mocked at its
// boundary, so no Prisma client and no database. Async Server Components cannot render in jsdom,
// so `resolve` expands them into plain elements first.
const catalog = vi.hoisted(() => ({
  getCategory: vi.fn(),
  getProduct: vi.fn(),
  getStore: vi.fn(),
  listCategories: vi.fn(),
  listProductReviews: vi.fn(),
  listProducts: vi.fn(),
  listStoreProducts: vi.fn(),
}));
vi.mock("@/modules/catalog", () => catalog);

const NOT_FOUND_SIGNAL = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND_SIGNAL;
  },
  unstable_rethrow: () => undefined,
}));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

import HomePage from "./page";
import ProductPage from "./products/[slug]/page";
import CategoryPage from "./categories/[slug]/page";
import SearchPage from "./search/page";
import StorePage from "./stores/[slug]/page";

type Search = Record<string, string | string[] | undefined>;

/**
 * Replaces every Server Component in the tree with what it returns. A Suspense boundary is replaced
 * by its children (the fallback is the loading state, not under test). A component that cannot be
 * called outside React (it uses a hook) stays as an element and is rendered normally.
 */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolve(child as ReactNode)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  const type = element.type as unknown;
  if (type === Suspense) return resolve(element.props.children);
  if (typeof type === "function") {
    try {
      const out = await (type as (props: unknown) => ReactNode | Promise<ReactNode>)(element.props);
      return resolve(out);
    } catch (error) {
      if (error === NOT_FOUND_SIGNAL || error instanceof AppError) throw error;
      // Hook outside render: leave it for the renderer.
    }
  }
  const children = element.props.children;
  if (children === undefined) return element;
  const expanded = await resolve(children);
  return { ...element, props: { ...element.props, children: expanded } } as ReactElement;
}

async function renderPage(page: ReactElement) {
  return render(<>{await resolve(page)}</>);
}

const hrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));

const item = (n: number, over: Partial<ProductListItemDto> = {}): ProductListItemDto => ({
  id: `p${n}`,
  slug: `product-${n}`,
  title: `สินค้า ${n}`,
  priceSatang: 12_500,
  image: null,
  soldOut: false,
  isSample: false,
  store: { name: "ร้านชา", slug: "tea-shop", isSample: false },
  ...over,
});
const pageOf = (
  items: ProductListItemDto[],
  total: number,
  page = 1,
): Page<ProductListItemDto> => ({
  items,
  page,
  pageSize: 20,
  total,
});
const categories: CategoryDto[] = [
  { id: "c1", name: "ชา", slug: "tea", isSample: false },
  { id: "c2", name: "กาแฟ", slug: "coffee", isSample: false },
];
const store: StoreDto = {
  id: "s1",
  name: "ร้านชา",
  slug: "tea-shop",
  description: "ขายชา",
  logo: { key: "k", url: "/api/files/k" },
  isSample: false,
};
const detail: ProductDetailDto = {
  id: "p1",
  slug: "green-tea",
  title: "ชาเขียว",
  description: "ชาเขียวคุณภาพ",
  priceSatang: 12_500,
  stock: 3,
  soldOut: false,
  images: [],
  category: { name: "ชา", slug: "tea" },
  store: { name: "ร้านชา", slug: "tea-shop", isSample: false },
  reviewSummary: null,
  isSample: false,
};

const notFound = () => new AppError("NOT_FOUND");
const internal = () => new AppError("INTERNAL_ERROR", { cause: new Error("db password=secret") });
const slugParams = (slug: string) => Promise.resolve({ slug });
const searchParams = (value: Search = {}) => Promise.resolve(value);

beforeEach(() => {
  vi.resetAllMocks();
  catalog.listCategories.mockResolvedValue({ items: categories, page: 1, pageSize: 50, total: 2 });
  catalog.listProductReviews.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
});

describe("home page", () => {
  it("loaded: products link to their pages, chips link to categories, newest order requested", async () => {
    catalog.listProducts.mockResolvedValue(pageOf([item(1), item(2)], 2));
    const { container } = await renderPage(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(th.catalog.home.newestTitle);
    expect(screen.getByText("สินค้า 1")).toBeTruthy();
    const all = hrefs(container);
    expect(all).toContain("/products/product-1");
    expect(all).toContain("/products/product-2");
    expect(all).toContain("/categories/tea");
    expect(catalog.listProducts).toHaveBeenCalledWith({ page: 1, pageSize: 20, sort: "newest" });
  });

  it("empty: shows the empty state, no product links", async () => {
    catalog.listProducts.mockResolvedValue(pageOf([], 0));
    const { container } = await renderPage(<HomePage />);
    expect(screen.getByText(th.catalog.home.emptyTitle)).toBeTruthy();
    expect(hrefs(container).some((href) => href?.startsWith("/products/"))).toBe(false);
  });

  it("error: generic alert without the error message, retry goes home; chips still render", async () => {
    catalog.listProducts.mockRejectedValue(internal());
    const { container } = await renderPage(<HomePage />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(th.errors.loadFailed);
    expect(container.textContent).not.toContain("password");
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe("/");
    expect(hrefs(container)).toContain("/categories/tea");
  });

  it("categories failing does not break the product list", async () => {
    catalog.listCategories.mockRejectedValue(internal());
    catalog.listProducts.mockResolvedValue(pageOf([item(1)], 1));
    const { container } = await renderPage(<HomePage />);
    expect(screen.getByText("สินค้า 1")).toBeTruthy();
    expect(hrefs(container)).not.toContain("/categories/tea");
  });
});

describe("search page", () => {
  it("loaded: every filter reaches the service and every sort and page link keeps them", async () => {
    catalog.listProducts.mockResolvedValue(pageOf([item(1)], 45));
    const { container } = await renderPage(
      <SearchPage
        searchParams={searchParams({ q: "ชา", category: "tea", minPrice: "10", sort: "price_asc" })}
      />,
    );
    expect(catalog.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "ชา",
        category: "tea",
        minPriceSatang: 1000,
        sort: "price_asc",
        page: 1,
      }),
    );
    const all = hrefs(container);
    const q = "q=%E0%B8%8A%E0%B8%B2";
    // Sort link for another order keeps q, category and price, and resets the page.
    expect(all).toContain(`/search?${q}&category=tea&minPriceSatang=1000`);
    // Page 2 keeps the current sort too.
    expect(all).toContain(`/search?${q}&category=tea&minPriceSatang=1000&sort=price_asc&page=2`);
    expect(all).toContain("/products/product-1");
  });

  it("empty: shows the no-results state with a link home", async () => {
    catalog.listProducts.mockResolvedValue(pageOf([], 0));
    await renderPage(<SearchPage searchParams={searchParams({ q: "zzz" })} />);
    expect(screen.getByText(th.catalog.search.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.notFound.backHome }).getAttribute("href")).toBe("/");
  });

  it("error: generic alert, retry link keeps the filters", async () => {
    catalog.listProducts.mockRejectedValue(internal());
    const { container } = await renderPage(
      <SearchPage searchParams={searchParams({ q: "a", category: "tea", page: "2" })} />,
    );
    expect(screen.getByRole("alert").textContent).toContain(th.errors.loadFailed);
    expect(container.textContent).not.toContain("password");
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/search?q=a&category=tea&page=2",
    );
  });

  it("invalid query: filter-invalid state, service not called", async () => {
    await renderPage(<SearchPage searchParams={searchParams({ sort: "bogus" })} />);
    expect(screen.getByText(th.catalog.filterInvalidTitle)).toBeTruthy();
    expect(catalog.listProducts).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/search",
    );
  });

  it("search term sits in bdi inside the heading (SEC-033)", async () => {
    catalog.listProducts.mockResolvedValue(pageOf([item(1)], 1));
    const { container } = await renderPage(
      <SearchPage searchParams={searchParams({ q: `x${String.fromCodePoint(0x202e)}y` })} />,
    );
    const heading = container.querySelector("h1");
    expect(heading?.querySelector("bdi")).not.toBeNull();
    expect(heading?.textContent).toContain(th.catalog.search.resultsForPrefix);
  });
});

describe("category page", () => {
  it("loaded: category comes from the path, links keep price and sort", async () => {
    catalog.listProducts.mockResolvedValue(pageOf([item(1)], 45));
    const { container } = await renderPage(
      <CategoryPage
        params={slugParams("tea")}
        searchParams={searchParams({ minPrice: "10", sort: "price_asc", category: "coffee" })}
      />,
    );
    // A category in the query string must not override the path.
    expect(catalog.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: "tea", minPriceSatang: 1000, sort: "price_asc" }),
    );
    const all = hrefs(container);
    expect(all).toContain("/categories/tea?minPriceSatang=1000");
    expect(all).toContain("/categories/tea?minPriceSatang=1000&sort=price_asc&page=2");
    expect(all.some((href) => href?.includes("category=coffee"))).toBe(false);
  });

  it("empty: shows the empty state", async () => {
    catalog.listProducts.mockResolvedValue(pageOf([], 0));
    await renderPage(<CategoryPage params={slugParams("tea")} searchParams={searchParams()} />);
    expect(screen.getByText(th.catalog.category.emptyTitle)).toBeTruthy();
  });

  it("error: alert and retry link to the same category and page", async () => {
    catalog.listProducts.mockRejectedValue(internal());
    await renderPage(
      <CategoryPage params={slugParams("tea")} searchParams={searchParams({ page: "3" })} />,
    );
    expect(screen.getByRole("alert").textContent).toContain(th.errors.loadFailed);
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/categories/tea?page=3",
    );
  });

  it("missing category: page returns normally (HTTP 200, D-039) and the section signals not-found", async () => {
    catalog.listProducts.mockRejectedValue(notFound());
    const page = <CategoryPage params={slugParams("nope")} searchParams={searchParams()} />;
    expect(isValidElement(page)).toBe(true);
    await expect(resolve(page)).rejects.toBe(NOT_FOUND_SIGNAL);
  });

  it("heading: h1 is the category name from getCategory", async () => {
    catalog.getCategory.mockResolvedValue(categories[0]);
    catalog.listProducts.mockResolvedValue(pageOf([item(1)], 1));
    const { container } = await renderPage(
      <CategoryPage params={slugParams("tea")} searchParams={searchParams()} />,
    );
    expect(catalog.getCategory).toHaveBeenCalledWith("tea");
    expect(container.querySelector("h1")?.textContent).toBe("ชา");
  });

  it("heading: unknown category is the not-found signal", async () => {
    catalog.getCategory.mockRejectedValue(notFound());
    catalog.listProducts.mockResolvedValue(pageOf([item(1)], 1));
    await expect(
      resolve(<CategoryPage params={slugParams("nope")} searchParams={searchParams()} />),
    ).rejects.toBe(NOT_FOUND_SIGNAL);
  });

  it("heading: read failure keeps the list and the generic h1", async () => {
    catalog.getCategory.mockRejectedValue(internal());
    catalog.listProducts.mockResolvedValue(pageOf([item(1)], 1));
    const { container } = await renderPage(
      <CategoryPage params={slugParams("tea")} searchParams={searchParams()} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe(th.catalog.categories.label);
    expect(screen.getByText("สินค้า 1")).toBeTruthy();
    expect(container.textContent).not.toContain("password");
  });

  it("malformed slug: not-found without calling the service", async () => {
    await expect(
      resolve(<CategoryPage params={slugParams("%zz")} searchParams={searchParams()} />),
    ).rejects.toBe(NOT_FOUND_SIGNAL);
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });
});

describe("store page", () => {
  it("loaded: name, logo, sort links and page links keep filters; store slug goes to the service", async () => {
    catalog.getStore.mockResolvedValue(store);
    catalog.listStoreProducts.mockResolvedValue(pageOf([item(1)], 45));
    const { container } = await renderPage(
      <StorePage
        params={slugParams("tea-shop")}
        searchParams={searchParams({ q: "a", maxPrice: "50.5", sort: "price_desc" })}
      />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("ร้านชา");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(catalog.listStoreProducts).toHaveBeenCalledWith(
      "tea-shop",
      expect.objectContaining({ q: "a", maxPriceSatang: 5050, sort: "price_desc" }),
    );
    const all = hrefs(container);
    expect(all).toContain("/stores/tea-shop?q=a&maxPriceSatang=5050");
    expect(all).toContain("/stores/tea-shop?q=a&maxPriceSatang=5050&sort=price_desc&page=2");
  });

  it("empty store: empty state", async () => {
    catalog.getStore.mockResolvedValue({ ...store, logo: null });
    catalog.listStoreProducts.mockResolvedValue(pageOf([], 0));
    const { container } = await renderPage(
      <StorePage params={slugParams("tea-shop")} searchParams={searchParams()} />,
    );
    expect(screen.getByText(th.catalog.store.emptyTitle)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("product list failure: alert with retry to the store, header still shown", async () => {
    catalog.getStore.mockResolvedValue(store);
    catalog.listStoreProducts.mockRejectedValue(internal());
    const { container } = await renderPage(
      <StorePage params={slugParams("tea-shop")} searchParams={searchParams()} />,
    );
    expect(screen.getByRole("alert").textContent).toContain(th.errors.loadFailed);
    expect(container.querySelector("h1")?.textContent).toBe("ร้านชา");
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/stores/tea-shop",
    );
  });

  it("store read failure: alert, no message leaked", async () => {
    catalog.getStore.mockRejectedValue(internal());
    const { container } = await renderPage(
      <StorePage params={slugParams("tea-shop")} searchParams={searchParams()} />,
    );
    expect(screen.getByRole("alert").textContent).toContain(th.errors.loadFailed);
    expect(container.textContent).not.toContain("password");
  });

  it("missing store: not-found signal, product list never read", async () => {
    catalog.getStore.mockRejectedValue(notFound());
    await expect(
      resolve(<StorePage params={slugParams("nope")} searchParams={searchParams()} />),
    ).rejects.toBe(NOT_FOUND_SIGNAL);
    expect(catalog.listStoreProducts).not.toHaveBeenCalled();
  });

  it("invalid query: filter-invalid state with a reset link to the store", async () => {
    await renderPage(
      <StorePage params={slugParams("tea-shop")} searchParams={searchParams({ sort: "bogus" })} />,
    );
    expect(screen.getByText(th.catalog.filterInvalidTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/stores/tea-shop",
    );
    expect(catalog.getStore).not.toHaveBeenCalled();
  });
});

describe("product detail page", () => {
  it("loaded: title, price and store link; reviews read for the product slug", async () => {
    catalog.getProduct.mockResolvedValue(detail);
    const { container } = await renderPage(<ProductPage params={slugParams("green-tea")} />);
    expect(container.textContent).toContain("ชาเขียว");
    expect(container.textContent).toContain("ชาเขียวคุณภาพ");
    expect(hrefs(container)).toContain("/stores/tea-shop");
    expect(catalog.getProduct).toHaveBeenCalledWith("green-tea");
    expect(catalog.listProductReviews).toHaveBeenCalled();
    expect(catalog.listProductReviews.mock.calls[0]?.[0]).toBe("green-tea");
  });

  it("reviews failing: product still shown with the reviews-failed note", async () => {
    catalog.getProduct.mockResolvedValue(detail);
    catalog.listProductReviews.mockRejectedValue(internal());
    const { container } = await renderPage(<ProductPage params={slugParams("green-tea")} />);
    expect(container.textContent).toContain("ชาเขียว");
    expect(container.textContent).toContain(th.catalog.product.reviewsFailed);
  });

  it("product read failure: alert, retry to the product, no message leaked", async () => {
    catalog.getProduct.mockRejectedValue(internal());
    const { container } = await renderPage(<ProductPage params={slugParams("green-tea")} />);
    expect(screen.getByRole("alert").textContent).toContain(th.errors.loadFailed);
    expect(container.textContent).not.toContain("password");
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/products/green-tea",
    );
  });

  it("hidden or missing product: not-found signal", async () => {
    catalog.getProduct.mockRejectedValue(notFound());
    await expect(resolve(<ProductPage params={slugParams("gone")} />)).rejects.toBe(
      NOT_FOUND_SIGNAL,
    );
  });

  it("malformed slug: not-found without reading the product", async () => {
    await expect(resolve(<ProductPage params={slugParams("%zz")} />)).rejects.toBe(
      NOT_FOUND_SIGNAL,
    );
    expect(catalog.getProduct).not.toHaveBeenCalled();
  });
});
