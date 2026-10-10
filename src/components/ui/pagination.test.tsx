import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPaginationItems, Pagination } from "./pagination";

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
});
