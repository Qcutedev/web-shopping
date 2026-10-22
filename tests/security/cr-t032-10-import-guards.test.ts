/**
 * CR-T032-10 import-guard probe, security, 2026-10-22. Owner: security.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Architecture rule 7 (CLAUDE.md) and TM-12 (docs/SECURITY.md) rest on import rules. This file
 * checks, independently of scripts/check-import-guards.mjs, that the rules fail when they should:
 *
 *   1. ESLint, as configured in eslint.config.mjs, reports an error when a forbidden file (page,
 *      route handler, component, client library, proxy, platform code) imports src/server/db in
 *      any spelling: alias, relative, deep path, type-only, side effect, re-export, dynamic
 *      import, require, TypeScript import-equals, upper case, and paths not in normal form.
 *      Spellings that get past ESLint are rejected by the hardened src guard (SEC-081).
 *   2. The real tree: no inline disable of the guard rules, no createRequire outside the db layer,
 *      and no module that re-exports a database value from src/server/db.
 *   3. CR-T032-10: the payment transitions (`completeOrderPayment`, `failOrderPayment`,
 *      `failOverdueOrders`, `runPaymentTimeoutSweep`) are on the public surface of the orders
 *      module. No lint rule limits who imports them. A TypeScript-AST checker below does: only
 *      src/modules/orders/** and src/modules/checkout/service.ts may bind them. The checker is
 *      first shown to fail on every forbidden spelling (alias, relative, deep, renamed,
 *      namespace, re-export, export star, dynamic import, require), then run over the tree.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix as posixPath, relative, sep } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|itest)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function posix(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

function filesUnder(directory: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (CODE.test(name)) out.push(posix(path));
  }
  return out;
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Hand-written code that ships or runs against the database: src, the seed, scripts. */
const SOURCE_FILES = [
  ...filesUnder(join(ROOT, "src")),
  ...filesUnder(join(ROOT, "scripts")),
  "prisma/seed.ts",
].filter((path) => !TEST_FILE.test(path));

// ---------------------------------------------------------------------------------------------
// Part 1: ESLint rejects every spelling of a forbidden import of src/server/db
// ---------------------------------------------------------------------------------------------

const GUARD_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
let eslint: ESLint;

