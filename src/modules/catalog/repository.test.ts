/**
 * Shape of the queries the repository sends, with the database client replaced. The rows a
 * query returns are covered against a real database in tests/integration/catalog.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const aggregate = vi.fn();
const count = vi.fn();
const findMany = vi.fn();

vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  return {
    ...actual,
    db: {
      product: { findFirst: (...args: unknown[]) => findFirst(...args) },
      review: {
        aggregate: (...args: unknown[]) => aggregate(...args),
        count: (...args: unknown[]) => count(...args),
        findMany: (...args: unknown[]) => findMany(...args),
      },
    },
  };
});

const { findVisibleProductBySlug, findReviewsOfVisibleProduct } = await import("./repository");
const { MAX_PRODUCT_IMAGES } = await import("./schema");

beforeEach(() => {
  findFirst.mockReset();
  aggregate.mockReset();
  count.mockReset();
  findMany.mockReset();
});

describe("public review reads exclude hidden reviews (SEC-092)", () => {
  it("the rating aggregate filters hiddenAt: null", async () => {
    findFirst.mockResolvedValue({ id: "prod-1" });
    aggregate.mockResolvedValue({ _count: { _all: 2 }, _sum: { rating: 9 } });
    const result = await findVisibleProductBySlug("p-1");
    expect(aggregate).toHaveBeenCalledTimes(1);
    const args = aggregate.mock.calls[0]?.[0] as { where: unknown };
    expect(args.where).toEqual({ productId: "prod-1", hiddenAt: null });
    expect(result?.reviews).toEqual({ count: 2, ratingSum: 9 });
  });

  it("the review list and its total filter hiddenAt: null", async () => {
    findFirst.mockResolvedValue({ id: "prod-1" });
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([]);
    await findReviewsOfVisibleProduct("p-1", { page: 1, pageSize: 20 });
    const countArgs = count.mock.calls[0]?.[0] as { where: unknown };
    const listArgs = findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(countArgs.where).toEqual({ productId: "prod-1", hiddenAt: null });
    expect(listArgs.where).toEqual({ productId: "prod-1", hiddenAt: null });
  });
});

describe("findVisibleProductBySlug (CR-87)", () => {
  it("reads at most MAX_PRODUCT_IMAGES pictures, in sortOrder then id", async () => {
    findFirst.mockResolvedValue(null);
    await findVisibleProductBySlug("p-1");
    expect(findFirst).toHaveBeenCalledTimes(1);
    const args = findFirst.mock.calls[0]?.[0] as {
      select: { images: { take?: number; orderBy: unknown } };
    };
    expect(MAX_PRODUCT_IMAGES).toBe(8);
    expect(args.select.images.take).toBe(MAX_PRODUCT_IMAGES);
    expect(args.select.images.orderBy).toEqual([{ sortOrder: "asc" }, { id: "asc" }]);
    expect(aggregate).not.toHaveBeenCalled();
  });
});
