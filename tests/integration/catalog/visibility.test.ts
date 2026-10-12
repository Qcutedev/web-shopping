/**
 * BR-05 against a real database: every hidden case is absent from every list (all products,
 * search, category, store) and its product page and review list are 404; stock 0 is not a
 * hidden case (BR-24); a store page follows conditions 3 and 4 (BR-27); a reactivated owner or
 * a category switched on again brings everything back with no product row changed (OQ-31).
 *
 * Rows are written with the schema-level factories (tests/helpers/factories.ts): each hidden
 * case differs from a visible product in exactly one column.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db";

import {
  createCategory,
  createProduct,
  createReview,
  createStore,
  createUser,
} from "../../helpers/factories";
import {
  callCategories,
  callProduct,
  callProductReviews,
  callProducts,
  callStore,
  callStoreProducts,
  type ErrorBody,
  type ListBody,
} from "./call";

// The handlers await `connection()` first (src/server/public-get.ts), which throws outside a
// Next.js request scope. Here it resolves, as it does at request time.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

type Item = { id: string; slug: string; soldOut: boolean };

/** A word in every title of this file, so `q` selects exactly these products. */
const WORD = "visibilitycase";

interface Fixture {
  visibleStore: { id: string; slug: string };
  category: { id: string; slug: string };
  visible: { id: string; slug: string };
  soldOut: { id: string; slug: string };
  hidden: Record<string, { id: string; slug: string; storeSlug: string; categorySlug: string }>;
  suspendedStore: { id: string; slug: string };
  inactiveOwnerStore: { id: string; slug: string; ownerId: string };
  inactiveCategory: { id: string; slug: string };
}

let f: Fixture;

beforeAll(async () => {
  const visibleStore = await createStore({ slug: "visible-store" });
  const category = await createCategory({ slug: "active-category" });
  const base = { storeId: visibleStore.id, categoryId: category.id };

  const visible = await createProduct({ ...base, title: `${WORD} visible`, slug: "visible" });
  const soldOut = await createProduct({
    ...base,
    title: `${WORD} sold out`,
    slug: "sold-out",
    stock: 0,
  });

  const suspendedStore = await createStore({ slug: "suspended-store", status: "SUSPENDED" });
  const inactiveOwner = await createUser({ role: "SELLER", isActive: false });
  const inactiveOwnerStore = await createStore({
    slug: "inactive-owner-store",
    ownerId: inactiveOwner.id,
  });
  const inactiveCategory = await createCategory({ slug: "inactive-category", isActive: false });

  const hiddenCases: Record<string, Parameters<typeof createProduct>[0]> = {
    draft: { ...base, status: "DRAFT" },
    archived: { ...base, status: "ARCHIVED" },
    awaitingApproval: { ...base, moderationStatus: "PENDING" },
    awaitingReapproval: {
      ...base,
      moderationStatus: "PENDING",
      contentRevision: 2,
    },
    rejected: { ...base, moderationStatus: "REJECTED", moderationNote: "no" },
    takenDown: { ...base, moderationStatus: "TAKEN_DOWN", moderationNote: "no" },
    draftAndPending: { ...base, status: "DRAFT", moderationStatus: "PENDING" },
    storeSuspended: { storeId: suspendedStore.id, categoryId: category.id },
    ownerDeactivated: { storeId: inactiveOwnerStore.id, categoryId: category.id },
    categoryInactive: { storeId: visibleStore.id, categoryId: inactiveCategory.id },
  };
  const hidden: Fixture["hidden"] = {};
  for (const [name, overrides] of Object.entries(hiddenCases)) {
    const product = await createProduct({ ...overrides, title: `${WORD} ${name}`, slug: name });
    const store = await db.store.findUniqueOrThrow({ where: { id: product.storeId } });
    const productCategory = await db.category.findUniqueOrThrow({
      where: { id: product.categoryId },
    });
    hidden[name] = {
      id: product.id,
      slug: product.slug,
      storeSlug: store.slug,
      categorySlug: productCategory.slug,
    };
    // A review on every hidden product, so the review list has something to hide.
    await createReview({ productId: product.id });
  }

  f = {
    visibleStore,
    category,
    visible,
    soldOut,
    hidden,
    suspendedStore,
    inactiveOwnerStore: { ...inactiveOwnerStore, ownerId: inactiveOwner.id },
    inactiveCategory,
  };
});

