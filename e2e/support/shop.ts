/**
 * Setup shared by the journey specs 12 to 16 (T-060). Everything here is setup through the HTTP
 * API or the real forms; the behaviour a journey tests is always driven by the spec itself.
 */
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { th } from "@/i18n/th";
import { ADMIN_STORAGE_STATE, SEEDED } from "./accounts";
import { runE2eScript } from "./child-steps";
import { E2E_ORIGIN } from "./constants";
import { ORIGIN_HEADERS, registerCustomer, type Person } from "./session";

async function body<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  const text = await response.text();
  expect(response.ok(), `${response.url()} answered ${response.status()}: ${text}`).toBe(true);
  return JSON.parse(text) as T;
}

/** A default delivery address, so the checkout page can be submitted. */
export async function addAddress(api: APIRequestContext): Promise<void> {
  const response = await api.post("/api/v1/me/addresses", {
    headers: ORIGIN_HEADERS,
    data: {
      recipientName: "ผู้ซื้อ E2E",
      phone: "0812345678",
      line1: "99/9 ถนนทดสอบ",
      subdistrict: "ทดสอบ",
      district: "ทดสอบ",
      province: "กรุงเทพมหานคร",
      postalCode: "10110",
      isDefault: true,
    },
  });
  expect(response.ok(), `address answered ${response.status()}`).toBe(true);
}

/** Submits the checkout page (mock payment, success) and returns the new order's id. */
export async function checkoutOnPage(page: Page): Promise<string> {
  await page.goto("/checkout");
  await page.getByRole("button", { name: th.checkout.submit }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(id).not.toBe("");
  return id;
}

export interface OrderView {
  id: string;
  paymentStatus: string;
  grandTotalSatang: number;
  sellerOrders: {
    id: string;
    fulfilmentStatus: string;
    items: { id: string; quantity: number; productTitle: string }[];
  }[];
}

export async function readOrder(api: APIRequestContext, orderId: string): Promise<OrderView> {
  return (await body<{ data: OrderView }>(await api.get(`/api/v1/orders/${orderId}`))).data;
}

/**
 * SEC-072: a seller may set DELIVERED only 24 hours after shipping, by the database clock. Moves
 * the seller order's `shippedAt` back by that much in the e2e database (setup; the server's check
 * is unchanged).
 */
export function ageShipment(sellerOrderId: string): void {
  runE2eScript("age shipment (SEC-072)", "age-shipment.ts", [sellerOrderId]);
}

/**
 * Moves a seller order through the seller's status endpoint (setup of a delivered order). Before
 * `DELIVERED` the shipment is aged in the database (SEC-072, `ageShipment`).
 */
export async function moveSellerOrder(
  seller: APIRequestContext,
  sellerOrderId: string,
  steps: readonly ("PROCESSING" | "SHIPPED" | "DELIVERED")[],
): Promise<void> {
  for (const to of steps) {
    if (to === "DELIVERED") ageShipment(sellerOrderId);
    const response = await seller.post(`/api/v1/seller/orders/${sellerOrderId}/status`, {
      headers: ORIGIN_HEADERS,
      data:
        to === "SHIPPED" ? { to, carrierName: "ขนส่งจำลอง", trackingNumber: "MOCK-E2E-1" } : { to },
    });
    expect(response.ok(), `status ${to} answered ${response.status()}`).toBe(true);
  }
}

/** The id of the second e2e category, read through the admin API. */
export async function categoryTwoId(browser: Browser): Promise<string> {
  const admin = await browser.newContext({
    baseURL: E2E_ORIGIN,
    storageState: ADMIN_STORAGE_STATE,
  });
  try {
    const list = await body<{ data: { id: string; name: string }[] }>(
      await admin.request.get("/api/v1/admin/categories?pageSize=50"),
    );
    const found = list.data.find((category) => category.name === SEEDED.categoryTwo.name);
    if (!found) throw new Error("e2e category two not found");
    return found.id;
  } finally {
    await admin.close();
  }
}

export interface NewStore {
  owner: Person;
  storeId: string;
  storeName: string;
}

/**
 * Registers a customer through the real pages, files a store application through the API, and has
 * the admin approve it. The owner keeps the same browser session, now with the seller role.
 */
export async function registerSellerWithStore(browser: Browser, prefix: string): Promise<NewStore> {
  const owner = await registerCustomer(browser, prefix);
  const storeName = `ร้าน ${prefix} ${Date.now().toString(36)}`;
  const applied = await body<{ data: { id: string } }>(
    await owner.context.request.post("/api/v1/seller/application", {
      headers: ORIGIN_HEADERS,
      data: { storeName, description: "ร้านสำหรับทดสอบ E2E", contactPhone: "0812345678" },
    }),
  );
  const admin = await browser.newContext({
    baseURL: E2E_ORIGIN,
    storageState: ADMIN_STORAGE_STATE,
  });
  try {
    const approved = await body<{ data: { store: { id: string } } }>(
      await admin.request.post(`/api/v1/admin/applications/${applied.data.id}/approve`, {
        headers: ORIGIN_HEADERS,
        data: {},
      }),
    );
    return { owner, storeId: approved.data.store.id, storeName };
  } finally {
    await admin.close();
  }
}

/** The admin takes a product down through the API (setup of an unavailable cart line). */
export async function takeDown(browser: Browser, productId: string, reason: string): Promise<void> {
  const admin = await browser.newContext({
    baseURL: E2E_ORIGIN,
    storageState: ADMIN_STORAGE_STATE,
  });
  try {
    const response = await admin.request.post(`/api/v1/admin/products/${productId}/takedown`, {
      headers: ORIGIN_HEADERS,
      data: { contentRevision: 1, reason },
    });
    expect(response.ok(), `takedown answered ${response.status()}`).toBe(true);
  } finally {
    await admin.close();
  }
}
