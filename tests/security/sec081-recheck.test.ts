/**
 * SEC-081 re-check, security, 2026-10-22. Owner: security.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Commit 0f497a8 hardened the rule 7 lint guard for src: `noInlineConfig` and selectors for the
 * module loaders named in SEC-081. The 23 spellings registered in SEC-081 are now rejected (see
 * scripts/check-import-guards.mjs and tests/security/cr-t032-10-import-guards.test.ts). This file
 * pins what still gets past the guard:
 *
 *   1. The hardening skips every file under src whose name holds `.test.` or `.itest.`. Such a
 *      file keeps the plain guard, where an inline `eslint-disable` still works. Only
 *      `src/**\/*.test.ts` and `src/**\/*.test.tsx` are run by Vitest; `.itest.*`, `.test.js`,
 *      `.test.mts` and the like under src are run by no configuration, and the real-tree scan of
 *      cr-t032-10 skips every test-named file. A page can import such a file like any module.
 *   2. The loader selectors match names, so computed member access, an alias of `process`, an
 *      indirect `eval`, the `Function` constructor reached through another object, `node:vm`,
 *      `module.constructor._load`, and `process.mainModule` get past them.
 *   3. A query or fragment suffix on the specifier (`@/server/db?x`) is not matched by the path
 *      patterns, which end at `/` or the end of the string.
 *
 * Each case asserts the secure behaviour (an ESLint error). All 19 were `it.fails` until the guard\n * was extended (noInlineConfig for all of src, test-named imports refused from application code,\n * node:module and node:vm refused in every import form, computed member access, and ? and # in\n * a specifier); they are plain `it` now.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const GUARD_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
let eslint: ESLint;

async function guardErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\nexport {};\n`, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2 && GUARD_RULES.has(message.ruleId ?? ""))
    .map((message) => `${message.ruleId ?? ""}: ${message.message}`);
}

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

describe("SEC-081 re-check: controls", () => {
  it("the registered spellings are rejected in a page (the fix works for them)", async () => {
    for (const code of [
      '/* eslint-disable */\nimport { db } from "@/server/db";',
      'import { createRequire } from "node:module";\nconst m = createRequire(import.meta.url)("../../server/db");',
      'const m = process.getBuiltinModule("node:module").createRequire(import.meta.url)("../../server/db");',
    ]) {
      expect(await guardErrors("src/app/x/probe.ts", code), code).not.toEqual([]);
    }
  }, 60_000);

  it("a test-named file under src is not run by the unit or component projects", () => {
    const config = readFileSync(join(ROOT, "vitest.config.mts"), "utf8");
    const integration = readFileSync(join(ROOT, "vitest.integration.config.mts"), "utf8");
    // The only src patterns are *.test.ts and *.test.tsx; .itest is included only under tests/.
    expect(config).toContain('"src/**/*.test.ts"');
    expect(config).toContain('"src/**/*.test.tsx"');
    expect(config).not.toMatch(/src\/\*\*\/\*\.itest/);
    expect(integration).not.toMatch(/"src\//);
  });

  it("the plain guard still applies to a test-named file without an inline comment", async () => {
    expect(
      await guardErrors(
        "src/lib/x/leak.itest.ts",
        'import { db } from "@/server/db";\nexport { db };',
      ),
    ).not.toEqual([]);
  });
});

describe("SEC-081 re-check: an inline disable in a test-named file under src", () => {
  for (const [file, code] of [
    [
      "src/lib/x/leak.itest.ts",
      '/* eslint-disable */\nimport { db } from "@/server/db";\nexport { db };',
    ],
    [
      "src/lib/x/leak.test.mts",
      '/* eslint-disable */\nimport { db } from "@/server/db";\nexport { db };',
    ],
    [
      "src/components/x/leak.test.tsx",
      '// eslint-disable-next-line no-restricted-imports\nimport { db } from "@/server/db";\nexport { db };',
    ],
    [
      "src/app/x/leak.itest.ts",
      'import { createRequire } from "node:module";\nexport const m = createRequire(import.meta.url)("../../server/db");',
    ],
  ] as const) {
    it(`${file} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});

describe("SEC-081 re-check: loader spellings the name-based selectors miss", () => {
  for (const [label, file, code] of [
    [
      "module.constructor._load",
      "src/app/x/probe.js",
      'const m = module.constructor._load("../../server/db");',
    ],
    [
      "process.mainModule computed require",
      "src/app/x/probe.js",
      'const m = process.mainModule["require"]("../../server/db");',
    ],
    [
      "computed getBuiltinModule and createRequire",
      "src/app/x/probe.ts",
      'const m = process["getBuiltinModule"]("node:module")["createRequire"](import.meta.url)("../../server/db");',
    ],
    [
      "an alias of process",
      "src/app/x/probe.ts",
      'const p = process; const m = p.getBuiltinModule("node:module")["createRequire"](import.meta.url)("../../server/db");',
    ],
    [
      "getBuiltinModule destructured",
      "src/app/x/probe.ts",
      'const { getBuiltinModule: g } = process; const m = g("node:module")["createRequire"](import.meta.url)("../../server/db");',
    ],
    [
      "dynamic import of node:module",
      "src/app/x/probe.ts",
      'const mod = await import("node:module"); const m = mod["createRequire"](import.meta.url)("../../server/db");',
    ],
    [
      "require of node:module, computed member",
      "src/app/x/probe.js",
      'const m = require("node:module")["createRequire"](__filename)("../../server/db");',
    ],
    ["indirect eval", "src/app/x/probe.ts", 'const m = (0, eval)("require")("../../server/db");'],
    [
      "globalThis.eval",
      "src/app/x/probe.ts",
      'const m = globalThis.eval("require")("../../server/db");',
    ],
    [
      "Function through a constructor property",
      "src/app/x/probe.ts",
      'const m = (() => {}).constructor("return require")()("../../server/db");',
    ],
    [
      "Reflect.construct(Function)",
      "src/app/x/probe.ts",
      'const m = Reflect.construct(Function, ["return require"])()("../../server/db");',
    ],
    [
      "node:vm",
      "src/app/x/probe.ts",
      'import vm from "node:vm"; const m = vm.runInThisContext("process.mainModule.require")("../../server/db");',
    ],
    ["query suffix, static", "src/app/x/probe.ts", 'import { db } from "@/server/db?x";'],
    ["fragment suffix, static", "src/app/x/probe.ts", 'import { db } from "@/server/db#x";'],
    ["query suffix, dynamic", "src/app/x/probe.ts", 'const m = await import("@/server/db?x");'],
  ] as const) {
    it(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});
