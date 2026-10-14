import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import type { StoreDto } from "@/modules/catalog/schema";

const catalog = vi.hoisted(() => ({ getStore: vi.fn(), listStoreProducts: vi.fn() }));
vi.mock("@/modules/catalog", () => catalog);
vi.mock("next/navigation", () => ({ notFound: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
// The async list cannot render in jsdom; it has its own tests.
vi.mock("./product-list-section", () => ({ ProductListSection: () => <p>list</p> }));

import { StoreSection } from "./store-section";

const store: StoreDto = {
  id: "s1",
  name: "ร้านตัวอย่าง",
  slug: "shop-a",
  description: null,
  logo: null,
  isSample: false,
};
const query = { page: 1, pageSize: 20, sort: "newest" as const };

describe("StoreSection success", () => {
  it("name in bdi, tint placeholder without a logo, sort links keep every filter", async () => {
    catalog.getStore.mockResolvedValue(store);
    const element = await StoreSection({
      slug: "shop-a",
      query: { ...query, q: "a", category: "tea", minPriceSatang: 100, maxPriceSatang: 900 },
    });
    const { container } = render(element);
    expect(container.querySelector("h1 bdi")?.textContent).toBe("ร้านตัวอย่าง");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: th.catalog.sort.price_asc }).getAttribute("href")).toBe(
      "/stores/shop-a?q=a&category=tea&minPriceSatang=100&maxPriceSatang=900&sort=price_asc",
    );
  });

  it("renders the logo with empty alt when the store has one", async () => {
    catalog.getStore.mockResolvedValue({ ...store, logo: { key: "k", url: "/api/files/k" } });
    const { container } = render(await StoreSection({ slug: "shop-a", query }));
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("alt")).toBe("");
  });
});
