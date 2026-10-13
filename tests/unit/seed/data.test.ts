/**
 * The seed's sample data and account rows (T-014; prisma/seed/data.ts, prisma/seed/accounts.ts).
 * No database.
 */
import { verifyPassword } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import { buildSampleAccountRows, CREDENTIAL_PROVIDER_ID } from "../../../prisma/seed/accounts";
import {
  buildSampleData,
  SAMPLE_EMAIL_DOMAIN,
  SAMPLE_PASSWORD,
  SAMPLE_PRODUCT_TITLE_PREFIX,
  SAMPLE_STORE_NAME_PREFIX,
  SAMPLE_USER_NAME_PREFIX,
  sampleSlug,
  validateSampleData,
} from "../../../prisma/seed/data";

describe("buildSampleData", () => {
  const data = buildSampleData();

  it("is valid", () => {
    expect(validateSampleData(data)).toEqual([]);
  });

  it("is the same on every call (the seed finds its own rows again)", () => {
    expect(buildSampleData()).toEqual(data);
  });

  it("seeds a customer and sellers, and no admin", () => {
    const roles = data.users.map((u) => u.role);
    expect(roles).toContain("CUSTOMER");
    expect(roles).toContain("SELLER");
    expect(roles as string[]).not.toContain("ADMIN");
  });

  it("marks every account, store, and product as sample data", () => {
    for (const u of data.users) {
      expect(u.name.startsWith(SAMPLE_USER_NAME_PREFIX)).toBe(true);
      expect(u.email.endsWith(`@${SAMPLE_EMAIL_DOMAIN}`)).toBe(true);
    }
    for (const s of data.stores) expect(s.name.startsWith(SAMPLE_STORE_NAME_PREFIX)).toBe(true);
    for (const p of data.products) {
      expect(p.title.startsWith(SAMPLE_PRODUCT_TITLE_PREFIX)).toBe(true);
    }
  });

  it("prices are integer satang inside the column check, stock inside the entry limit", () => {
    for (const p of data.products) {
      expect(Number.isInteger(p.priceSatang)).toBe(true);
      expect(p.priceSatang).toBeGreaterThanOrEqual(100);
      expect(p.priceSatang).toBeLessThanOrEqual(100_000_000);
      expect(Number.isInteger(p.stock)).toBe(true);
      expect(p.stock).toBeGreaterThanOrEqual(0);
      expect(p.stock).toBeLessThanOrEqual(1_000_000);
    }
  });

  it("has Thai text, a sold-out product, and a draft", () => {
    expect(data.products.every((p) => /\p{Script=Thai}/u.test(p.title))).toBe(true);
    expect(data.products.some((p) => p.stock === 0 && p.state === "LIVE")).toBe(true);
    expect(data.products.some((p) => p.state === "DRAFT")).toBe(true);
  });
});

describe("validateSampleData", () => {
  it.each([
    ["a fractional price", { priceSatang: 199.5 }],
    ["a price below the check", { priceSatang: 99 }],
    ["a price above the check", { priceSatang: 100_000_001 }],
    ["negative stock", { stock: -1 }],
    ["stock above the entry limit", { stock: 1_000_001 }],
    ["a title without the sample prefix", { title: "เสื้อยืด" }],
  ])("reports %s", (_label, change) => {
    const data = buildSampleData();
    data.products[0] = { ...data.products[0]!, ...change };
    expect(validateSampleData(data)).not.toEqual([]);
  });

  it("reports a store name without the sample prefix and a seller with two stores", () => {
    const data = buildSampleData();
    data.stores[1] = { ...data.stores[1]!, name: "ร้านจริง", ownerKey: data.stores[0]!.ownerKey };
    const problems = validateSampleData(data);
    expect(problems.some((p) => p.includes("not sample"))).toBe(true);
    expect(problems.some((p) => p.includes("owns two stores"))).toBe(true);
  });

  it("reports an email outside the sample domain", () => {
    const data = buildSampleData();
    data.users[0] = { ...data.users[0]!, email: "someone@gmail.com" };
    expect(validateSampleData(data).some((p) => p.includes("not sample"))).toBe(true);
  });
});

describe("sampleSlug", () => {
  it("keeps Thai letters, vowels, and tone marks, and joins other runs with one dash", () => {
    expect(sampleSlug("สินค้าตัวอย่าง สายชาร์จ USB-C", "smp0p007")).toBe(
      "สินค้าตัวอย่าง-สายชาร์จ-usb-c-smp0p007",
    );
  });

  it("cuts the readable part to 40 code points without a trailing dash", () => {
    const slug = sampleSlug(`${"ก".repeat(39)} ข`, "smp0p001");
    expect(slug).toBe(`${"ก".repeat(39)}-smp0p001`);
  });

  it("is the suffix alone when nothing readable is left", () => {
    expect(sampleSlug("!!!", "smp0p001")).toBe("smp0p001");
  });

  it.each(["short", "SMP0P001", "smp0p0i1", "smp0p0011"])("refuses the suffix %j", (suffix) => {
    expect(() => sampleSlug("x", suffix)).toThrow(RangeError);
  });
});

describe("buildSampleAccountRows", () => {
  it("writes the library's formats, and the hash verifies with the library", async () => {
    const sample = buildSampleData().users.find((u) => u.role === "SELLER")!;
    const rows = await buildSampleAccountRows(sample, SAMPLE_PASSWORD);

    expect(rows.user.id).toMatch(/^[a-zA-Z0-9]{32}$/);
    expect(rows.account.id).toMatch(/^[a-zA-Z0-9]{32}$/);
    expect(rows.account.id).not.toBe(rows.user.id);
    expect(rows.user.email).toBe(sample.email.toLowerCase());
    expect(rows.user.role).toBe("SELLER");
    expect(rows.user.emailVerified).toBe(false);
    expect(rows.user.isActive).toBe(true);
    expect(rows.account.providerId).toBe(CREDENTIAL_PROVIDER_ID);
    expect(rows.account.accountId).toBe(rows.user.id);
    expect(rows.account.userId).toBe(rows.user.id);

    expect(rows.account.password).not.toContain(SAMPLE_PASSWORD);
    await expect(
      verifyPassword({ hash: rows.account.password, password: SAMPLE_PASSWORD }),
    ).resolves.toBe(true);
    await expect(
      verifyPassword({ hash: rows.account.password, password: "wrong-password" }),
    ).resolves.toBe(false);
  });

  it("meets the sign-up password policy (8 to 128 characters)", () => {
    expect(SAMPLE_PASSWORD.length).toBeGreaterThanOrEqual(8);
    expect(SAMPLE_PASSWORD.length).toBeLessThanOrEqual(128);
  });
});
