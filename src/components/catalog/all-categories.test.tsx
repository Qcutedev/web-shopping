import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PAGE_SIZE } from "@/modules/catalog/schema";

const catalog = vi.hoisted(() => ({ listCategories: vi.fn() }));
vi.mock("@/modules/catalog", () => catalog);
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

import { listAllActiveCategories, MAX_CATEGORY_PAGES } from "./all-categories";
import { CategoryChips } from "./category-chips";
import { SearchFilters } from "./search-filters";

const TOTAL = MAX_PAGE_SIZE + 3;

function category(index: number) {
  return { id: `c${index}`, name: `หมวด ${index}`, slug: `cat-${index}`, isSample: false };
}

/** A paged service with `TOTAL` categories: the first page is full, the second holds the rest. */
function pagedService() {
  catalog.listCategories.mockImplementation(async (query: { page: number; pageSize: number }) => {
    const all = Array.from({ length: TOTAL }, (_, index) => category(index));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: all.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: TOTAL,
    };
  });
}

beforeEach(() => {
  catalog.listCategories.mockReset();
});

describe("listAllActiveCategories (CR-100)", () => {
  it("reads every page until the total is reached", async () => {
    pagedService();
    const all = await listAllActiveCategories();
    expect(all).toHaveLength(TOTAL);
    expect(all.at(-1)?.slug).toBe(`cat-${TOTAL - 1}`);
    expect(catalog.listCategories).toHaveBeenCalledTimes(2);
    expect(catalog.listCategories).toHaveBeenLastCalledWith({ page: 2, pageSize: MAX_PAGE_SIZE });
  });

  it("makes one request when everything fits on the first page", async () => {
    catalog.listCategories.mockResolvedValue({
      items: [category(1)],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    expect(await listAllActiveCategories()).toHaveLength(1);
    expect(catalog.listCategories).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page and never loops past the page cap", async () => {
    catalog.listCategories.mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 999 });
    expect(await listAllActiveCategories()).toEqual([]);
    expect(catalog.listCategories).toHaveBeenCalledTimes(1);

    catalog.listCategories.mockReset();
    catalog.listCategories.mockResolvedValue({
      items: [category(1)],
      page: 1,
      pageSize: 50,
      total: 1_000_000,
    });
    await listAllActiveCategories();
    expect(catalog.listCategories).toHaveBeenCalledTimes(MAX_CATEGORY_PAGES);
  });
});

describe("storefront category options reach categories after page 1 (CR-100)", () => {
  it("shows a chip for a category that is only on page 2", async () => {
    pagedService();
    render((await CategoryChips({})) ?? <></>);
    expect(screen.getByRole("link", { name: `หมวด ${TOTAL - 1}` })).toBeTruthy();
  });

  it("offers a category that is only on page 2 in the search filter select", async () => {
    pagedService();
    render(
      await SearchFilters({
        action: "/search",
        resetHref: "/search",
        sort: "newest",
        minText: "",
        maxText: "",
        errors: [],
      }),
    );
    expect(screen.getByRole("option", { name: `หมวด ${TOTAL - 1}` })).toBeTruthy();
  });
});
