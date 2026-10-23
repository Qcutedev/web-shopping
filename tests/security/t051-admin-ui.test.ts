/**
 * Security review of T-051 (admin pages and components), commits up to 89f9957, 2026-10-23.
 * Owner: security. Review: docs/reviews/T-051-security.md. Register: docs/SECURITY.md.
 *
 * Written from CLAUDE.md rules 1, 2, 7, REQ-A-01 to REQ-A-10, and TM-07, TM-15, not from the
 * author's tests in src/components/admin/*.test.ts(x). Pins:
 *
 *   1. The admin pages hold no data access: each page renders one section from
 *      src/components/admin, imports nothing from src/modules, src/server, or the API client,
 *      and asks robots not to index it. The page list is pinned, so a new page fails here until
 *      it is reviewed.
 *   2. Every call of an admin service in src/components/admin is inside the callback handed to
 *      `renderForAdmin`, so no service is reached before the session and role are read.
 *   3. `renderForAdmin`: a visitor is redirected to sign-in, a customer and a seller get the
 *      refusal state and the callback never runs; only an ADMIN actor reaches it.
 *   4. The client components of the admin area reach, through their runtime imports, nothing that
 *      holds the database, the session reader, the environment, or a module service.
 *   5. Hostile text written by sellers and customers (markup, script, bidi override) renders as
 *      escaped text inside `<bdi>` on the product review page, the application, store, user, and
 *      order views, and in the audit log details. No admin file writes raw HTML.
 *   6. The storefront shell links to no admin page.
 *   7. The admin API client sends every mutation to /api/v1/admin with a JSON content type, the
 *      same-origin credentials mode, and the id percent-encoded into one path segment.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMarker = vi.hoisted(() => ({ target: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  redirect: (target: string) => {
    redirectMarker.target = target;
    throw new Error(`NEXT_REDIRECT ${target}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error;
  },
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const getActor = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ getActor: (...args: unknown[]) => getActor(...args) }));
vi.mock("@/modules/admin", () => ({}));

import { AuditTable } from "@/components/admin/audit-table";
import { ApplicationsTable } from "@/components/admin/applications-table";
import { OrderDetailView } from "@/components/admin/order-section";
import { ProductDetailView } from "@/components/admin/product-section";
import { StoresTable } from "@/components/admin/stores-table";
import { UsersTable } from "@/components/admin/users-table";
import { renderForAdmin } from "@/components/admin/with-admin";
import * as adminApi from "@/lib/api-client/admin";
import type {
  AdminApplicationDto,
  AdminOrderDto,
  AdminProductDto,
  AdminStoreDto,
  AdminUserDto,
  AuditLogDto,
} from "@/modules/admin/schema";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const RLO = String.fromCodePoint(0x202e);

const posix = (path: string) => relative(ROOT, path).split(sep).join("/");

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Module specifiers of the runtime imports and re-exports of a file (type-only ones left out). */
function runtimeSpecifiers(file: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause !== undefined && clause.name === undefined && clause.namedBindings !== undefined) {
        const bindings = clause.namedBindings;
        if (
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly)
        ) {
          continue;
        }
      }
      out.push(statement.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.isTypeOnly
    ) {
      out.push(statement.moduleSpecifier.text);
    }
  }
  // Dynamic import() and require() too.
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** The file a specifier resolves to inside the repository, or the bare package name. */
function resolveSpecifier(from: string, specifier: string): string {
  let base: string | null = null;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  if (base === null) return `package:${specifier}`;
  for (const extension of ["", ...EXTENSIONS]) {
    const candidate = `${base}${extension}`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next extension
    }
  }
  return `unresolved:${specifier}`;
}

const isVirtual = (target: string) =>
  target.startsWith("package:") || target.startsWith("unresolved:");

/** Every file and package reached from `start` through runtime imports, with the path to it. */
function runtimeGraph(start: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[start, [posix(start)]]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (isVirtual(current)) continue;
    for (const specifier of runtimeSpecifiers(parse(current))) {
      const target = resolveSpecifier(current, specifier);
      if (seen.has(target)) continue;
      const trail = [...(seen.get(current) ?? []), isVirtual(target) ? target : posix(target)];
      seen.set(target, trail);
      queue.push(target);
    }
  }
  return seen;
}

