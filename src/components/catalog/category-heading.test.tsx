import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";

const catalog = vi.hoisted(() => ({ getCategory: vi.fn() }));
const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/modules/catalog", () => catalog);
vi.mock("next/navigation", () => nav);

import { AppError } from "@/server/errors";
import { CategoryHeading } from "./category-heading";

beforeEach(() => vi.clearAllMocks());

describe("CategoryHeading", () => {
  it("shows the category name alone inside bdi in the h1", async () => {
    catalog.getCategory.mockResolvedValue({ name: "ชา", slug: "tea" });
    const { container } = render(await CategoryHeading({ slug: "tea" }));
    expect(catalog.getCategory).toHaveBeenCalledWith("tea");
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("ชา");
    expect(h1?.querySelector("bdi")?.textContent).toBe("ชา");
  });

  it("renders markup in the name as text", async () => {
    catalog.getCategory.mockResolvedValue({ name: "<b>x</b>", slug: "tea" });
    const { container } = render(await CategoryHeading({ slug: "tea" }));
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("h1 bdi")?.textContent).toBe("<b>x</b>");
  });

  it("calls notFound for a missing category", async () => {
    catalog.getCategory.mockRejectedValue(new AppError("NOT_FOUND"));
    await expect(CategoryHeading({ slug: "nope" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toHaveBeenCalled();
  });

  it("falls back to the generic h1 on another failure", async () => {
    catalog.getCategory.mockRejectedValue(new Error("db down"));
    const { container } = render(await CategoryHeading({ slug: "tea" }));
    expect(container.querySelector("h1")?.textContent).toBe(th.catalog.categories.label);
    expect(container.querySelector("bdi")).toBeNull();
  });
});
