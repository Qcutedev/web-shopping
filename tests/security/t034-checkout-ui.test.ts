/**
 * T-034 security review (checkout, order confirmation, order history UI), security, 2026-10-22.
 * Owner: security.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Pins, for the T-034 files (commit cb07d84):
 *   1. The checkout request carries an address id, the payment method, and the mock outcome only:
 *      no price, total, fee, quantity, storeId, or userId (rule 3, D-031). Checked on the wire
 *      (placeOrder with a stub fetch) and in the source of checkout-view.tsx (the one call site).
 *   2. The server refuses such a key anyway (strict body schema).
 *   3. The client components import nothing from src/modules or src/server except types, and no
 *      T-034 file imports the database layer or a driver, reads process.env, or writes raw HTML.
 *   4. The mock payment and simulated shipping labels are present where the views show payment
 *      and shipping.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { placeOrder } from "@/lib/api-client/checkout";
import { checkoutBodySchema } from "@/modules/checkout/schema";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

const CLIENT_FILES = [
  "src/components/checkout/checkout-view.tsx",
  "src/components/cart/cart-view.tsx",
  "src/lib/api-client/checkout.ts",
  "src/lib/api-client/cart.ts",
  "src/lib/api-client/http.ts",
];

const T034_FILES = [
  ...CLIENT_FILES,
  "src/app/(storefront)/cart/page.tsx",
  "src/app/(storefront)/checkout/page.tsx",
  "src/app/(storefront)/orders/[id]/page.tsx",
  "src/app/(storefront)/orders/page.tsx",
  "src/components/cart/cart-section.tsx",
  "src/components/cart/cart-summary.tsx",
  "src/components/cart/request-error.tsx",
  "src/components/checkout/checkout-section.tsx",
  "src/components/orders/order-detail-view.tsx",
  "src/components/orders/order-list-view.tsx",
  "src/components/orders/order-section.tsx",
  "src/components/orders/orders-section.tsx",
  "src/components/orders/status-badges.tsx",
  "src/components/page-frame.tsx",
];

describe("T-034: the checkout request carries no amount", () => {
  it("placeOrder sends exactly the body it is given and a UUID Idempotency-Key", async () => {
    const seen: { body: unknown; headers: Headers }[] = [];
    const fetchStub = (async (_url: string, init?: RequestInit) => {
      seen.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ data: { id: "o1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const key = "123e4567-e89b-42d3-a456-426614174000";
    await placeOrder(
      { addressId: "a1", paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      key,
      fetchStub,
    );
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]?.body as object).sort()).toEqual([
      "addressId",
      "mockOutcome",
      "paymentMethod",
    ]);
    expect(seen[0]?.headers.get("Idempotency-Key")).toBe(key);
  });

  it("the one call site in checkout-view.tsx builds the body from those three keys only", () => {
    const path = "src/components/checkout/checkout-view.tsx";
    const sf = ts.createSourceFile(
      path,
      read(path),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "placeOrder"
      ) {
        calls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(calls).toHaveLength(1);
    const body = calls[0]?.arguments[0];
    expect(body && ts.isObjectLiteralExpression(body)).toBe(true);
    const keys = (body as ts.ObjectLiteralExpression).properties.map((p) => {
      expect(ts.isPropertyAssignment(p), "no spread or shorthand in the body").toBe(true);
      return (p as ts.PropertyAssignment).name.getText(sf);
    });
    expect(keys.sort()).toEqual(["addressId", "mockOutcome", "paymentMethod"]);
  });

  it("the server schema refuses an amount, a quantity, a store, or a user in the body", () => {
    const base = { addressId: "a1", paymentMethod: "MOCK" };
    expect(checkoutBodySchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { grandTotalSatang: 1 },
      { itemsSubtotalSatang: 1 },
      { shippingTotalSatang: 0 },
      { quantity: 1 },
      { storeId: "s1" },
      { userId: "u1" },
      { items: [] },
    ]) {
      expect(
        checkoutBodySchema.safeParse({ ...base, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe("T-034: client code and layer boundaries", () => {
  // A value import from a module's schema.ts is accepted when that file's own value imports are
  // zod only (pure constants and Zod schemas; nothing that reads the database or the environment).
  // cart-view.tsx takes MAX_LINE_QUANTITY from src/modules/cart/schema.ts this way.
  function isPureSchema(spec: string): boolean {
    if (!/^@\/modules\/[a-z-]+\/schema$/.test(spec)) return false;
    const path = `src/${spec.slice(2)}.ts`;
    const sf = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    return sf.statements.every((statement) => {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return true;
      const spec2 =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (spec2 === undefined || spec2 === "zod") return true;
      return ts.isImportDeclaration(statement)
        ? statement.importClause?.isTypeOnly === true
        : statement.isTypeOnly;
    });
  }

  it("the pure-schema allowance is not vacuous", () => {
    expect(isPureSchema("@/modules/cart/schema")).toBe(true);
    // checkout/schema.ts imports values from payments and server/errors: not pure.
    expect(isPureSchema("@/modules/checkout/schema")).toBe(false);
    expect(isPureSchema("@/modules/cart")).toBe(false);
  });

  it("client files import src/modules and src/server as types only (or a pure schema)", () => {
    const offenders: string[] = [];
    for (const path of CLIENT_FILES) {
      const sf = ts.createSourceFile(
        path,
        read(path),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
          continue;
        }
        const spec = statement.moduleSpecifier.text;
        if (!/^@\/(modules|server)\//.test(spec)) continue;
        const clause = statement.importClause;
        const typeOnly =
          clause?.isTypeOnly === true ||
          (clause !== undefined &&
            clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.every((el) => el.isTypeOnly));
        if (!typeOnly && !isPureSchema(spec)) offenders.push(`${path}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("checkout-view.tsx and cart-view.tsx are client components", () => {
    expect(read("src/components/checkout/checkout-view.tsx")).toMatch(/^"use client";/);
    expect(read("src/components/cart/cart-view.tsx")).toMatch(/^"use client";/);
  });

  it("no T-034 file imports the database layer or a driver, reads process.env, or writes raw HTML", () => {
    const offenders = T034_FILES.filter((path) =>
      /server\/db|@prisma\/|from "pg"|process\.env|dangerouslySetInnerHTML|innerHTML|\beval\(/.test(
        read(path),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("T-034: mock payment and simulated shipping are labelled", () => {
  it("checkout labels payment as a mock and shipping as simulated", () => {
    const source = read("src/components/checkout/checkout-view.tsx");
    expect(source).toContain("th.notice.mockPayment");
    expect(source).toContain("th.notice.simulatedShipping");
    expect(source).toContain("th.checkout.paymentMockNote");
  });

  it("order detail and order list label the mock payment; detail labels simulated shipping", () => {
    const detail = read("src/components/orders/order-detail-view.tsx");
    expect(detail).toContain("th.notice.mockPayment");
    expect(detail).toContain("th.notice.simulatedShipping");
    expect(detail).toContain("detail.shipmentSimulated");
    expect(read("src/components/orders/order-list-view.tsx")).toContain("th.notice.mockPayment");
  });
});
