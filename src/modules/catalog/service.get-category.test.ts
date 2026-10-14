/**
 * `getCategory` with the repository replaced: what the service decides on top of the read
 * (the 404 for a missing row, the response shape). Which rows the read finds (active only) is
 * covered against a real database in tests/integration/catalog.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { findActiveCategoryBySlug } from "./repository";
import { getCategory } from "./service";

vi.mock("./repository", () => ({
  findActiveCategories: vi.fn(),
  findActiveCategoryBySlug: vi.fn(),
  findActiveCategoryIdBySlug: vi.fn(),
  findPublicStoreBySlug: vi.fn(),
  findPublicStoreIdBySlug: vi.fn(),
  findReviewsOfVisibleProduct: vi.fn(),
  findVisibleProductBySlug: vi.fn(),
  findVisibleProducts: vi.fn(),
}));

const findMock = vi.mocked(findActiveCategoryBySlug);

beforeEach(() => {
  findMock.mockReset();
});

describe("getCategory", () => {
  it("returns the name and slug of the row the repository found", async () => {
    findMock.mockResolvedValue({ name: "เครื่องครัว", slug: "kitchen" });
    await expect(getCategory("kitchen")).resolves.toEqual({ name: "เครื่องครัว", slug: "kitchen" });
    expect(findMock).toHaveBeenCalledTimes(1);
    expect(findMock).toHaveBeenCalledWith("kitchen");
  });

  it("is NOT_FOUND (404, empty details) when no active category has the slug", async () => {
    findMock.mockResolvedValue(null);
    const error = await getCategory("hidden").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404, details: {} });
  });

  it("passes a repository failure on unchanged", async () => {
    const failure = new Error("connection lost");
    findMock.mockRejectedValue(failure);
    await expect(getCategory("kitchen")).rejects.toBe(failure);
  });
});
