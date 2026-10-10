import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildPaginationItems, normalisePage, normaliseTotalPages, Pagination } from "./pagination";

/** Values that are not a page count. `totalPages` 0 is covered separately. */
const INVALID_TOTALS = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -3,
  2.5,
  0.5,
  Number.MAX_SAFE_INTEGER + 1,
];

const labels = {
  label: "การแบ่งหน้า",
  previousLabel: "หน้าก่อนหน้า",
  nextLabel: "หน้าถัดไป",
  pageLabel: (page: number) => `หน้า ${page}`,
  hrefForPage: (page: number) => `/products?page=${page}`,
};

/** Page numbers and "…" as shown from `sm` up, and below `sm`. */
function layouts(page: number, totalPages: number) {
  const items = buildPaginationItems(page, totalPages);
  const wide = items
    .filter((item) => item.type === "page" || !item.mobileOnly)
    .map((item) => (item.type === "page" ? item.page : "…"));
  const narrow = items
    .filter((item) => item.type === "ellipsis" || !item.hideOnMobile)
    .map((item) => (item.type === "page" ? item.page : "…"));
  return { wide, narrow };
}

describe("buildPaginationItems", () => {
  it("shows every page when there are few", () => {
    expect(layouts(3, 5).wide).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses distant pages into ellipses", () => {
    expect(layouts(5, 10)).toEqual({
      wide: [1, "…", 4, 5, 6, "…", 10],
      narrow: [1, "…", 5, "…", 10],
    });
  });

  it("keeps an ellipsis below sm where neighbours are hidden", () => {
    expect(layouts(4, 7)).toEqual({
      wide: [1, 2, 3, 4, 5, 6, 7],
      narrow: [1, "…", 4, "…", 7],
    });
  });

  it("handles the first and last page", () => {
    expect(layouts(1, 10)).toEqual({ wide: [1, 2, "…", 10], narrow: [1, "…", 10] });
    expect(layouts(10, 10)).toEqual({ wide: [1, "…", 9, 10], narrow: [1, "…", 10] });
  });

  it("clamps an out-of-range page", () => {
    expect(layouts(99, 3).wide).toEqual([1, 2, 3]);
    expect(layouts(0, 3).wide).toEqual([1, 2, 3]);
  });
});

