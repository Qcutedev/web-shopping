import { describe, expect, it } from "vitest";
import { orderListQueryFrom, ordersHref } from "./orders-query";
import { productListQueryFrom, productsHref } from "./products-query";

describe("productListQueryFrom (CR-97)", () => {
  it("keeps moderationStatus when status is empty", () => {
    const query = productListQueryFrom({ status: "", moderationStatus: "REJECTED" });
    expect(query.moderationStatus).toBe("REJECTED");
    expect(query.status).toBeUndefined();
  });

  it("keeps lowStock when both selects are empty", () => {
    const query = productListQueryFrom({ status: "", moderationStatus: "", lowStock: "true" });
    expect(query.lowStock).toBe(true);
  });

  it("falls back to defaults for an invalid value", () => {
    const query = productListQueryFrom({ status: "NOPE" });
    expect(query.status).toBeUndefined();
    expect(query.page).toBe(1);
  });
});

describe("orderListQueryFrom (CR-97)", () => {
  it("reads an empty status as no filter and keeps the page", () => {
    const query = orderListQueryFrom({ fulfilmentStatus: "", page: "2" });
    expect(query.fulfilmentStatus).toBeUndefined();
    expect(query.page).toBe(2);
  });
});

describe("hrefs keep pageSize (CR-104)", () => {
  it("productsHref keeps a non-default pageSize", () => {
    const query = productListQueryFrom({ pageSize: "10", status: "PUBLISHED" });
    expect(productsHref(query, 2)).toBe("/seller/products?status=PUBLISHED&pageSize=10&page=2");
  });

  it("ordersHref keeps a non-default pageSize", () => {
    const query = orderListQueryFrom({ pageSize: "10" });
    expect(ordersHref(query, 3)).toBe("/seller/orders?pageSize=10&page=3");
  });
});