async function guardErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\nexport {};\n`, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2 && GUARD_RULES.has(message.ruleId ?? ""))
    .map((message) => `${message.ruleId ?? ""}: ${message.message}`);
}

/** Files that rule 7 forbids from importing src/server/db, one per kind of presentation code. */
const FORBIDDEN_FILES = [
  "src/app/(storefront)/products/[slug]/page.tsx",
  "src/app/seller/orders/page.tsx",
  "src/app/admin/layout.tsx",
  "src/app/api/v1/checkout/route.ts",
  "src/app/api/v1/orders/[id]/route.ts",
  "src/components/seller/probe-view.tsx",
  "src/components/ui/probe.tsx",
  "src/lib/api-client/probe.ts",
  "src/i18n/probe.ts",
  "src/proxy.ts",
  "src/instrumentation.ts",
  "src/server/logger.ts",
  "src/server/env.ts",
];

/** Spellings, written for a file two folders below src (src/x/y/file). */
const DB_SPELLINGS = [
  'import { db } from "@/server/db";',
  'import { db } from "@/server/db/";',
  'import { db } from "@/server/db/index";',
  'import { db } from "@/server/db/index.ts";',
  'import { db } from "@/server/db/client";',
  'import { db } from "@/server/db/client.ts";',
  'import type { Db } from "@/server/db";',
  'import { type Db } from "@/server/db";',
  'import * as layer from "@/server/db";',
  'import "@/server/db";',
  'import { db } from "../../server/db";',
  'import { db } from "../../server/db/client";',
  'import { db } from "../../../src/server/db";',
  'export * from "@/server/db";',
  'export * as layer from "@/server/db";',
  'export { db } from "@/server/db";',
  'export { db as client } from "../../server/db";',
  'export type { Db } from "@/server/db";',
  'const m = await import("@/server/db");',
  'const m = await import("../../server/db/client");',
  "const m = await import(`@/server/db`);",
  'const p = "@/server/db"; const m = await import(p);',
  'const m = await import("@/server/" + "db");',
  'import { db } from "@/server/DB";',
  'import { db } from "@/Server/db";',
  'import { db } from "@/server/./db";',
  'import { db } from "@/server//db";',
  'import { db } from "@/modules/../server/db";',
  'import { db } from "@/server/auth/../db";',
];

describe("rule 7: ESLint rejects a forbidden import of src/server/db", () => {
  beforeAll(() => {
    eslint = new ESLint({ cwd: ROOT });
  });

  for (const filePath of FORBIDDEN_FILES) {
    it(`${filePath}: every spelling is an error`, async () => {
      const missed: string[] = [];
      for (const code of DB_SPELLINGS) {
        if ((await guardErrors(filePath, code)).length === 0) missed.push(code);
      }
      expect(missed).toEqual([]);
    }, 120_000);
  }

  it("JavaScript files: require and dynamic import are errors", async () => {
    for (const code of [
      'const db = require("@/server/db");',
      'const db = require("../../server/db");',
      "const db = require(`@/server/db`);",
      'const n = "@/server/db"; const db = require(n);',
      'const m = import("@/server/db");',
    ]) {
      expect(await guardErrors("src/app/x/probe.js", code), code).not.toEqual([]);
      expect(await guardErrors("src/components/x/probe.jsx", code), code).not.toEqual([]);
      expect(await guardErrors("src/lib/x/probe.mjs", code), code).not.toEqual([]);
      expect(await guardErrors("src/lib/x/probe.cjs", code), code).not.toEqual([]);
    }
  }, 120_000);

  it("TypeScript import-equals is an error", async () => {
    expect(
      await guardErrors("src/app/x/probe.ts", 'import db = require("@/server/db");'),
    ).not.toEqual([]);
  });

  it("a sibling in src/server (not auth, not health.ts) may not use a short relative path", async () => {
    for (const [file, code] of [
      ["src/server/probe.ts", 'import { db } from "./db";'],
      ["src/server/probe.ts", 'import { db } from "./db/client";'],
      ["src/server/x/probe.ts", 'import { db } from "../db";'],
      ["src/server/probe.ts", 'const m = await import("./db");'],
      ["src/server/probe.ts", 'export * from "./db";'],
    ] as const) {
      expect(await guardErrors(file, code), `${file}: ${code}`).not.toEqual([]);
    }
  });

  it("the probe is not vacuous: allowed importers and harmless imports lint clean", async () => {
    for (const [file, code] of [
      ["src/modules/orders/probe.ts", 'import { db } from "@/server/db";'],
      ["src/modules/orders/probe.ts", 'import { db } from "../../server/db";'],
      ["src/server/auth/probe.ts", 'import { db } from "../db";'],
      ["src/server/health.ts", 'import { db } from "./db";'],
      ["prisma/seed.ts", 'import { db } from "../src/server/db";'],
      ["scripts/probe.ts", 'import { db } from "../src/server/db";'],
      ["src/app/x/probe.ts", 'import { listOrders } from "@/modules/orders";'],
      ["src/app/x/probe.ts", 'import { logger } from "@/server/logger";'],
      ["src/app/x/probe.ts", 'import { dbg } from "@/server/dbg";'],
      ["src/app/x/probe.ts", 'import { x } from "@/server/db-schema-docs";'],
    ] as const) {
      expect(await guardErrors(file, code), `${file}: ${code}`).toEqual([]);
    }
  });

  it("the error is reported against the real file path of a route handler", async () => {
    const path = "src/app/api/v1/checkout/route.ts";
    const source = read(path);
    expect(await guardErrors(path, source)).toEqual([]);
    expect(await guardErrors(path, `import { db } from "@/server/db";\n${source}`)).not.toEqual([]);
  });
});

// SEC-081: spellings that load src/server/db at run time and get past ESLint. Each case asserts
// the secure behaviour (an error); the guard was extended in eslint.config.mjs.
describe("SEC-081: spellings that get past the rule 7 lint guard", () => {
  beforeAll(() => {
    eslint ??= new ESLint({ cwd: ROOT });
  });

  for (const [label, file, code] of [
    [
      "an inline eslint-disable comment",
      "src/app/x/probe.ts",
      '/* eslint-disable no-restricted-imports */\nimport { db } from "@/server/db";',
    ],
    [
      "an eslint-disable-next-line comment",
      "src/app/x/probe.ts",
      '// eslint-disable-next-line no-restricted-imports\nimport { db } from "@/server/db";',
    ],
    [
      "createRequire",
      "src/app/x/probe.ts",
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nconst m = load("../../server/db");',
    ],
    [
      "an aliased require",
      "src/app/x/probe.js",
      'const r = require;\nconst m = r("../../server/db");',
    ],
    ["module.require", "src/app/x/probe.js", 'const m = module.require("../../server/db");'],
    ["require.call", "src/app/x/probe.js", 'const m = require.call(null, "../../server/db");'],
  ] as const) {
    it(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Part 2: the real tree holds none of the spellings that get past ESLint
// ---------------------------------------------------------------------------------------------

describe("rule 7: the real tree", () => {
  it("scans a non-trivial set of files", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(200);
    expect(SOURCE_FILES).toContain("src/app/api/v1/checkout/route.ts");
    expect(SOURCE_FILES).toContain("src/modules/orders/index.ts");
  });

  // The probe script holds the forbidden spellings as test data, in strings.
  const SCANNED = SOURCE_FILES.filter((path) => path !== "scripts/check-import-guards.mjs");

  it("no hand-written source file disables a lint rule inline", () => {
    const offenders = SCANNED.filter((path) =>
      /eslint-disable|eslint-enable|eslint\s+no-restricted|\/\*\s*eslint\s/.test(read(path)),
    );
    expect(offenders).toEqual([]);
  });

  it("createRequire, module.require, and an aliased require appear only in the db layer", () => {
    const offenders = SCANNED.filter((path) => !path.startsWith("src/server/db/")).filter((path) =>
      /createRequire|module\.require|require\.call|=\s*require\s*[;,\n]/.test(read(path)),
    );
    expect(offenders).toEqual([]);
  });

  // SEC-081 re-check (2026-10-22): further spellings that get past the guard, probed in
  // scripts/check-import-guards.mjs. None may appear in the real tree outside the db layer.
  it("no other indirect loader appears outside the db layer", () => {
    const INDIRECT =
      /["'](node:)?module["']|getBuiltinModule|globalThis\.require|require\s*\.\s*(apply|call|bind)|require\s*\[|\brequire\s*:|\beval\s*\(|new\s+Function\s*\(/;
    const offenders = SCANNED.filter((path) => !path.startsWith("src/server/db/")).filter((path) =>
      INDIRECT.test(read(path)),
    );
    expect(offenders).toEqual([]);
  });

  it("no module re-exports a database value from src/server/db", () => {
    // Pure helpers that read an error object; they open no connection and hold no client.
    const PURE = new Set([
      "isUniqueIndexViolation",
      "isRawUniqueIndexViolation",
      "isUniqueViolation",
      "UNIQUE_VIOLATION_SQLSTATE",
    ]);
    const offenders: string[] = [];
    for (const path of SOURCE_FILES.filter((p) => p.startsWith("src/modules/"))) {
      const sf = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
      const fromDb = new Set<string>();
      const isDb = (spec: string): boolean => /(^|\/)server\/db(\/|$)/.test(spec);
      for (const statement of sf.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          isDb(statement.moduleSpecifier.text)
        ) {
          const bindings = statement.importClause?.namedBindings;
          if (statement.importClause?.name) fromDb.add(statement.importClause.name.text);
          if (bindings && ts.isNamespaceImport(bindings)) fromDb.add(bindings.name.text);
          if (bindings && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) if (!el.isTypeOnly) fromDb.add(el.name.text);
          }
        }
        if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
        const spec =
          statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : undefined;
        const clause = statement.exportClause;
        if (spec !== undefined && isDb(spec)) {
          if (!clause || ts.isNamespaceExport(clause))
            offenders.push(`${path}: export * from ${spec}`);
          else
            for (const el of clause.elements) {
              const name = (el.propertyName ?? el.name).text;
              if (!el.isTypeOnly && !PURE.has(name)) offenders.push(`${path}: ${name}`);
            }
        } else if (spec === undefined && clause && ts.isNamedExports(clause)) {
          for (const el of clause.elements) {
            const name = (el.propertyName ?? el.name).text;
            if (!el.isTypeOnly && fromDb.has(name) && !PURE.has(name))
              offenders.push(`${path}: ${name}`);
          }
        }
      }
      // `export const x = db` or `export default db`: an exported declaration naming a db import.
      for (const statement of sf.statements) {
        const exported =
          ts.isExportAssignment(statement) ||
          (ts.isVariableStatement(statement) &&
            statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
        if (!exported) continue;
        const names = new Set<string>();
        const visit = (node: ts.Node): void => {
          if (ts.isIdentifier(node) && fromDb.has(node.text) && !PURE.has(node.text)) {
            // Only a bare alias counts; using `db` inside a function body is the module's job.
            const parent = node.parent;
            if (
              ts.isVariableDeclaration(parent) ||
              ts.isExportAssignment(parent) ||
              ts.isPropertyAssignment(parent) ||
              ts.isShorthandPropertyAssignment(parent)
            )
              names.add(node.text);
          }
          if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
        };
        visit(statement);
        for (const name of names) offenders.push(`${path}: exported alias of ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Part 3: CR-T032-10, who may reach a payment transition (TM-12)
