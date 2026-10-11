// Regression check for architecture rule 7 (CLAUDE.md): checks that the ESLint import guards in
// eslint.config.mjs reject the forbidden import spellings listed below and accept the allowed ones.
// It covers accidental violations only. Not covered, and left to review: inline eslint-disable
// comments, createRequire and other indirect require calls, re-exports through an allowed folder,
// and type-only `typeof import()` queries.
// Nothing is written to disk; each probe is linted from memory under a virtual file name.
// Run: node scripts/check-import-guards.mjs
import { ESLint } from "eslint";

const eslint = new ESLint();

/** [virtual file, source code, should lint report an error?] */
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
  ["prisma/seed.ts", 'import { PrismaClient } from "@prisma/client";', false],
  ["src/server/db/probe.ts", 'import { PrismaPg } from "@prisma/adapter-pg";', false],
  [
    "src/server/db/probe.ts",
    'import { PrismaClient } from "../../../prisma/generated/prisma/client";',
    false,
  ],
  // Not a database client: the Prisma CLI configuration at the repository root, and packages whose
  // names only start with the same letters.
  ["prisma7.config.ts", 'import { defineConfig } from "prisma/config";', false],
  ["src/app/probe.ts", 'import x from "pgx-not-a-driver";', false],
];

const GUARD_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
let failures = 0;

for (const [filePath, code, shouldReject] of probes) {
  const [result] = await eslint.lintText(`${code}\nexport {};\n`, { filePath });
  const rejected = result.messages.some(
    (message) => message.severity === 2 && GUARD_RULES.has(message.ruleId ?? ""),
  );
  if (rejected !== shouldReject) {
    failures += 1;
    console.error(
      `FAIL ${filePath}: ${code}\n     expected ${shouldReject ? "an error" : "no error"}, got ${rejected ? "an error" : "no error"}`,
    );
  }
}

console.log(
  `${probes.length - failures} of ${probes.length} import-guard probes behaved as expected`,
);
process.exit(failures === 0 ? 0 : 1);
