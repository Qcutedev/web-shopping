/**
 * Throwaway accounts of the end-to-end suite and the data seeded for them. Pure values: no
 * environment, so a child process (seed-extra.ts) and the specs can both import this file.
 *
 * The first seller (SELLER in constants.ts) owns the store the stacked-table spec counts rows in
 * (exactly three products), so no spec that creates products uses that account. Specs that write
 * use SELLER_TWO, or an account they register themselves.
 */
import { resolve } from "node:path";
import { REPO_ROOT } from "./constants";

export const ADMIN = {
  name: "E2E Admin",
  email: "e2e-admin@example.test",
  password: "e2e-Admin-pass-1234",
} as const;

export const SELLER_TWO = {
  name: "E2E Seller Two",
  email: "e2e-seller-two@example.test",
  password: "e2e-SellerTwo-pass-1234",
} as const;

export const ADMIN_STORAGE_STATE = resolve(REPO_ROOT, "e2e/.auth/admin.json");
export const SELLER_TWO_STORAGE_STATE = resolve(REPO_ROOT, "e2e/.auth/seller-two.json");

/** Slugs and titles of the seeded catalogue (see tests/e2e-support/seed-extra.ts and database.ts). */
export const SEEDED = {
  storeOne: { slug: "e2e-store", name: "ร้านทดสอบ E2E" },
  storeTwo: { slug: "e2e-store-2", name: "ร้านทดสอบ E2E สอง" },
  categoryOne: { slug: "e2e-category", name: "หมวดทดสอบ E2E" },
  categoryTwo: { slug: "e2e-category-2", name: "หมวดทดสอบ E2E สอง" },
  /** Store one, price 123.45 THB. */
  productOne: { slug: "e2e-product-1", priceSatang: 12_345 },
  /** Store two, category two, price 250.00 THB. */
  productTwoA: { slug: "e2e-b-1", title: "เสื้อยืดทดสอบ E2E", priceSatang: 25_000 },
  /** Store two, category two, price 999.00 THB. */
  productTwoB: { slug: "e2e-b-2", title: "กระเป๋าทดสอบ E2E", priceSatang: 99_900 },
} as const;

/** An email no other run or spec uses, for an account a spec registers itself. */
export function uniqueEmail(prefix: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${stamp}@example.test`;
}
