/**
 * Security re-check of SEC-054 (commit 70eee49), 2026-10-29. Owner: security. Real PostgreSQL
 * (`pnpm test:integration`).
 *
 * The author's cases cover a seller edit (moderation PENDING) and an admin take-down. This file
 * covers every other way a product leaves the storefront (API_CONTRACTS 5.4: unpublished,
 * archived, rejected, store suspended, owner deactivated, category switched off), each with a
 * title and picture that must not leave the server, and the quantity change of a hidden line,
 * whose refusal must not carry the content either.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)        behaviour checked on 2026-10-29 that holds. A failure is a regression.
 */
import { describe, expect, it } from "vitest";

import { getCart, updateCartItem } from "@/modules/cart";
import type { Actor } from "@/server/auth/actor";
import { loadActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  createCart,
  createCartItem,
  createCategory,
  createProduct,
  createProductImage,
  createStore,
  createUser,
} from "../helpers/factories";

const SECRET = "Pay by bank transfer to 123-4-56789";

async function customer(): Promise<{ actor: Actor; cartId: string }> {
  const user = await createUser();
  const actor = await loadActor(user.id);
  if (actor === null) throw new Error("no actor");
  const cart = await createCart({ userId: user.id });
  return { actor, cartId: cart.id };
}

/** A product holding the secret title, slug, and a picture, with one line in the cart. */
async function lineFor(cartId: string, overrides: Parameters<typeof createProduct>[0] = {}) {
  const product = await createProduct({ title: SECRET, ...overrides });
  const image = await createProductImage({ productId: product.id });
  const upload = await db.upload.findUniqueOrThrow({ where: { id: image.uploadId } });
  const line = await createCartItem({ cartId, productId: product.id, quantity: 2 });
  return { product, line, storageKey: upload.storageKey };
}

describe("SEC-054 re-check: every way a product is hidden sends no content", () => {
  it("unpublished, archived, rejected, suspended store, deactivated owner, category off", async () => {
    const { actor, cartId } = await customer();
    const suspended = await createStore({ status: "SUSPENDED", statusReason: "Probe" });
    const ownerOff = await createUser({ role: "SELLER", isActive: false });
    const ownerOffStore = await createStore({ ownerId: ownerOff.id });
    const categoryOff = await createCategory({ isActive: false });
    const hidden = [
      await lineFor(cartId, { status: "DRAFT" }),
      await lineFor(cartId, { status: "ARCHIVED" }),
      await lineFor(cartId, { moderationStatus: "REJECTED" }),
      await lineFor(cartId, { storeId: suspended.id }),
      await lineFor(cartId, { storeId: ownerOffStore.id }),
      await lineFor(cartId, { categoryId: categoryOff.id }),
    ];

    const cart = await getCart(actor);
    const lines = cart.stores.flatMap((group) => group.items);
    expect(lines).toHaveLength(hidden.length);
    for (const { product } of hidden) {
      expect(lines.find((line) => line.productId === product.id)).toMatchObject({
        unbuyableReason: "NOT_AVAILABLE",
        slug: null,
        title: null,
        image: null,
        unitPriceSatang: null,
        stock: null,
      });
    }
    const text = JSON.stringify(cart);
    expect(text).not.toContain(SECRET);
    for (const { product, storageKey } of hidden) {
      expect(text).not.toContain(`"${product.slug}"`);
      expect(text).not.toContain(`${storageKey}"`);
    }
  });

  it("a quantity change of a hidden line is refused without the product's content", async () => {
    const { actor, cartId } = await customer();
    const { line, product, storageKey } = await lineFor(cartId, { moderationStatus: "TAKEN_DOWN" });
    const outcome = await updateCartItem(actor, line.id, { quantity: 1 }).then(
      () => "done",
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AppError);
    const error = outcome as AppError;
    expect(error.status).toBe(409);
    const text = JSON.stringify({ ...error, message: error.message });
    expect(text).toContain(line.id);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(product.slug);
    expect(text).not.toContain(storageKey);
  });
});
