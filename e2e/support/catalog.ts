/**
 * Setup helpers that make a product in a chosen state through the HTTP API (setup, not the journey
 * under test). The seller is the second e2e seller; the admin is the e2e admin.
 */
import { expect, type APIRequestContext, type Browser } from "@playwright/test";
import { ADMIN_STORAGE_STATE, SEEDED, SELLER_TWO_STORAGE_STATE } from "./accounts";
import { E2E_ORIGIN } from "./constants";
import { ORIGIN_HEADERS } from "./session";

export interface MadeProduct {
  id: string;
  slug: string;
  title: string;
}

async function json(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<unknown> {
  const text = await response.text();
  expect(response.ok(), `${response.url()} answered ${response.status()}: ${text}`).toBe(true);
  return JSON.parse(text) as unknown;
}

/** Creates a draft of seller two, with stock `stock`. */
export async function createDraft(
  seller: APIRequestContext,
  prefix: string,
  stock: number,
  /** Category id for a seller other than seller two (see shop.ts categoryTwoId). */
  categoryId?: string,
): Promise<MadeProduct> {
  // The public category answer has no id; the seller's own seeded product does (category two).
  const category: { data: { id: string } | undefined } = { data: undefined };
  if (categoryId) {
    category.data = { id: categoryId };
  } else {
    const own = (await json(await seller.get("/api/v1/seller/products"))) as {
      data: { category: { id: string; name: string } }[];
    };
    category.data = own.data.find(
      (item) => item.category.name === SEEDED.categoryTwo.name,
    )?.category;
  }
  if (!category.data) throw new Error("seller two has no product in the e2e category two");
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const title = `${prefix} ${stamp}`;
  const created = (await json(
    await seller.post("/api/v1/seller/products", {
      headers: ORIGIN_HEADERS,
      data: {
        title,
        description: "สินค้าสำหรับทดสอบ E2E",
        sku: `E2E-NEG-${stamp}`,
        categoryId: category.data.id,
        priceSatang: 10_000,
        stock,
      },
    }),
  )) as { data: { id: string; slug: string } };
  return { id: created.data.id, slug: created.data.slug, title };
}

/** Publishes the product and has the admin approve it, so shoppers can buy it. */
export async function publishAndApprove(
  browser: Browser,
  seller: APIRequestContext,
  productId: string,
): Promise<void> {
  const published = await seller.post(`/api/v1/seller/products/${productId}/publish`, {
    headers: ORIGIN_HEADERS,
    data: {},
  });
  expect(published.ok(), `publish answered ${published.status()}`).toBe(true);
  const admin = await browser.newContext({
    baseURL: E2E_ORIGIN,
    storageState: ADMIN_STORAGE_STATE,
  });
  try {
    const approved = await admin.request.post(`/api/v1/admin/products/${productId}/approve`, {
      headers: ORIGIN_HEADERS,
      data: { contentRevision: 1 },
    });
    expect(approved.ok(), `approve answered ${approved.status()}`).toBe(true);
  } finally {
    await admin.close();
  }
}

export async function setStock(
  seller: APIRequestContext,
  productId: string,
  stock: number,
): Promise<void> {
  const response = await seller.patch(`/api/v1/seller/products/${productId}/stock`, {
    headers: ORIGIN_HEADERS,
    data: { set: stock },
  });
  expect(response.ok(), `stock answered ${response.status()}`).toBe(true);
}

export async function openSeller(browser: Browser) {
  const context = await browser.newContext({
    baseURL: E2E_ORIGIN,
    storageState: SELLER_TWO_STORAGE_STATE,
  });
  return context;
}