describe("Pagination", () => {
  it("marks only the current page with aria-current", () => {
    render(<Pagination {...labels} page={5} totalPages={10} />);
    const nav = screen.getByRole("navigation", { name: "การแบ่งหน้า" });
    const current = nav.querySelectorAll("[aria-current]");
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("aria-current")).toBe("page");
    expect(current[0]?.textContent).toBe("5");
    expect(screen.getByRole("link", { name: "หน้า 5" })).toBe(current[0]);
    expect(screen.getByRole("link", { name: "หน้า 4" }).getAttribute("aria-current")).toBeNull();
  });

  it("links each page, previous, and next through hrefForPage", () => {
    render(<Pagination {...labels} page={5} totalPages={10} />);
    expect(screen.getByRole("link", { name: "หน้า 10" }).getAttribute("href")).toBe(
      "/products?page=10",
    );
    expect(screen.getByRole("link", { name: "หน้าก่อนหน้า" }).getAttribute("href")).toBe(
      "/products?page=4",
    );
    expect(screen.getByRole("link", { name: "หน้าถัดไป" }).getAttribute("href")).toBe(
      "/products?page=6",
    );
  });

  it("disables previous on the first page and next on the last page", () => {
    const { unmount } = render(<Pagination {...labels} page={1} totalPages={3} />);
    const previous = screen.getByRole("link", { name: "หน้าก่อนหน้า" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.getAttribute("href")).toBeNull();
    expect(screen.getByRole("link", { name: "หน้าถัดไป" }).getAttribute("href")).toBe(
      "/products?page=2",
    );
    unmount();

    render(<Pagination {...labels} page={3} totalPages={3} />);
    const next = screen.getByRole("link", { name: "หน้าถัดไป" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.getAttribute("href")).toBeNull();
  });

  it("renders nothing when there is a single page", () => {
    const { container } = render(<Pagination {...labels} page={1} totalPages={1} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when there are no pages", () => {
    const { container } = render(<Pagination {...labels} page={1} totalPages={0} />);
    expect(container.innerHTML).toBe("");
  });

  it.each(INVALID_TOTALS)("renders nothing when totalPages is %s", (totalPages) => {
    const hrefForPage = vi.fn(labels.hrefForPage);
    const pageLabel = vi.fn(labels.pageLabel);
    const { container } = render(
      <Pagination
        {...labels}
        hrefForPage={hrefForPage}
        pageLabel={pageLabel}
        page={1}
        totalPages={totalPages}
      />,
    );
    expect(container.innerHTML).toBe("");
    expect(hrefForPage).not.toHaveBeenCalled();
    expect(pageLabel).not.toHaveBeenCalled();
  });

  it.each([
    [Number.NaN, "1"],
    [Number.POSITIVE_INFINITY, "1"],
    [Number.NEGATIVE_INFINITY, "1"],
    [2.7, "2"],
    [-4, "1"],
    [0, "1"],
    [99, "5"],
  ])("normalises the current page %s to page %s", (page, expected) => {
    const hrefForPage = vi.fn(labels.hrefForPage);
    const pageLabel = vi.fn(labels.pageLabel);
    const { container } = render(
      <Pagination
        {...labels}
        hrefForPage={hrefForPage}
        pageLabel={pageLabel}
        page={page}
        totalPages={5}
      />,
    );

    const current = container.querySelectorAll("[aria-current]");
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe(expected);

    // Nothing that reaches the screen, a label, or an href is built from the raw input.
    const links = [...container.querySelectorAll("a")];
    const shown = [
      container.textContent,
      ...links.map((link) => link.getAttribute("href")),
      ...links.map((link) => link.getAttribute("aria-label")),
    ].join(" ");
    expect(shown).not.toMatch(/NaN|Infinity|\d\.\d|-\d/);
    const pageTexts = links.map((link) => link.textContent).filter((text) => text !== "");
    expect(pageTexts.length).toBeGreaterThan(0);
    for (const text of pageTexts) expect(text).toMatch(/^[1-5]$/);
    expect(hrefForPage).toHaveBeenCalled();
    for (const call of [...hrefForPage.mock.calls, ...pageLabel.mock.calls]) {
      expect(Number.isInteger(call[0])).toBe(true);
      expect(call[0]).toBeGreaterThanOrEqual(1);
      expect(call[0]).toBeLessThanOrEqual(5);
    }
  });
});

describe("normaliseTotalPages and normalisePage", () => {
  it("accepts only a whole page count of at least 1", () => {
    expect(normaliseTotalPages(1)).toBe(1);
    expect(normaliseTotalPages(250)).toBe(250);
    for (const totalPages of [0, ...INVALID_TOTALS]) {
      expect(normaliseTotalPages(totalPages)).toBe(0);
    }
  });

  it("brings the current page into 1 to total", () => {
    expect(normalisePage(3, 5)).toBe(3);
    expect(normalisePage(Number.NaN, 5)).toBe(1);
    expect(normalisePage(Number.POSITIVE_INFINITY, 5)).toBe(1);
    expect(normalisePage(Number.NEGATIVE_INFINITY, 5)).toBe(1);
    expect(normalisePage(2.7, 5)).toBe(2);
    expect(normalisePage(-4, 5)).toBe(1);
    expect(normalisePage(99, 5)).toBe(5);
  });

  it("builds no items for an invalid page count and never an invalid page number", () => {
    for (const totalPages of [0, ...INVALID_TOTALS]) {
      expect(buildPaginationItems(1, totalPages)).toEqual([]);
    }
    for (const page of [Number.NaN, Number.POSITIVE_INFINITY, 2.7, -4]) {
      for (const item of buildPaginationItems(page, 10)) {
        if (item.type === "page") expect(Number.isSafeInteger(item.page)).toBe(true);
      }
    }
  });
});
