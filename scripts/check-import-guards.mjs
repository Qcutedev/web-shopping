// Regression check for architecture rule 7 (CLAUDE.md): checks that the ESLint import guards in
// eslint.config.mjs reject the forbidden import spellings listed below and accept the allowed ones.
// Inline eslint-disable and config comments, createRequire, and other indirect require calls get
// past the guard today (SEC-081, docs/SECURITY.md). They are listed below with the expectation
// "SEC-081": the guard should reject them, and the script reports them as known gaps without
// failing. Once the guard rejects one, the script fails until its expectation is changed to
// `true`, the same way `it.fails` works in tests/security/cr-t032-10-import-guards.test.ts.
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
    "SEC-081",
  ],
  [
    "src/app/x/probe.ts",
    '// eslint-disable-next-line no-restricted-imports\nimport { db } from "@/server/db";',
    "SEC-081",
  ],
  ["src/app/x/probe.ts", '/* eslint-disable */\nimport { db } from "@/server/db";', "SEC-081"],
  ["src/app/x/probe.ts", 'import { db } from "@/server/db"; // eslint-disable-line', "SEC-081"],
  [
    "src/app/x/probe.ts",
    '/* eslint no-restricted-imports: "off" */\nimport { db } from "@/server/db";',
    "SEC-081",
  ],
  [
    "src/components/probe.tsx",
    '/* eslint-disable */\nimport { db } from "@/server/db";',
    "SEC-081",
  ],
  // createRequire in every way of reaching it.
  [
    "src/app/x/probe.ts",
    'import { createRequire } from "node:module";\nconst m = createRequire(import.meta.url)("../../server/db");',
    "SEC-081",
  ],
  [
    "src/app/x/probe.ts",
    'import { createRequire as cr } from "node:module";\nconst m = cr(import.meta.url)("../../server/db");',
    "SEC-081",
  ],
  [
    "src/app/x/probe.ts",
    'import * as mod from "node:module";\nconst m = mod.createRequire(import.meta.url)("../../server/db");',
    "SEC-081",
  ],
  [
    "src/app/x/probe.ts",
    'import Module from "node:module";\nconst m = Module.createRequire(import.meta.url)("../../server/db");',
    "SEC-081",
  ],
  [
    "src/app/x/probe.ts",
    'import { createRequire } from "module";\nconst m = createRequire(import.meta.url)("../../server/db");',
    "SEC-081",
  ],
  [
    "src/app/x/probe.ts",
    'const { createRequire } = await import("node:module");\nconst m = createRequire(import.meta.url)("../../server/db");',
    "SEC-081",
  ],
  [
    "src/app/x/probe.ts",
    'const m = process.getBuiltinModule("node:module").createRequire(import.meta.url)("../../server/db");',
    "SEC-081",
  ],
  [
    "src/app/x/probe.js",
    'const m = require("node:module").createRequire(__filename)("../../server/db");',
    "SEC-081",
  ],
  // `require` reached other than as the callee of a direct call.
  ["src/app/x/probe.js", 'const r = require;\nconst m = r("../../server/db");', "SEC-081"],
  ["src/app/x/probe.js", 'const m = module.require("../../server/db");', "SEC-081"],
  [
    "src/app/x/probe.js",
    'const { require: r } = module;\nconst m = r("../../server/db");',
    "SEC-081",
  ],
  ["src/app/x/probe.js", 'const m = require.call(null, "../../server/db");', "SEC-081"],
  ["src/app/x/probe.js", 'const m = require.apply(null, ["../../server/db"]);', "SEC-081"],
  ["src/app/x/probe.js", 'const m = require["call"](null, "../../server/db");', "SEC-081"],
  ["src/app/x/probe.js", 'const m = globalThis.require("../../server/db");', "SEC-081"],
  // Code built from a string.
  ["src/app/x/probe.js", 'const m = eval("require")("../../server/db");', "SEC-081"],
  [
    "src/app/x/probe.js",
    'const m = new Function("return require")()("../../server/db");',
    "SEC-081",
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
