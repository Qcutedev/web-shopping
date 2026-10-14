import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import { FilterForm } from "./filter-form";

const base = {
  action: "/search",
  resetHref: "/search?q=a",
  sort: "newest" as const,
  minText: "",
  maxText: "",
  errors: [],
};

describe("FilterForm", () => {
  it("is a GET form with labelled price inputs and no category select by default", () => {
    const { container } = render(<FilterForm {...base} />);
    const form = container.querySelector("form");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/search");
    expect(screen.getByLabelText(th.catalog.filter.minPrice)).toHaveProperty("name", "minPrice");
    expect(screen.getByLabelText(th.catalog.filter.maxPrice)).toHaveProperty("name", "maxPrice");
    expect(screen.queryByLabelText(th.catalog.filter.category)).toBeNull();
    expect(container.querySelector('input[type="hidden"]')).toBeNull();
    expect(screen.getByRole("link", { name: th.catalog.filter.reset }).getAttribute("href")).toBe(
      "/search?q=a",
    );
  });

  it("preserves q and a non-default sort as hidden fields", () => {
    const { container } = render(<FilterForm {...base} q="กาแฟ" sort="price_asc" />);
    const hidden = [...container.querySelectorAll('input[type="hidden"]')].map(
      (input) => `${input.getAttribute("name")}=${input.getAttribute("value")}`,
    );
    expect(hidden).toEqual(["q=กาแฟ", "sort=price_asc"]);
  });

  it("renders the category select with the current one chosen", () => {
    render(
      <FilterForm
        {...base}
        category="tea"
        categories={[
          { id: "1", name: "กาแฟ", slug: "coffee" } as never,
          { id: "2", name: "ชา", slug: "tea" } as never,
        ]}
      />,
    );
    const select = screen.getByLabelText(th.catalog.filter.category) as HTMLSelectElement;
    expect(select.name).toBe("category");
    expect(select.value).toBe("tea");
    expect(screen.getByRole("option", { name: th.catalog.filter.categoryAll })).toBeTruthy();
  });

  it("keeps a store category as a hidden field", () => {
    const { container } = render(<FilterForm {...base} category="tea" />);
    expect(container.querySelector('input[name="category"]')?.getAttribute("value")).toBe("tea");
  });

  it("keeps the category as a hidden field when the categories failed to load", () => {
    const { container } = render(<FilterForm {...base} category="tea" categories={[]} />);
    const field = container.querySelectorAll('input[name="category"]');
    expect(field).toHaveLength(1);
    expect(field[0]?.getAttribute("type")).toBe("hidden");
    expect(field[0]?.getAttribute("value")).toBe("tea");
    expect(screen.queryByLabelText(th.catalog.filter.category)).toBeNull();
  });

  it("keeps a current category that is not among the options", () => {
    const { container } = render(
      <FilterForm
        {...base}
        category="stale"
        categories={[{ id: "1", name: "กาแฟ", slug: "coffee", isSample: false }]}
      />,
    );
    const select = screen.getByLabelText(th.catalog.filter.category) as HTMLSelectElement;
    expect(select.value).toBe("stale");
    expect(container.querySelectorAll('input[name="category"]')).toHaveLength(0);
  });

  it("shows typed values and Thai error text tied to the control", () => {
    render(<FilterForm {...base} minText="abc" maxText="5" errors={["min-invalid"]} />);
    const min = screen.getByLabelText(th.catalog.filter.minPrice);
    expect((min as HTMLInputElement).value).toBe("abc");
    expect(min.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText(th.catalog.filter.minInvalid).length).toBeGreaterThan(0);
  });

  it("announces errors in an alert summary", () => {
    render(<FilterForm {...base} errors={["min-invalid"]} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(th.catalog.filter.errorSummary);
    expect(alert.textContent).toContain(th.catalog.filter.minInvalid);
  });

  it("shows no alert without errors", () => {
    render(<FilterForm {...base} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks both price fields invalid on a range error", () => {
    render(<FilterForm {...base} minText="500" maxText="100" errors={["range"]} />);
    expect(screen.getByLabelText(th.catalog.filter.minPrice).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByLabelText(th.catalog.filter.maxPrice).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getAllByText(th.catalog.filter.range).length).toBeGreaterThan(0);
  });
});