const ADMIN_COMPONENTS = join(SRC, "components", "admin");
const ADMIN_APP = join(SRC, "app", "admin");

const adminComponentFiles = () =>
  filesUnder(ADMIN_COMPONENTS, (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));

// ---------------------------------------------------------------------------------------------
// 1. Pages
// ---------------------------------------------------------------------------------------------

const REVIEWED_PAGES = [
  "src/app/admin/applications/page.tsx",
  "src/app/admin/audit-logs/page.tsx",
  "src/app/admin/categories/page.tsx",
  "src/app/admin/layout.tsx",
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/admin/orders/page.tsx",
  "src/app/admin/page.tsx",
  "src/app/admin/products/[id]/page.tsx",
  "src/app/admin/products/page.tsx",
  "src/app/admin/reports/page.tsx",
  "src/app/admin/settings/page.tsx",
  "src/app/admin/stores/page.tsx",
  "src/app/admin/users/page.tsx",
];

describe("T-051: the admin pages hold no data access", () => {
  const files = filesUnder(ADMIN_APP, (path) => /\.(tsx?|jsx?|mjs)$/.test(path));

  it("the files under src/app/admin are exactly the reviewed ones", () => {
    expect(files.map(posix).sort()).toEqual(REVIEWED_PAGES);
  });

  for (const page of REVIEWED_PAGES) {
    it(`${page}: no import of src/modules, src/server, or the API client; no route handler`, () => {
      const path = join(ROOT, page);
      const specifiers = runtimeSpecifiers(parse(path));
      const source = readFileSync(path, "utf8");
      expect(
        specifiers.filter((s) => /^@\/(modules|server|lib\/api-client)\b|prisma|^pg$/.test(s)),
      ).toEqual([]);
      expect(source).not.toMatch(
        /"use server"|'use server'|export (async )?function (GET|POST|PATCH|PUT|DELETE)\b/,
      );
      if (page.endsWith("/page.tsx")) {
        expect(source).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
        const sections = specifiers.filter((s) => /^@\/components\/admin\/.+-section$/.test(s));
        expect(sections).toHaveLength(1);
        const section = readFileSync(resolveSpecifier(path, sections[0] as string), "utf8");
        expect(section).toMatch(/\brenderForAdmin\(/);
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 2. Every admin service call is inside renderForAdmin
// ---------------------------------------------------------------------------------------------

/** Names imported as values from @/modules/admin (the services). */
function serviceNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@/modules/admin" &&
      statement.importClause !== undefined &&
      !statement.importClause.isTypeOnly
    ) {
      const bindings = statement.importClause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements)
          if (!element.isTypeOnly) names.add(element.name.text);
      }
      if (statement.importClause.name !== undefined) names.add(statement.importClause.name.text);
    }
  }
  return names;
}

function insideRenderForAdminCallback(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isCallExpression(current.parent) &&
      ts.isIdentifier(current.parent.expression) &&
      current.parent.expression.text === "renderForAdmin" &&
      current.parent.arguments[1] === current
    ) {
      return true;
    }
  }
  return false;
}