// ---------------------------------------------------------------------------------------------

const TRANSITIONS = new Set([
  "completeOrderPayment",
  "failOrderPayment",
  "failOverdueOrders",
  "runPaymentTimeoutSweep",
  "markOrderPaid",
  "failOrder",
]);

/** Files outside the orders module that may bind a transition, and which ones. */
const ALLOWED: Record<string, readonly string[]> = {
  "src/modules/checkout/service.ts": ["completeOrderPayment", "failOrderPayment"],
};

/** Repository-relative path an import specifier names, or undefined for a package. */
function resolveSpecifier(fromFile: string, spec: string): string | undefined {
  let target: string;
  if (spec.startsWith("@/")) target = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) target = posixPath.join(posixPath.dirname(fromFile), spec);
  else return undefined;
  return posixPath
    .normalize(target.replaceAll("\\", "/"))
    .replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "")
    .replace(/\/index$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function isOrdersModule(fromFile: string, spec: string): boolean {
  const target = resolveSpecifier(fromFile, spec);
  return target !== undefined && /^src\/modules\/orders(\/|$)/.test(target);
}

/**
 * Every way `path` binds or re-exports a payment transition, or the whole orders module (which
 * hands out every transition). Returns one line per violation; [] when the file is clean.
 */
function transitionBindings(path: string, source: string): string[] {
  if (path.startsWith("src/modules/orders/")) return [];
  const allowed = new Set(ALLOWED[path] ?? []);
  const out: string[] = [];
  const kind = /\.(js|jsx|mjs|cjs)$/.test(path) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const flag = (what: string): void => {
    out.push(`${path}: ${what}`);
  };
  const checkName = (name: string, how: string): void => {
    if (TRANSITIONS.has(name) && !allowed.has(name)) flag(`${how} ${name}`);
  };

  /** A dynamic import or require result: only destructuring of allowed names is acceptable. */
  const checkModuleValue = (call: ts.Node, how: string): void => {
    let node: ts.Node = call;
    while (ts.isAwaitExpression(node.parent) || ts.isParenthesizedExpression(node.parent)) {
      node = node.parent;
    }
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)) {
      for (const el of parent.name.elements) {
        if (el.dotDotDotToken) {
          flag(`${how} rest binding`);
          continue;
        }
        const key = el.propertyName ?? el.name;
        if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) {
          flag(`${how} computed binding`);
          continue;
        }
        checkName(key.text, how);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      checkName(parent.name.text, how);
      return;
    }
    flag(`${how} whole module object`);
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isOrdersModule(path, node.moduleSpecifier.text) &&
      !node.importClause?.isTypeOnly
    ) {
      const clause = node.importClause;
      if (clause?.name) flag("default import of the orders module");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) flag("namespace import of the orders module");
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (!el.isTypeOnly) checkName((el.propertyName ?? el.name).text, "import");
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (
        ts.isExternalModuleReference(ref) &&
        ts.isStringLiteral(ref.expression) &&
        isOrdersModule(path, ref.expression.text)
      ) {
        flag("import-equals of the orders module");
      }
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const spec =
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
      const clause = node.exportClause;
      if (spec !== undefined && isOrdersModule(path, spec)) {
        if (!clause || ts.isNamespaceExport(clause)) flag("export star from the orders module");
        else
          for (const el of clause.elements)
            checkName((el.propertyName ?? el.name).text, "re-export");
      }
      // A local re-export (`export { completeOrderPayment }`), or one from another file that
      // passes the name on, widens the surface even in an allowed file.
      if (
        (spec === undefined || !isOrdersModule(path, spec)) &&
        clause &&
        ts.isNamedExports(clause)
      ) {
        for (const el of clause.elements) {
          const name = (el.propertyName ?? el.name).text;
          if (TRANSITIONS.has(name)) flag(`re-export ${name} from outside the orders module`);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isImport || isRequire) {
        const arg = node.arguments[0];
        const how = isImport ? "dynamic import" : "require";
        if (!arg || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          flag(`${how} with a computed specifier`);
        } else if (isOrdersModule(path, arg.text)) {
          checkModuleValue(node, how);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("CR-T032-10: the checker fails on every forbidden way to reach a transition", () => {
  const ROUTE = "src/app/api/v1/orders/[id]/pay/route.ts";
  for (const code of [
    'import { completeOrderPayment } from "@/modules/orders";',
    'import { failOrderPayment as decline } from "@/modules/orders";',
    'import { failOverdueOrders } from "@/modules/orders/service";',
    'import { runPaymentTimeoutSweep } from "@/modules/orders/timeout-sweep";',
    'import { markOrderPaid } from "@/modules/orders/repository";',
    'import { failOrder } from "@/modules/orders/repository.ts";',
    'import { completeOrderPayment } from "@/modules/orders/index";',
    'import { completeOrderPayment } from "../../../../../../modules/orders";',
    'import { completeOrderPayment } from "../../../../../../modules/orders/service.js";',
    'import { completeOrderPayment } from "@/modules/Orders";',
    'import { completeOrderPayment } from "@/modules/checkout/../orders";',
    'import * as orders from "@/modules/orders";',
    'import orders from "@/modules/orders";',
    'import { listOrders, completeOrderPayment } from "@/modules/orders";',
    'export { completeOrderPayment } from "@/modules/orders";',
    'export { completeOrderPayment as pay } from "@/modules/orders";',
    'export * from "@/modules/orders";',
    'export * as orders from "@/modules/orders";',
    'const { completeOrderPayment } = await import("@/modules/orders");',
    'const { completeOrderPayment: pay } = await import("@/modules/orders");',
    'const { ...all } = await import("@/modules/orders");',
    'const m = await import("@/modules/orders");',
    'await (await import("@/modules/orders")).completeOrderPayment("o", "r");',
    "const m = await import(`@/modules/orders`);",
    'const p = "@/modules/orders"; const m = await import(p);',
    'const { completeOrderPayment } = require("@/modules/orders");',
    'const orders = require("../../../../../../modules/orders");',
    'import orders = require("@/modules/orders");',
  ]) {
    it(`flags: ${code}`, () => {
      expect(transitionBindings(ROUTE, code)).not.toEqual([]);
    });
  }

  it("flags a component and a page as well as a route handler", () => {
    const code = 'import { completeOrderPayment } from "@/modules/orders";';
    expect(transitionBindings("src/components/x.tsx", code)).not.toEqual([]);
    expect(transitionBindings("src/app/(storefront)/page.tsx", code)).not.toEqual([]);
    expect(transitionBindings("src/modules/cart/service.ts", code)).not.toEqual([]);
    expect(
      transitionBindings(
        "scripts/probe.ts",
        'import { failOrderPayment } from "../src/modules/orders";',
      ),
    ).not.toEqual([]);
  });

  it("flags an allowed file that binds a transition outside its list or re-exports one", () => {
    const path = "src/modules/checkout/service.ts";
    expect(
      transitionBindings(path, 'import { failOverdueOrders } from "@/modules/orders";'),
    ).not.toEqual([]);
    expect(
      transitionBindings(
        path,
        'import { completeOrderPayment } from "@/modules/orders";\nexport { completeOrderPayment };',
      ),
    ).not.toEqual([]);
    expect(transitionBindings(path, 'export * from "@/modules/orders";')).not.toEqual([]);
    expect(
      transitionBindings(
        "src/modules/checkout/index.ts",
        'export { completeOrderPayment } from "./service";',
      ),
    ).not.toEqual([]);
  });

  it("is not vacuous: safe imports pass", () => {
    const ROUTE_FILE = "src/app/api/v1/orders/route.ts";
    for (const code of [
      'import { listOrders, getOrder } from "@/modules/orders";',
      'import type { SweepResult } from "@/modules/orders";',
      'import { type SweepResult, listOrders } from "@/modules/orders";',
      'import { FULFILMENT_STATUSES } from "@/modules/orders/state";',
      'const { startPaymentTimeoutSweepSchedule } = await import("@/modules/orders");',
      'import { completeOrderPayment } from "@/modules/ordersx";',
      'import { checkout } from "@/modules/checkout";',
    ]) {
      expect(transitionBindings(ROUTE_FILE, code), code).toEqual([]);
    }
    expect(
      transitionBindings(
        "src/modules/checkout/service.ts",
        'import { completeOrderPayment, failOrderPayment } from "@/modules/orders";',
      ),
    ).toEqual([]);
    expect(
      transitionBindings(
        "src/instrumentation.ts",
        'const { startPaymentTimeoutSweepSchedule } = await import("./modules/orders");',
      ),
    ).toEqual([]);
  });
});

describe("CR-T032-10: the real tree", () => {
  it("only src/modules/orders/** and src/modules/checkout/service.ts reach a transition", () => {
    const offenders = SOURCE_FILES.flatMap((path) => transitionBindings(path, read(path)));
    expect(offenders).toEqual([]);
  });

  it("the allowed importer is still the one that binds the transitions (the list is not stale)", () => {
    const source = read("src/modules/checkout/service.ts");
    expect(source).toMatch(/completeOrderPayment/);
    expect(source).toMatch(/failOrderPayment/);
    // The checker sees those bindings; with an empty allow-list the file would be flagged.
    const saved = ALLOWED["src/modules/checkout/service.ts"];
    try {
      ALLOWED["src/modules/checkout/service.ts"] = [];
      expect(transitionBindings("src/modules/checkout/service.ts", source)).not.toEqual([]);
    } finally {
      ALLOWED["src/modules/checkout/service.ts"] = saved ?? [];
    }
  });

  it("the start-up hook takes only the schedule from the orders module", () => {
    expect(transitionBindings("src/instrumentation.ts", read("src/instrumentation.ts"))).toEqual(
      [],
    );
    expect(read("src/instrumentation.ts")).toMatch(/import\("\.\/modules\/orders"\)/);
  });
});