const HIDDEN_CASES = [
  "draft",
  "archived",
  "awaitingApproval",
  "awaitingReapproval",
  "rejected",
  "takenDown",
  "draftAndPending",
  "storeSuspended",
  "ownerDeactivated",
  "categoryInactive",
] as const;

async function allProductIds(query = ""): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const separator = query === "" ? "" : "&";
    const result = await callProducts<ListBody<Item>>(
      `${query}${separator}pageSize=50&page=${page}`,
    );
    expect(result.status).toBe(200);
    ids.push(...result.body.data.map((item) => item.id));
    if (page >= result.body.meta.totalPages) return ids;
  }
}

describe("visible products", () => {
  it("lists exactly the visible and the sold-out product", async () => {
    const result = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=50`);
    expect(result.status).toBe(200);
    expect(result.body.data.map((item) => item.id).sort()).toEqual(
      [f.visible.id, f.soldOut.id].sort(),
    );
    expect(result.body.meta.total).toBe(2);
  });

  it("keeps a sold-out product listed and readable, marked soldOut (BR-24)", async () => {
    const list = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=50`);
    expect(list.body.data.find((item) => item.id === f.soldOut.id)?.soldOut).toBe(true);
    expect(list.body.data.find((item) => item.id === f.visible.id)?.soldOut).toBe(false);
    const detail = await callProduct<{ data: { soldOut: boolean; stock: number } }>(f.soldOut.slug);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ soldOut: true, stock: 0 });
  });
});

describe.each(HIDDEN_CASES)("hidden case %s", (name) => {
  it("is absent from the unfiltered list, from search, from its category, and from its store", async () => {
    const hidden = f.hidden[name];
    if (hidden === undefined) throw new Error(`fixture ${name} missing`);

    expect(await allProductIds()).not.toContain(hidden.id);
    expect(await allProductIds(`q=${encodeURIComponent(`${WORD} ${name}`)}`)).toEqual([]);

    const byCategory = await callProducts<ListBody<Item>>(
      `category=${encodeURIComponent(hidden.categorySlug)}&pageSize=50`,
    );
    if (name === "categoryInactive") {
      expect(byCategory.status).toBe(404);
    } else {
      expect(byCategory.status).toBe(200);
      expect(byCategory.body.data.map((item) => item.id)).not.toContain(hidden.id);
    }

    const byStore = await callStoreProducts<ListBody<Item>>(hidden.storeSlug, "pageSize=50");
    if (name === "storeSuspended" || name === "ownerDeactivated") {
      expect(byStore.status).toBe(404);
    } else {
      expect(byStore.status).toBe(200);
      expect(byStore.body.data.map((item) => item.id)).not.toContain(hidden.id);
    }
  });

  it("has a product page and a review list that answer 404 like an unknown slug", async () => {
    const hidden = f.hidden[name];
    if (hidden === undefined) throw new Error(`fixture ${name} missing`);
    const unknown = await callProduct<ErrorBody>("no-such-product");

    const detail = await callProduct<ErrorBody>(hidden.slug);
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe("NOT_FOUND");
    expect(detail.body.error.message).toBe(unknown.body.error.message);
    expect(detail.body.error.details).toEqual({});

    const reviews = await callProductReviews<ErrorBody>(hidden.slug);
    expect(reviews.status).toBe(404);
    expect(reviews.body.error.code).toBe("NOT_FOUND");
  });
});