describe("T-051: no admin service is reached before the session and role are read", () => {
  it("every use of an @/modules/admin value in src/components/admin is inside the renderForAdmin callback", () => {
    const outside: string[] = [];
    let uses = 0;
    for (const path of adminComponentFiles()) {
      const file = parse(path);
      const names = serviceNames(file);
      if (names.size === 0) continue;
      const visit = (node: ts.Node): void => {
        if (
          ts.isIdentifier(node) &&
          names.has(node.text) &&
          !ts.isImportSpecifier(node.parent) &&
          !ts.isNamespaceImport(node.parent) &&
          !ts.isImportClause(node.parent)
        ) {
          uses += 1;
          if (!insideRenderForAdminCallback(node)) {
            outside.push(`${posix(path)}: ${node.parent.getText(file).slice(0, 80)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(outside).toEqual([]);
    // Ten sections read data (dashboard, users, applications, stores, products, product,
    // categories, orders, order, reports, settings, audit): at least one use each.
    expect(uses).toBeGreaterThanOrEqual(12);
  });

  it("control: a service call outside the callback is detected, one inside is not", () => {
    const source = [
      'import { listUsers } from "@/modules/admin";',
      "export async function A(a) { const early = await listUsers(a, {}); return renderForAdmin('/x', async (actor) => listUsers(actor, {})); }",
    ].join("\n");
    const file = ts.createSourceFile(
      "x.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const flags: boolean[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "listUsers"
      ) {
        flags.push(insideRenderForAdminCallback(node.expression));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(serviceNames(file)).toEqual(new Set(["listUsers"]));
    expect(flags).toEqual([false, true]);
  });

  it("no file in src/components/admin imports the database, the session reader other than getActor, or a repository", () => {
    const bad: string[] = [];
    for (const path of adminComponentFiles()) {
      for (const specifier of runtimeSpecifiers(parse(path))) {
        if (/^@\/server\/db|prisma|^pg$|\/repository$|^@\/server\/env/.test(specifier)) {
          bad.push(`${posix(path)} -> ${specifier}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. renderForAdmin
// ---------------------------------------------------------------------------------------------

describe("T-051: renderForAdmin decides on the role before calling its callback", () => {
  beforeEach(() => {
    getActor.mockReset();
    redirectMarker.target = null;
  });

  const actor = (role: "CUSTOMER" | "SELLER" | "ADMIN") => ({
    userId: `u-${role}`,
    role,
    storeId: role === "SELLER" ? "s1" : null,
    storeStatus: role === "SELLER" ? "APPROVED" : null,
  });

  it("a visitor without a session is redirected to sign-in and the callback never runs", async () => {
    getActor.mockResolvedValue(null);
    const render = vi.fn(async () => "DATA");
    await expect(renderForAdmin("/admin/users", render)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMarker.target).toBe("/sign-in?next=%2Fadmin%2Fusers");
    expect(render).not.toHaveBeenCalled();
  });

  for (const role of ["CUSTOMER", "SELLER"] as const) {
    it(`a ${role} gets the refusal state and the callback never runs`, async () => {
      getActor.mockResolvedValue(actor(role));
      const render = vi.fn(async () => "DATA");
      const result = await renderForAdmin("/admin/users", render);
      expect(render).not.toHaveBeenCalled();
      const html = renderToStaticMarkup(createElement("div", null, result));
      expect(html).not.toContain("DATA");
    });
  }

  it("a failing session read shows the error state and never calls the callback", async () => {
    getActor.mockRejectedValue(new Error("database down"));
    const render = vi.fn(async () => "DATA");
    const result = await renderForAdmin("/admin/users", render);
    expect(render).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(createElement("div", null, result))).not.toContain("database down");
  });

  it("an ADMIN reaches the callback with the actor of the session (control)", async () => {
    const admin = actor("ADMIN");
    getActor.mockResolvedValue(admin);
    const render = vi.fn(async () => "DATA");
    expect(await renderForAdmin("/admin/users", render)).toBe("DATA");
    expect(render).toHaveBeenCalledWith(admin);
  });

  it("an unexpected error inside the callback is not shown to the admin", async () => {
    getActor.mockResolvedValue(actor("ADMIN"));
    const result = await renderForAdmin("/admin/users", async () => {
      throw new Error("SELECT secret FROM x");
    });
    expect(renderToStaticMarkup(createElement("div", null, result))).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Client components reach no server code
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_IN_CLIENT: [RegExp, string][] = [
  [/^src\/server\/db\//, "database layer"],
  [/^src\/server\/auth\/session\.ts$/, "session reader"],
  [/^src\/server\/env/, "environment"],
  [/^src\/server\/logger/, "server logger"],
  [/^src\/modules\/[^/]+\/(service|repository|index)\.tsx?$/, "module service or index"],
  [/^src\/modules\/admin\/schema\.ts$/, "admin schema (imports the module services)"],
  [/^src\/components\/admin\/queries\.ts$/, "server-only query parser"],
  [/^src\/components\/admin\/with-admin\.tsx$/, "server-only guard frame"],
  [/^prisma\//, "prisma"],
  [/^package:(pg|@prisma\/.*|next\/headers|server-only|node:.*)$/, "server package"],
];

describe("T-051: the admin client components reach no server code", () => {
  const clientFiles = adminComponentFiles().filter((path) =>
    /^\s*["']use client["']/.test(readFileSync(path, "utf8")),
  );

  it("the client component list is the reviewed one", () => {
    expect(clientFiles.map(posix).sort()).toEqual([
      "src/components/admin/action-button.tsx",
      "src/components/admin/applications-table.tsx",
      "src/components/admin/audit-table.tsx",
      "src/components/admin/categories-panel.tsx",
      "src/components/admin/orders-table.tsx",
      "src/components/admin/products-table.tsx",
      "src/components/admin/settings-form.tsx",
      "src/components/admin/stores-table.tsx",
      "src/components/admin/users-table.tsx",
    ]);
  });

  it("control: the graph does find server code from a server-only admin file", () => {
    const names = [...runtimeGraph(join(ADMIN_COMPONENTS, "dashboard-section.tsx")).keys()].map(
      (target) => (isVirtual(target) ? target : posix(target)),
    );
    expect(names).toContain("src/server/auth/session.ts");
    expect(names).toContain("src/modules/admin/index.ts");
    expect(names.some((name) => name.startsWith("src/server/db/"))).toBe(true);
  });

  for (const path of clientFiles) {
    it(`${posix(path)}: no runtime import path to server code`, () => {
      const graph = runtimeGraph(path);
      const hits: string[] = [];
      for (const [target, trail] of graph) {
        const name = isVirtual(target) ? target : posix(target);
        for (const [pattern, label] of FORBIDDEN_IN_CLIENT) {
          if (pattern.test(name)) hits.push(`${label}: ${trail.join(" -> ")}`);
        }
        if (name.startsWith("unresolved:")) hits.push(`unresolved: ${trail.join(" -> ")}`);
      }
      expect(hits).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 5. Hostile text renders as text
// ---------------------------------------------------------------------------------------------

const SCRIPT = "<script>alert(1)</script>";
const IMG = '<img src=x onerror="alert(2)">';
const hostile = (label: string) => `${label}${RLO}${SCRIPT}${IMG}`;

/** Markup is safe when no hostile tag survives and each hostile value is inside a bdi. */
function expectInert(html: string): void {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<img[^>]*onerror/i);
  expect(html).not.toMatch(/\son[a-z]+="alert/i);
  expect(html).toContain("&lt;script&gt;");
}

function bdiCount(html: string, label: string): number {
  return [...html.matchAll(/<bdi>([\s\S]*?)<\/bdi>/g)].filter((match) =>
    (match[1] ?? "").startsWith(label),
  ).length;
}

const product: AdminProductDto = {
  id: "p1",
  slug: "p-1",
  title: hostile("TITLE"),
  description: hostile("DESC"),
  sku: hostile("SKU"),
  category: { id: "c1", name: hostile("CAT"), isActive: true },
  priceSatang: 100,
  stock: 1,
  lowStock: false,
  soldOut: false,
  status: "PUBLISHED",
  moderationStatus: "PENDING",
  moderationNote: hostile("NOTE"),
  images: [{ key: "k1", url: "/api/files/k1" }] as AdminProductDto["images"],
  isSample: false,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
  contentRevision: 2,
  moderationRequestedAt: "2026-10-11T12:00:00.000Z",
  store: { id: "s1", name: hostile("STORE"), slug: "s-1", status: "APPROVED" },
};

describe("T-051: seller and customer text renders as isolated, escaped text (TM-15)", () => {
  it("product review page: title, description, sku, category, store, moderation note", () => {
    const html = renderToStaticMarkup(createElement(ProductDetailView, { product }));
    expectInert(html);
    for (const label of ["TITLE", "DESC", "SKU", "CAT", "STORE", "NOTE"]) {
      expect(bdiCount(html, label), label).toBeGreaterThanOrEqual(1);
    }
  });

  it("applications table: applicant name and email, store name, description, review note", () => {
    const application: AdminApplicationDto = {
      id: "a1",
      applicant: { id: "u1", name: hostile("NAME"), email: hostile("MAIL"), isActive: true },
      storeName: hostile("STORE"),
      description: hostile("DESC"),
      contactPhone: "0812345678",
      status: "REJECTED",
      reviewNote: hostile("NOTE"),
      reviewedAt: "2026-10-11T10:00:00.000Z",
      createdAt: "2026-10-11T10:00:00.000Z",
    };
    const html = renderToStaticMarkup(createElement(ApplicationsTable, { items: [application] }));
    expectInert(html);
    for (const label of ["NAME", "MAIL", "STORE", "DESC", "NOTE"]) {
      expect(bdiCount(html, label), label).toBe(1);
    }
  });

  it("stores table: name, slug, status reason", () => {
    const store: AdminStoreDto = {
      id: "s1",
      name: hostile("STORE"),
      slug: hostile("SLUG"),
      description: hostile("DESC"),
      logo: null,
      contactPhone: "0812345678",
      status: "SUSPENDED",
      statusReason: hostile("REASON"),
      isSample: false,
      ownerId: "u1",
      ownerIsActive: true,
      createdAt: "2026-10-11T10:00:00.000Z",
    };
    const html = renderToStaticMarkup(createElement(StoresTable, { items: [store] }));
    expectInert(html);
    for (const label of ["STORE", "SLUG", "REASON"]) expect(bdiCount(html, label), label).toBe(1);
  });

  it("users table: name, email, store name", () => {
    const user: AdminUserDto = {
      id: "u1",
      name: hostile("NAME"),
      email: hostile("MAIL"),
      phone: null,
      role: "SELLER",
      isActive: true,
      createdAt: "2026-10-11T10:00:00.000Z",
      store: { id: "s1", name: hostile("STORE"), slug: "s-1", status: "APPROVED" },
    };
    const html = renderToStaticMarkup(createElement(UsersTable, { items: [user], selfId: "x" }));
    expectInert(html);
    for (const label of ["NAME", "MAIL", "STORE"]) expect(bdiCount(html, label), label).toBe(1);
  });

  it("order detail: address, store name, item title, carrier, tracking", () => {
    const order = {
      id: "o1",
      orderNumber: "ORD-1",
      createdAt: "2026-10-11T10:00:00.000Z",
      paidAt: null,
      paymentStatus: "PENDING",
      payment: { method: "MOCK", status: "PENDING", isSimulated: true },
      userId: "u1",
      itemsSubtotalSatang: 100,
      shippingTotalSatang: 0,
      grandTotalSatang: 100,
      shippingAddress: {
        recipientName: hostile("RCPT"),
        phone: "0812345678",
        line1: hostile("LINE"),
        subdistrict: hostile("SUBD"),
        district: hostile("DIST"),
        province: hostile("PROV"),
        postalCode: "10110",
      },
      sellerOrders: [
        {
          id: "so1",
          storeId: "s1",
          storeName: hostile("STORE"),
          fulfilmentStatus: "SHIPPED",
          cancellationKind: null,
          commissionRateBps: 500,
          itemsSubtotalSatang: 100,
          shippingFeeSatang: 0,
          shippingFeeIsSimulated: true,
          shipment: {
            carrierName: hostile("CARRIER"),
            trackingNumber: hostile("TRACK"),
            shippedAt: "2026-10-11T10:00:00.000Z",
            deliveredAt: null,
          },
          items: [
            {
              id: "i1",
              productTitle: hostile("ITEM"),
              image: null,
              unitPriceSatang: 100,
              quantity: 1,
              lineTotalSatang: 100,
            },
          ],
        },
      ],
    } as unknown as AdminOrderDto;
    const html = renderToStaticMarkup(createElement(OrderDetailView, { order }));
    expectInert(html);
    for (const label of [
      "RCPT",
      "LINE",
      "SUBD",
      "DIST",
      "PROV",
      "STORE",
      "ITEM",
      "CARRIER",
      "TRACK",
    ]) {
      expect(bdiCount(html, label), label).toBe(1);
    }
  });

  it("audit log: metadata holding markup is shown as escaped JSON text", () => {
    const entry: AuditLogDto = {
      id: "l1",
      actorId: "u1",
      action: "store.suspend",
      targetType: "Store",
      targetId: "s1",
      metadata: { reason: `</pre></details>${SCRIPT}${IMG}` },
      createdAt: "2026-10-11T10:00:00.000Z",
    } as unknown as AuditLogDto;
    const html = renderToStaticMarkup(createElement(AuditTable, { items: [entry] }));
    expectInert(html);
    // The value cannot close the pre or details early: exactly one of each, the value escaped.
    expect(html.match(/<\/pre>/g)).toHaveLength(1);
    expect(html.match(/<\/details>/g)).toHaveLength(1);
    expect(html).toContain("&lt;/pre&gt;&lt;/details&gt;&lt;script&gt;");
  });

  it("no admin file writes raw HTML, a javascript: URL, or touches innerHTML", () => {
    const bad: string[] = [];
    for (const path of [
      ...adminComponentFiles(),
      ...filesUnder(ADMIN_APP, (p) => /\.tsx?$/.test(p)),
    ]) {
      const source = readFileSync(path, "utf8");
      if (
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|javascript:|\beval\(|new Function\(/.test(
          source,
        )
      ) {
        bad.push(posix(path));
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Storefront shell
// ---------------------------------------------------------------------------------------------

describe("T-051: the storefront shell links to no admin page", () => {
  it("no file under src/components/shell names /admin or the admin routes", () => {
    const shell = filesUnder(
      join(SRC, "components", "shell"),
      (p) => /\.tsx?$/.test(p) && !/\.test\./.test(p),
    );
    expect(shell.length).toBeGreaterThan(0);
    for (const path of shell) {
      const source = readFileSync(path, "utf8");
      expect(source, posix(path)).not.toMatch(/["'`]\/admin|ADMIN_ROUTES|components\/admin/);
    }
  });

  it("no storefront or seller file outside the admin area links to /admin", () => {
    const files = [
      ...filesUnder(join(SRC, "app"), (p) => /\.tsx?$/.test(p) && !/\.test\./.test(p)),
      ...filesUnder(join(SRC, "components"), (p) => /\.tsx?$/.test(p) && !/\.test\./.test(p)),
      ...filesUnder(join(SRC, "lib"), (p) => /\.tsx?$/.test(p) && !/\.test\./.test(p)),
    ].filter((p) => {
      const name = posix(p);
      return (
        !name.startsWith("src/app/admin/") &&
        !name.startsWith("src/components/admin/") &&
        !name.startsWith("src/app/api/v1/admin/") &&
        name !== "src/lib/api-client/admin.ts"
      );
    });
    const hits = files.filter((p) => /["'`]\/admin(\/|["'`?])/.test(readFileSync(p, "utf8")));
    expect(hits.map(posix)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. The admin API client
// ---------------------------------------------------------------------------------------------

describe("T-051: admin mutations go to /api/v1/admin as same-origin JSON", () => {
  type Call = { url: string; init: RequestInit };
  const calls: Call[] = [];
  const stub = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  beforeEach(() => {
    calls.length = 0;
  });

  it("every exported call: path under /api/v1/admin, JSON content type, same-origin, no-store, id in one segment", async () => {
    const id = "a/b?c#d";
    await adminApi.deactivateUser(id, stub);
    await adminApi.reactivateUser(id, stub);
    await adminApi.approveApplication(id, stub);
    await adminApi.rejectApplication(id, { reason: "r" }, stub);
    await adminApi.suspendStore(id, { reason: "r" }, stub);
    await adminApi.reinstateStore(id, { reason: "r" }, stub);
    await adminApi.approveProduct(id, { contentRevision: 1 }, stub);
    await adminApi.rejectProduct(id, { contentRevision: 1, reason: "r" }, stub);
    await adminApi.takedownProduct(id, { contentRevision: 1, reason: "r" }, stub);
    await adminApi.createCategory({ name: "n" }, stub);
    await adminApi.updateCategory(id, { isActive: false }, stub);
    await adminApi.deleteCategory(id, stub);
    await adminApi.changeSellerOrderStatus(id, { to: "CANCELLED" }, stub);
    await adminApi.updateSettings({ commissionRateBps: 500 }, stub);
    expect(calls).toHaveLength(14);
    const exported = Object.entries(adminApi).filter(([, value]) => typeof value === "function");
    expect(exported).toHaveLength(14);
    for (const { url, init } of calls) {
      expect(url.startsWith("/api/v1/admin/")).toBe(true);
      expect(url).not.toContain("a/b");
      expect(url).not.toMatch(/[?#]/);
      expect(["POST", "PATCH", "DELETE"]).toContain(init.method);
      expect(new Headers(init.headers).get("content-type")).toBe("application/json");
      expect(init.credentials).toBe("same-origin");
      expect(init.cache).toBe("no-store");
    }
  });
});
