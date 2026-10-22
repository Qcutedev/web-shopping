/**
 * SEC-081 second re-check, security, 2026-10-22, against commit 0a7ea5e. Owner: security.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Commit 0a7ea5e applied remediation (a) to (e) of the first re-check. The 19 spellings of
 * tests/security/sec081-recheck.test.ts and the 23 of SEC-081 are rejected. This file pins what
 * still gets past the rule 7 lint guard, in three groups:
 *
 *   1. Allowed importers outside src. scripts/**, tests/**, and prisma/seed.ts may import
 *      src/server/db, and nothing stops a page, route handler, or component from importing them.
 *      No trick is needed: `import { x } from "../../../scripts/bootstrap-admin"` lints clean, and
 *      scripts/bootstrap-admin.ts imports src/server/db today. e2e/** is not an allowed importer
 *      but is not refused to application code either.
 *   2. Inline config outside src. `noInlineConfig` is set for src only. A file anywhere else (a
 *      new top-level folder, a root file) keeps the plain guard, where `/* eslint-disable *\/`
 *      works, and a page can import it by a relative path.
 *   3. Name-based selectors, again. An alias of `module`, `globalThis`, `global`, or `Reflect`,
 *      a `.constructor` that is read and not called in the same expression, a computed key built
 *      from a string expression on an object the selectors do not name, and the bundler loader
 *      `__non_webpack_require__`.
 *
 * Each case asserts the secure behaviour (an ESLint error from no-restricted-imports or
 * no-restricted-syntax). They were `it.fails` until the guard was fixed (SEC-081, SEC-083, owner
 * decision D-045) and are plain `it` now. The name-based residual that remains is accepted in
 * writing (docs/SECURITY.md, SEC-081).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
const GUARD_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
let eslint: ESLint;

// A probe that does not parse must never count as "rejected". Controls throw on a parse error. In
// an `it.fails` case a parse error is returned as a non-empty list instead of thrown: the assertion
// then passes, so the `it.fails` turns red and the broken probe is seen (a throw would be counted as
// the expected failure and hide it).
async function guardErrors(
  filePath: string,
  code: string,
  onParseError: "throw" | "flag" = "flag",
): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\nexport {};\n`, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.find((message) => message.fatal);
  if (fatal && onParseError === "throw") throw new Error(`parse error in probe: ${fatal.message}`);
  if (fatal) return [`PARSE ERROR, fix the probe: ${fatal.message}`];
  return messages
    .filter((message) => message.severity === 2 && GUARD_RULES.has(message.ruleId ?? ""))
    .map((message) => `${message.ruleId ?? ""}: ${message.message}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

// The first lintText loads the whole config, which takes more than 5 s when the security project
// runs its files in parallel. A timeout inside an `it.fails` would be counted as the expected
// failure, so the config is loaded here, once, and every case gets a long timeout.
vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  eslint = new ESLint({ cwd: ROOT });
  await eslint.lintText("export {};\n", { filePath: "src/app/x/warm.ts" });
}, 120_000);

describe("SEC-081 second re-check: controls", () => {
  it("a direct import of the db layer from a file outside src is still an error", async () => {
    expect(
      await guardErrors(
        "shared/leak.ts",
        'import { db } from "../src/server/db";\nexport { db };',
        "throw",
      ),
    ).not.toEqual([]);
  });

  it("re-exports and type imports of the db layer from a page are errors", async () => {
    for (const code of [
      'export * from "@/server/db";',
      'export { db } from "@/server/db";',
      'import type { Db } from "@/server/db";',
      'import { type Db } from "@/server/db";',
      'import db = require("@/server/db");',
    ]) {
      expect(await guardErrors("src/app/x/probe.ts", code, "throw"), code).not.toEqual([]);
    }
  }, 60_000);

  it("scripts/bootstrap-admin.ts imports the db layer (so group 1 is a real route)", () => {
    const text = readFileSync(join(ROOT, "scripts", "bootstrap-admin.ts"), "utf8");
    expect(text).toMatch(/server\/db/);
  });

  it("real tree: no file under src imports scripts, tests, e2e, or prisma other than the db layer reaching prisma/generated", () => {
    const offenders: string[] = [];
    const spec =
      /(?:from|import\(|require\()\s*["']((?:\.\.\/)+(?:scripts|tests|e2e|prisma)\/[^"']*)["']/g;
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      for (const match of readFileSync(file, "utf8").matchAll(spec)) {
        const target = match[1] ?? "";
        const dbLayerToGenerated =
          rel.startsWith("src/server/db/") && /(\.\.\/)+prisma\/generated\//.test(target);
        if (!dbLayerToGenerated) offenders.push(`${rel}: ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("SEC-081 second re-check, group 1: application code imports an allowed importer outside src", () => {
  for (const [label, file, code] of [
    [
      "page imports scripts",
      "src/app/x/probe.ts",
      'import { x } from "../../../scripts/bootstrap-admin";',
    ],
    [
      "component imports tests",
      "src/components/x/probe.tsx",
      'import { x } from "../../../tests/helpers/db";',
    ],
    ["page imports prisma/seed", "src/app/x/probe.ts", 'import { x } from "../../../prisma/seed";'],
    [
      "page imports e2e support",
      "src/app/x/probe.ts",
      'import { x } from "../../../e2e/support/db";',
    ],
    [
      "page dynamic import of scripts",
      "src/app/x/probe.ts",
      'const m = await import("../../../scripts/bootstrap-admin");',
    ],
  ] as const) {
    it(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});

describe("SEC-081 second re-check, group 2: inline config outside src", () => {
  for (const [label, file, code] of [
    [
      "a new top-level folder with eslint-disable",
      "shared/leak.ts",
      '/* eslint-disable */\nimport { db } from "../src/server/db";\nexport { db };',
    ],
    [
      "a root file with eslint-disable-next-line",
      "leak.ts",
      '// eslint-disable-next-line no-restricted-imports\nimport { db } from "./src/server/db";\nexport { db };',
    ],
  ] as const) {
    it(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});

describe("SEC-081 second re-check, group 3: loader spellings the selectors still miss", () => {
  for (const [label, file, code] of [
    [
      "an alias of module with a computed key",
      "src/app/x/probe.js",
      'const mm = module; const k = "req" + "uire"; const m = mm[k]("../../server/db");',
    ],
    [
      "an alias of globalThis with a computed key",
      "src/app/x/probe.ts",
      'const g = globalThis; const e = g["ev" + "al"]; const m = e("1");',
    ],
    [
      "global with a computed key",
      "src/app/x/probe.js",
      'const e = global["ev" + "al"]; const m = e("1");',
    ],
    [
      ".constructor read, then called",
      "src/app/x/probe.ts",
      'const F = (() => {}).constructor; const m = F("return process")();',
    ],
    [
      ".constructor through a computed key",
      "src/app/x/probe.ts",
      'const k = "constr" + "uctor"; const F = (() => {})[k]; const m = F("return process")();',
    ],
    [
      "an alias of Reflect",
      "src/app/x/probe.ts",
      'const R = Reflect; const F = (() => {}).constructor; const m = R.construct(F, ["return process"]);',
    ],
    [
      "__non_webpack_require__",
      "src/app/x/probe.js",
      'const m = __non_webpack_require__("../../server/db");',
    ],
  ] as const) {
    it(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});
