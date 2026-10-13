/**
 * Shape of the queries the repository sends, with the database client replaced. The rows a
 * query returns are covered against a real database in tests/integration/catalog.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const aggregate = vi.fn();

vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  return {
    ...actual,
    db: {
      product: { findFirst: (...args: unknown[]) => findFirst(...args) },
      review: { aggregate: (...args: unknown[]) => aggregate(...args) },
    },
  };
});

const { findVisibleProductBySlug } = await import("./repository");
const { MAX_PRODUCT_IMAGES } = await import("./schema");

beforeEach(() => {
  findFirst.mockReset();
  aggregate.mockReset();
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