describe("store pages (BR-27)", () => {
  it("shows an approved store with an active owner", async () => {
    const result = await callStore<{ data: { id: string } }>(f.visibleStore.slug);
    expect(result.status).toBe(200);
    expect(result.body.data.id).toBe(f.visibleStore.id);
  });

  it.each([
    ["suspended", () => f.suspendedStore.slug],
    ["owner deactivated", () => f.inactiveOwnerStore.slug],
    ["unknown", () => "no-such-store"],
  ])("answers 404 for a store that is %s, with the same body shape", async (_name, slug) => {
    const store = await callStore<ErrorBody>(slug());
    expect(store.status).toBe(404);
    expect(store.body.error).toMatchObject({ code: "NOT_FOUND", details: {} });
    const products = await callStoreProducts<ErrorBody>(slug());
    expect(products.status).toBe(404);
    expect(products.body.error).toMatchObject({ code: "NOT_FOUND", details: {} });
  });
});

describe("categories (BR-23)", () => {
  it("lists active categories only", async () => {
    const result = await callCategories<ListBody<{ id: string }>>("pageSize=50");
    expect(result.status).toBe(200);
    const ids = result.body.data.map((category) => category.id);
    expect(ids).toContain(f.category.id);
    expect(ids).not.toContain(f.inactiveCategory.id);
  });

  it("answers 404 for an inactive and for an unknown category filter", async () => {
    for (const slug of [f.inactiveCategory.slug, "no-such-category"]) {
      const result = await callProducts<ErrorBody>(`category=${slug}`);
      expect(result.status).toBe(404);
      expect(result.body.error).toMatchObject({ code: "NOT_FOUND", details: {} });
      const inStore = await callStoreProducts<ErrorBody>(f.visibleStore.slug, `category=${slug}`);
      expect(inStore.status).toBe(404);
    }
  });
});

describe("return on reactivation (D-026, OQ-31)", () => {
  it("brings back the store and products of a reactivated owner, with no product row changed", async () => {
    const hidden = f.hidden["ownerDeactivated"];
    if (hidden === undefined) throw new Error("fixture missing");
    const before = await db.product.findUniqueOrThrow({ where: { id: hidden.id } });

    await db.user.update({ where: { id: f.inactiveOwnerStore.ownerId }, data: { isActive: true } });
    try {
      expect((await callStore(f.inactiveOwnerStore.slug)).status).toBe(200);
      expect((await callProduct(hidden.slug)).status).toBe(200);
      expect(await allProductIds(`q=${encodeURIComponent(`${WORD} ownerDeactivated`)}`)).toEqual([
        hidden.id,
      ]);
      expect(await db.product.findUniqueOrThrow({ where: { id: hidden.id } })).toEqual(before);
    } finally {
      await db.user.update({
        where: { id: f.inactiveOwnerStore.ownerId },
        data: { isActive: false },
      });
    }
    expect((await callProduct(hidden.slug)).status).toBe(404);
  });

  it("brings back the products of a category switched on again", async () => {
    const hidden = f.hidden["categoryInactive"];
    if (hidden === undefined) throw new Error("fixture missing");
    await db.category.update({ where: { id: f.inactiveCategory.id }, data: { isActive: true } });
    try {
      expect((await callProduct(hidden.slug)).status).toBe(200);
      const byCategory = await callProducts<ListBody<Item>>(`category=${f.inactiveCategory.slug}`);
      expect(byCategory.body.data.map((item) => item.id)).toEqual([hidden.id]);
    } finally {
      await db.category.update({ where: { id: f.inactiveCategory.id }, data: { isActive: false } });
    }
    expect((await callProduct(hidden.slug)).status).toBe(404);
  });

  it("keeps a suspended store hidden when its owner is active", async () => {
    expect((await callStore(f.suspendedStore.slug)).status).toBe(404);
    expect((await callProduct(f.hidden["storeSuspended"]?.slug ?? "")).status).toBe(404);
  });
});
