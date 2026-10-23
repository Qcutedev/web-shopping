import { describe, expect, it } from "vitest";
import * as server from "@/modules/admin/schema";
import * as client from "./client-schemas";

// The client file copies the bounds of the server schema because the server file cannot be imported
// in the browser. These tests fail when one side changes and the other does not.
describe("client schemas follow the server schemas", () => {
  it("copies every bound", () => {
    expect(client.CATEGORY_NAME_MAX).toBe(server.CATEGORY_NAME_MAX);
    expect(client.CATEGORY_SORT_ORDER_MIN).toBe(server.CATEGORY_SORT_ORDER_MIN);
    expect(client.CATEGORY_SORT_ORDER_MAX).toBe(server.CATEGORY_SORT_ORDER_MAX);
    expect(client.MIN_SHIPPING_FEE_SATANG).toBe(server.MIN_SHIPPING_FEE_SATANG);
    expect(client.MAX_SHIPPING_FEE_SATANG).toBe(server.MAX_SHIPPING_FEE_SATANG);
    expect(client.MIN_COMMISSION_RATE_BPS).toBe(server.MIN_COMMISSION_RATE_BPS);
    expect(client.MAX_COMMISSION_RATE_BPS).toBe(server.MAX_COMMISSION_RATE_BPS);
    expect(client.COMMISSION_RATE_STEP_BPS).toBe(server.COMMISSION_RATE_STEP_BPS);
  });

  const inputs: [string, Record<string, unknown>][] = [
    ["a valid category", { name: "เสื้อผ้า", sortOrder: 3 }],
    ["a category without a sort order", { name: "เสื้อผ้า" }],
    ["a blank name", { name: "   " }],
    ["a name of 100 characters", { name: "ก".repeat(100) }],
    ["a name of 101 characters", { name: "ก".repeat(101) }],
    ["a name with a control character", { name: `a${String.fromCharCode(7)}b` }],
    ["a name with a bidi override", { name: `a${String.fromCharCode(0x202e)}b` }],
    ["a negative sort order", { name: "x", sortOrder: -1 }],
    ["the largest sort order", { name: "x", sortOrder: 1_000_000 }],
    ["a sort order above the largest", { name: "x", sortOrder: 1_000_001 }],
    ["a fractional sort order", { name: "x", sortOrder: 1.5 }],
    ["an unknown key", { name: "x", slug: "x" }],
  ];

  it.each(inputs)("agrees on create: %s", (_label, input) => {
    expect(client.createCategoryFormSchema.safeParse(input).success).toBe(
      server.createCategoryBodySchema.safeParse(input).success,
    );
  });

  const updates: [string, Record<string, unknown>][] = [
    ["an empty body", {}],
    ["isActive only", { isActive: false }],
    ["isActive as text", { isActive: "false" }],
    ["a rename", { name: "ใหม่" }],
    ["a blank rename", { name: "" }],
    ["a role", { role: "ADMIN" }],
  ];

  it.each(updates)("agrees on update: %s", (_label, input) => {
    expect(client.updateCategoryFormSchema.safeParse(input).success).toBe(
      server.updateCategoryBodySchema.safeParse(input).success,
    );
  });

  const settings: [string, Record<string, unknown>][] = [
    ["both at the lower bound", { flatShippingFeeSatang: 0, commissionRateBps: 0 }],
    ["both at the upper bound", { flatShippingFeeSatang: 100_000, commissionRateBps: 10_000 }],
    ["the fee above the bound", { flatShippingFeeSatang: 100_001 }],
    ["a negative fee", { flatShippingFeeSatang: -1 }],
    ["a fractional fee", { flatShippingFeeSatang: 4000.5 }],
    ["2.5 percent", { commissionRateBps: 250 }],
    ["5 percent", { commissionRateBps: 500 }],
    ["above 100 percent", { commissionRateBps: 10_100 }],
    ["an empty body", {}],
    ["the moderation switch", { requireProductApproval: false }],
    ["a text number", { flatShippingFeeSatang: "4000" }],
  ];

  it.each(settings)("agrees on settings: %s", (_label, input) => {
    expect(client.updateSettingsFormSchema.safeParse(input).success).toBe(
      server.updateSettingsBodySchema.safeParse(input).success,
    );
  });
});
