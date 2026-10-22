// Regression check for architecture rule 7 (CLAUDE.md): checks that the ESLint import guards in
// eslint.config.mjs reject the forbidden import spellings listed below and accept the allowed ones.
// Inline eslint-disable and config comments, createRequire, other indirect require calls, and
// imports of scripts/tests/e2e/prisma from src are rejected (SEC-081, SEC-083, docs/SECURITY.md).
// A probe may carry the expectation "SEC-081" (should be rejected, known gap): the script then
// reports it without failing, and fails once the guard rejects it until the expectation is changed
// to `true`, the same way `it.fails` works. No probe uses it now. Lint selectors over names stay
// incomplete; the owner accepted that residual (docs/DECISIONS.md D-045).
// Not covered, and left to review: re-exports through an allowed folder and type-only
// `typeof import()` queries.
// Nothing is written to disk; each probe is linted from memory under a virtual file name.
// Run: node scripts/check-import-guards.mjs
import { ESLint } from "eslint";

const eslint = new ESLint();

/**
 * [virtual file, source code, should lint report an error?]. The third element is `true`, `false`,
 * or "SEC-081" (should be an error; a known gap until SEC-081 is fixed).
 */
const probes = [
  // Pages, route handlers, components, platform code, and root files must not reach the db layer.
  ["src/app/probe.ts", 'import { db } from "@/server/db";', true],
  ["src/app/probe.ts", 'import { db } from "@/server/db/client";', true],
  ["src/app/probe.ts", 'import { db } from "../server/db";', true],
  ["src/app/a/b/probe.tsx", 'import { db } from "../../../server/db/client";', true],
  ["src/app/probe.ts", 'export * from "@/server/db";', true],
  ["src/app/probe.ts", 'const m = await import("@/server/db");', true],
  ["src/app/probe.ts", 'const m = await import("../server/db");', true],
  ["src/app/probe.ts", "const p = '@/server/db'; const m = await import(p);", true],
  ["src/app/probe.js", 'import { db } from "@/server/db";', true],
  ["src/app/probe.js", 'const db = require("../server/db");', true],
  ["src/components/probe.tsx", 'import { db } from "@/server/db";', true],
  ["src/server/probe.ts", 'import { db } from "./db";', true],
  ["src/server/health/probe.ts", 'import { db } from "../db";', true],
  ["src/server/logger.ts", 'import { db } from "./db";', true],
  ["src/app/api/health/route.ts", 'import { db } from "@/server/db";', true],
  ["src/app/probe.test.ts", 'import { db } from "@/server/db";', true],
  ["src/proxy.ts", 'import { db } from "@/server/db";', true],
  // Paths that are not in normal form would slip past text matching, so they are rejected.
  ["src/app/probe.ts", 'import { db } from "@/server/./db";', true],
  ["src/app/probe.ts", 'import { db } from "@/server//db";', true],
  ["src/app/probe.ts", 'import { db } from "@/server/auth/../db";', true],
  ["src/app/probe.ts", 'import { db } from "../server/./db";', true],
  ["src/app/probe.ts", 'import { db } from "..\\\\server\\\\db";', true],
  ["src/server/probe.ts", 'import { db } from "././db";', true],
  ["src/server/auth/probe.ts", 'import { db } from ".././db";', true],
  ["src/server/probe.ts", 'import { db } from "./auth/../db";', true],
  ["src/app/probe.ts", 'const m = await import("@/server/DB");', true],
  ["src/app/probe.ts", 'const m = await import("@/server/./db");', true],
  ["src/app/probe.js", "const n = '../server/db'; const db = require(n);", true],
  // In prisma/ only the seed is an allowed importer.
  ["prisma/probe.ts", 'import { db } from "../src/server/db";', true],
  ["prisma/generated/prisma/probe.ts", 'import { db } from "../../../src/server/db";', true],
  // The seed goes through the db layer like every other allowed importer (rule 7, CR-18): it may
  // not import the client, the adapter, the driver, or the generated client. The same holds for
  // any other hand-written file under prisma/.
  ["prisma/seed.ts", 'import { PrismaClient } from "@prisma/client";', true],
  ["prisma/seed.ts", 'import { PrismaPg } from "@prisma/adapter-pg";', true],
  ["prisma/seed.ts", 'import { Pool } from "pg";', true],
  ["prisma/seed.ts", 'import { PrismaClient } from "./generated/prisma/client";', true],
  ["prisma/seed.ts", 'const m = await import("@prisma/client");', true],
  ["prisma/probe.ts", 'import { PrismaClient } from "@prisma/client";', true],
  ["prisma/probe.ts", 'import { Role } from "./generated/prisma/enums";', true],
  // Nobody outside the db layer may import the client or a driver, allowed importers included.
  ["src/server/auth/probe.ts", 'import { PrismaClient } from "@prisma/client";', true],
  ["src/server/health.ts", 'import { Pool } from "pg";', true],
  ["scripts/probe.ts", 'import { PrismaClient } from "@prisma/client";', true],
  ["tests/helpers/probe.ts", 'const m = await import("@prisma/client");', true],
  ["src/app/probe.ts", 'import { PrismaClient } from "@prisma/client";', true],
  ["src/modules/catalog/probe.ts", 'import { PrismaClient } from "@prisma/client";', true],
  ["src/modules/catalog/probe.js", 'import { PrismaClient } from "@prisma/client";', true],
  ["src/modules/catalog/probe.ts", 'import { Pool } from "pg";', true],
  ["src/modules/catalog/probe.ts", 'const m = await import("@prisma/client");', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "../../generated/prisma/client";', true],
  // The driver adapter, the adapter utilities, the pg companion packages, and the generated client
  // at its pinned location (T-013) are covered as well.
  ["src/modules/catalog/probe.ts", 'import { PrismaPg } from "@prisma/adapter-pg";', true],
  ["src/server/auth/probe.ts", 'import { PrismaPg } from "@prisma/adapter-pg";', true],
  ["src/server/health.ts", 'const m = await import("@prisma/adapter-pg");', true],
  ["scripts/probe.ts", 'import { PrismaPg } from "@prisma/adapter-pg";', true],
  ["tests/helpers/probe.ts", 'import { PrismaPg } from "@prisma/adapter-pg";', true],
  ["src/app/probe.js", 'const { PrismaPg } = require("@prisma/adapter-pg");', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@prisma/driver-adapter-utils";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@prisma/client/runtime/client";', true],
  ["src/modules/catalog/probe.ts", 'import Pool from "pg-pool";', true],
  ["src/modules/catalog/probe.ts", 'import { parse } from "pg-connection-string";', true],
  ["src/modules/catalog/probe.ts", 'import { Pool } from "pg/lib/index.js";', true],
  [
    "src/modules/catalog/probe.ts",
    'import { PrismaClient } from "../../../prisma/generated/prisma/client";',
    true,
  ],
  [
    "tests/helpers/probe.ts",
    'const m = await import("../../prisma/generated/prisma/client");',
    true,
  ],
  ["scripts/probe.ts", 'import { Role } from "../prisma/generated/prisma/enums";', true],
  // D-022 (CR-65): a module (not its tests) reaches the auth layer only through actor.ts.
  ["src/modules/catalog/probe.ts", 'import { getActor } from "@/server/auth/session";', true],
  ["src/modules/catalog/probe.ts", 'import { getAuth } from "@/server/auth/auth";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@/server/auth/config";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@/server/auth/routes";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@/server/auth";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "../../server/auth/session";', true],
  ["src/modules/catalog/a/probe.ts", 'import { x } from "../../../server/auth/auth";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@/server/auth/actor-session";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@/server/auth/actor/session";', true],
  ["src/modules/catalog/probe.ts", 'import { x } from "@/server/auth/actor/../session";', true],
  ["src/modules/catalog/probe.ts", 'import type { x } from "@/server/auth/session";', true],
  ["src/modules/catalog/probe.ts", 'export * from "@/server/auth/session";', true],
  ["src/modules/catalog/probe.ts", 'const m = await import("@/server/auth/session");', true],
  ["src/modules/catalog/probe.ts", 'const m = await import("../../server/auth/auth");', true],
  ["src/modules/catalog/probe.js", 'const m = require("@/server/auth/session");', true],
  ["src/modules/catalog/probe.ts", "const p = '@/server/auth/actor'; await import(p);", true],
  ["src/modules/auth/probe.ts", 'import { x } from "@/server/auth/session";', true],
  // The driver rule still holds in a module file after the block above replaced the rules.
  ["src/modules/catalog/probe.ts", 'import { PrismaClient } from "@prisma/client";', true],
  // Allowed: actor.ts, in the alias form, the relative form, and with an extension; tests; and
  // code outside src/modules.
  ["src/modules/catalog/probe.ts", 'import { requireRole } from "@/server/auth/actor";', false],
  ["src/modules/catalog/probe.ts", 'import type { Actor } from "@/server/auth/actor";', false],
  ["src/modules/catalog/probe.ts", 'import { requireRole } from "../../server/auth/actor";', false],
  [
    "src/modules/catalog/probe.ts",
    'import { requireRole } from "../../server/auth/actor.js";',
    false,
  ],
  ["src/modules/catalog/probe.ts", 'const m = await import("@/server/auth/actor");', false],
  ["src/modules/catalog/probe.test.ts", 'import { x } from "@/server/auth/session";', false],
  ["src/modules/catalog/probe.test.ts", 'import { x } from "@/server/auth/auth";', false],
  ["src/modules/auth/probe.itest.ts", 'import { x } from "@/server/auth/routes";', false],
  ["src/app/probe.ts", 'import { handleSignIn } from "@/server/auth/routes";', false],
  ["src/server/auth/probe.ts", 'import { x } from "./session";', false],
  ["tests/integration/probe.ts", 'import { x } from "@/server/auth/session";', false],
  // Allowed.
  ["src/modules/catalog/probe.ts", 'import { db } from "@/server/db";', false],
  ["src/modules/catalog/probe.ts", 'import { db } from "../../server/db";', false],
  // Allowed importers of the db layer (rule 7 list, D-021).
  ["src/server/auth/probe.ts", 'import { db } from "../db";', false],
  ["src/server/auth/probe.ts", 'import { db } from "@/server/db";', false],
  ["src/server/health.ts", 'import { db } from "./db";', false],
  ["prisma/seed.ts", 'import { db } from "../src/server/db";', false],
  ["scripts/probe.ts", 'import { db } from "../src/server/db";', false],
  ["tests/helpers/probe.ts", 'import { db } from "@/server/db";', false],
  ["tests/security/probe.test.ts", 'const m = await import("@/server/db");', false],
  ["src/server/db/probe.ts", 'import { PrismaClient } from "@prisma/client";', false],
  ["src/app/probe.ts", 'import { listProducts } from "@/modules/catalog";', false],
  ["src/app/probe.ts", 'const m = await import("@/components/ui/button");', false],
  ["src/app/probe.ts", 'import { logger } from "@/server/logger";', false],
  ["src/app/a/b/probe.tsx", 'import { cn } from "../../../lib/utils";', false],
  ["src/app/probe.ts", 'import fs from "node:fs";', false],
  ["src/server/db/probe.ts", 'import { PrismaPg } from "@prisma/adapter-pg";', false],
  // The generated client is the only thing under prisma/ that may import the Prisma runtime.
  [
    "prisma/generated/prisma/probe.ts",
    'import * as runtime from "@prisma/client/runtime/client";',
    false,
  ],
  ["prisma/generated/prisma/probe.ts", 'import * as $Enums from "./enums";', false],
  [
    "src/server/db/probe.ts",
    'import { PrismaClient } from "../../../prisma/generated/prisma/client";',
    false,
  ],
  // Not a database client: the Prisma CLI configuration at the repository root, and packages whose
  // names only start with the same letters.
  ["prisma7.config.ts", 'import { defineConfig } from "prisma/config";', false],
  ["src/app/probe.ts", 'import x from "pgx-not-a-driver";', false],
  // SEC-081: ways to load the db layer at run time that get past the guard today. Inline comments
  // that switch the guard off.
  [
    "src/app/x/probe.ts",
    '/* eslint-disable no-restricted-imports */\nimport { db } from "@/server/db";',
    true,
  ],
  [
    "src/app/x/probe.ts",
    '// eslint-disable-next-line no-restricted-imports\nimport { db } from "@/server/db";',
    true,
  ],
  ["src/app/x/probe.ts", '/* eslint-disable */\nimport { db } from "@/server/db";', true],
  ["src/app/x/probe.ts", 'import { db } from "@/server/db"; // eslint-disable-line', true],
  [
    "src/app/x/probe.ts",
    '/* eslint no-restricted-imports: "off" */\nimport { db } from "@/server/db";',
    true,
  ],
  ["src/components/probe.tsx", '/* eslint-disable */\nimport { db } from "@/server/db";', true],
  // createRequire in every way of reaching it.
  [
    "src/app/x/probe.ts",
    'import { createRequire } from "node:module";\nconst m = createRequire(import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'import { createRequire as cr } from "node:module";\nconst m = cr(import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'import * as mod from "node:module";\nconst m = mod.createRequire(import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'import Module from "node:module";\nconst m = Module.createRequire(import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'import { createRequire } from "module";\nconst m = createRequire(import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const { createRequire } = await import("node:module");\nconst m = createRequire(import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const m = process.getBuiltinModule("node:module").createRequire(import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.js",
    'const m = require("node:module").createRequire(__filename)("../../server/db");',
    true,
  ],
  // `require` reached other than as the callee of a direct call.
  ["src/app/x/probe.js", 'const r = require;\nconst m = r("../../server/db");', true],
  ["src/app/x/probe.js", 'const m = module.require("../../server/db");', true],
  ["src/app/x/probe.js", 'const { require: r } = module;\nconst m = r("../../server/db");', true],
  ["src/app/x/probe.js", 'const m = require.call(null, "../../server/db");', true],
  ["src/app/x/probe.js", 'const m = require.apply(null, ["../../server/db"]);', true],
  ["src/app/x/probe.js", 'const m = require["call"](null, "../../server/db");', true],
  ["src/app/x/probe.js", 'const m = globalThis.require("../../server/db");', true],
  // Code built from a string.
  ["src/app/x/probe.js", 'const m = eval("require")("../../server/db");', true],
  ["src/app/x/probe.js", 'const m = new Function("return require")()("../../server/db");', true],
  // SEC-081 re-check: the inline disable in a test-named file under src, loader spellings reached
  // by name tricks, and query or fragment suffixes. Test files run by Vitest keep the loader
  // exemption (they use createRequire); application code may not import them.
  [
    "src/lib/x/leak.itest.ts",
    '/* eslint-disable */\nimport { db } from "@/server/db";\nexport { db };',
    true,
  ],
  [
    "src/lib/x/leak.test.mts",
    '/* eslint-disable */\nimport { db } from "@/server/db";\nexport { db };',
    true,
  ],
  [
    "src/components/x/leak.test.tsx",
    '// eslint-disable-next-line no-restricted-imports\nimport { db } from "@/server/db";\nexport { db };',
    true,
  ],
  [
    "src/app/x/leak.itest.ts",
    'import { createRequire } from "node:module";\nexport const m = createRequire(import.meta.url)("../../server/db");',
    true,
  ],
  ["src/app/x/probe.ts", 'import { x } from "@/lib/x/leak.test";', true],
  ["src/app/x/probe.ts", 'import { x } from "@/lib/x/leak.itest";', true],
  ["src/app/x/probe.ts", 'const m = await import("../../lib/x/leak.test.ts");', true],
  ["src/lib/x/probe.test.ts", 'import { x } from "./helper";', false],
  ["src/app/x/probe.js", 'const m = module.constructor._load("../../server/db");', true],
  ["src/app/x/probe.js", 'const m = process.mainModule["require"]("../../server/db");', true],
  [
    "src/app/x/probe.ts",
    'const m = process["getBuiltinModule"]("node:module")["createRequire"](import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const p = process; const m = p.getBuiltinModule("node:module")["createRequire"](import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const { getBuiltinModule: g } = process; const m = g("node:module")["createRequire"](import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const mod = await import("node:module"); const m = mod["createRequire"](import.meta.url)("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.js",
    'const m = require("node:module")["createRequire"](__filename)("../../server/db");',
    true,
  ],
  ["src/app/x/probe.ts", 'const m = (0, eval)("require")("../../server/db");', true],
  ["src/app/x/probe.ts", 'const m = globalThis.eval("require")("../../server/db");', true],
  [
    "src/app/x/probe.ts",
    'const m = (() => {}).constructor("return require")()("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const m = Reflect.construct(Function, ["return require"])()("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'import vm from "node:vm"; const m = vm.runInThisContext("process.mainModule.require")("../../server/db");',
    true,
  ],
  ["src/app/x/probe.ts", 'import { db } from "@/server/db?x";', true],
  ["src/app/x/probe.ts", 'import { db } from "@/server/db#x";', true],
  ["src/app/x/probe.ts", 'const m = await import("@/server/db?x");', true],
  // SEC-081 second re-check, group 2: inline config outside src.
  [
    "shared/leak.ts",
    '/* eslint-disable */\nimport { db } from "../src/server/db";\nexport { db };',
    true,
  ],
  [
    "leak.ts",
    '// eslint-disable-next-line no-restricted-imports\nimport { db } from "./src/server/db";\nexport { db };',
    true,
  ],
  // Group 3: loader spellings reached through aliases and computed keys.
  [
    "src/app/x/probe.js",
    'const mm = module; const k = "req" + "uire"; const m = mm[k]("../../server/db");',
    true,
  ],
  ["src/app/x/probe.ts", 'const g = globalThis; const e = g["ev" + "al"]; const m = e("1");', true],
  ["src/app/x/probe.js", 'const e = global["ev" + "al"]; const m = e("1");', true],
  [
    "src/app/x/probe.ts",
    'const F = (() => {}).constructor; const m = F("return process")();',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const k = "constr" + "uctor"; const F = (() => {})[k]; const m = F("return process")();',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const R = Reflect; const F = (() => {}).constructor; const m = R.construct(F, ["return process"]);',
    true,
  ],
  ["src/app/x/probe.js", 'const m = __non_webpack_require__("../../server/db");', true],
  // SEC-083: application code imports a folder whose files may import the db layer.
  ["src/app/x/probe.ts", 'import { x } from "../../../scripts/bootstrap-admin";', true],
  ["src/components/x/probe.tsx", 'import { x } from "../../../tests/helpers/db";', true],
  ["src/app/x/probe.ts", 'import { x } from "../../../prisma/seed";', true],
  ["src/app/x/probe.ts", 'import { x } from "../../../e2e/support/db";', true],
  ["src/app/x/probe.ts", 'const m = await import("../../../scripts/bootstrap-admin");', true],
  ["src/app/x/probe.js", 'const m = require("../../../scripts/bootstrap-admin");', true],
  // SEC-081 recheck 3, group 1: listed globals through the cast, a member, or an alias.
  [
    "src/app/x/probe.ts",
    'const k = "require"; const m = (module as Record<string, (s: string) => unknown>)[k]("../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const k = "call"; const m = (__non_webpack_require__ as Record<string, (a: null, s: string) => unknown>)[k](null, "../../server/db");',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const k = "construct"; const c = (Reflect as Record<string, unknown>)[k];',
    true,
  ],
  ["src/app/x/probe.js", 'const m = __non_webpack_require__.call(null, "../../server/db");', true],
  ["src/app/x/probe.js", "const cache = __webpack_require__.c;", true],
  ["src/app/x/probe.js", "const t = __turbopack_require__;", true],
  ["src/app/x/probe.js", "const t = x.__webpack_modules__;", true],
  [
    "src/app/x/probe.ts",
    'const g = globalThis.globalThis; const k = "eval"; const e = g[k];',
    true,
  ],
  ["src/app/x/probe.js", 'const g = globalThis.global; const k = "eval"; const e = g[k];', true],
  [
    "src/app/x/probe.js",
    'const mm = globalThis.module; const k = "require"; const r = mm[k]("../../server/db");',
    true,
  ],
  ["src/app/x/probe.js", 'const g = globalThis["globalThis"];', true],
  // SEC-081 recheck 3, group 2: constructor without a member access.
  [
    "src/app/x/probe.ts",
    'const { constructor: F } = () => {}; const m = F("return process")();',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const { "constructor": F } = () => {}; const m = F("return process")();',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const { ["constructor"]: F } = () => {}; const m = F("return process")();',
    true,
  ],
  ["src/app/x/probe.ts", "const { [`constructor`]: F } = () => {};", true],
  ["src/app/x/probe.ts", 'const k = "constructor"; const { [k]: F } = () => {};', true],
  ["src/app/x/probe.ts", "const { constructor } = () => {};", true],
  [
    "src/app/x/probe.ts",
    'function f({ constructor: F }: { constructor: (s: string) => () => unknown }) { return F("return process")(); }\nconst m = f(() => {});',
    true,
  ],
  [
    "src/app/x/probe.ts",
    'const k = "constructor"; const F = (() => {})[k]; const m = F("return process")();',
    true,
  ],
  ["src/app/x/probe.ts", 'let k; k = "constructor";', true],
  ["src/app/x/probe.ts", 'const k = "eval";', true],
  ["src/app/x/probe.ts", "const k = `construct`;", true],
  // SEC-084: a specifier that starts with ./.. or is absolute passes the normal-form check.
  ["src/app/x/probe.ts", 'import { x } from "./../../../scripts/bootstrap-admin";', true],
  ["src/app/x/probe.ts", 'const m = await import("./../../../scripts/bootstrap-admin");', true],
  ["src/app/x/probe.js", 'const m = require("./../../../scripts/bootstrap-admin");', true],
  ["src/components/x/probe.tsx", 'import { x } from "./../../../tests/helpers/db";', true],
  ["src/server/sub/probe.ts", 'import { db } from "./../db";', true],
  ["src/app/x/probe.ts", 'import { x } from "C:/dev/web shoping/scripts/bootstrap-admin";', true],
  ["src/app/x/probe.ts", 'import { x } from "/abs/scripts/bootstrap-admin";', true],
  ["src/app/x/probe.ts", 'import { x } from "file:///C:/dev/scripts/bootstrap-admin";', true],
  // Controls: the db layer reaches prisma/generated, and tests under scripts import src.
  [
    "src/server/db/probe.ts",
    'import { PrismaClient } from "../../../prisma/generated/prisma/client";',
    false,
  ],
  ["scripts/probe.ts", 'import { db } from "../src/server/db";', false],
  // Controls: a Vitest-run test under src may still use createRequire; process.env stays allowed.
  [
    "src/lib/x/probe.test.ts",
    'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);',
    false,
  ],
  ["src/app/x/probe.ts", "const e = process.env.NODE_ENV;", false],
  // The real tree passes "constructor" as a call argument; that stays clean.
  ["src/app/x/probe.ts", 'const v = pick(error, "constructor");', false],
  ["src/app/x/probe.ts", "const { a, b: c } = obj;", false],
  // Allowed shapes that the SEC-081 selectors must keep accepting (the real tree uses them).
  ["src/app/x/probe.ts", "const n = items[items.length - 1];\nconst o = items[i + 1];", false],
  ["src/app/x/probe.ts", "const v = Reflect.apply(getter, chunk, []);", false],
  ["src/app/x/probe.ts", "const u = globalThis.crypto.randomUUID();", false],
  [
    "src/app/x/probe.ts",
    "type G = typeof globalThis & { k?: unknown };\nconst s = (globalThis as G)[KEY];",
    false,
  ],
  // SEC-081 controls: the db layer, tests, and e2e support may use createRequire, and must stay
  // clean after the guard is extended.
  [
    "src/server/db/probe.ts",
    'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);',
    false,
  ],
  [
    "tests/security/probe.test.ts",
    'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);',
    false,
  ],
  [
    "e2e/support/probe.ts",
    'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);',
    false,
  ],
];

const GUARD_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
let failures = 0;
let knownGaps = 0;

for (const [filePath, code, expectation] of probes) {
  const [result] = await eslint.lintText(`${code}\nexport {};\n`, { filePath });
  const rejected = result.messages.some(
    (message) => message.severity === 2 && GUARD_RULES.has(message.ruleId ?? ""),
  );
  if (expectation === "SEC-081") {
    if (rejected) {
      failures += 1;
      console.error(
        `FAIL ${filePath}: ${code}\n     SEC-081 gap is now rejected: change its expectation to true`,
      );
    } else {
      knownGaps += 1;
    }
    continue;
  }
  const shouldReject = expectation;
  if (rejected !== shouldReject) {
    failures += 1;
    console.error(
      `FAIL ${filePath}: ${code}\n     expected ${shouldReject ? "an error" : "no error"}, got ${rejected ? "an error" : "no error"}`,
    );
  }
}

console.log(
  `${probes.length - failures} of ${probes.length} import-guard probes behaved as expected` +
    (knownGaps > 0 ? ` (${knownGaps} are known SEC-081 gaps, not yet rejected)` : ""),
);
process.exit(failures === 0 ? 0 : 1);
