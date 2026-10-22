/**
 * SEC-081 / SEC-083 third re-check, security, 2026-10-22, against commit 23720f2. Owner: security.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Commit 23720f2 rejects the 14 spellings of tests/security/sec081-recheck-2.test.ts (checked
 * there, and against the config of 23720f2~1, where all 14 pass). The owner accepted the
 * name-based residual in D-045 (docs/SECURITY.md, SEC-081, "Accepted residual"). This file pins
 * the spellings that still pass and that are NOT inside that written residual:
 *
 *   1. SEC-081, listed globals: the cast exemption `(X as T)[key]` is written for globalThis but
 *      applies to every listed global (module, Reflect, the bundler loaders); the bundler loaders
 *      may be used through any non-computed member (`.call`, `.c`); and a fresh alias of the
 *      global object is built by `globalThis.globalThis`, `globalThis.global`, `globalThis.module`.
 *   2. SEC-081, `constructor` reached without a member access: object destructuring (in a
 *      declaration or a parameter, with an identifier, string, or computed literal key), and a
 *      plain string literal kept in a variable and used as a computed key.
 *   3. SEC-084, path form: a specifier that starts with `./..` passes the normal-form check, so
 *      the SEC-083 pattern (anchored at `../`) and the sibling db pattern are bypassed; a Windows
 *      absolute path to scripts/ is not refused either. This also keeps SEC-083 open.
 *
 * Each `it.fails` asserts the secure behaviour (an ESLint error from no-restricted-imports or
 * no-restricted-syntax) and is expected to fail today. Flip it to `it` when the guard rejects it.
 * Spellings inside the accepted residual (three-piece keys, `Reflect.get(fn, "constructor")`, the
 * globalThis cast with a variable key, unlisted names such as tsx, jiti, vitest, Worker eval, and
 * the Turbopack runtime names) are recorded in docs/SECURITY.md and are not pinned here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
const GUARD_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
let eslint: ESLint;

// A parse error must never count as "rejected": it is returned as a non-empty list, so the
// `it.fails` turns red instead of hiding a broken probe; controls throw.
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

// Load the config once; a cold load under parallel runs must not count as an expected failure.
vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  eslint = new ESLint({ cwd: ROOT });
  await eslint.lintText("export {};\n", { filePath: "src/app/x/warm.ts" });
}, 120_000);

const PAGE_TS = "src/app/x/probe.ts";
const PAGE_JS = "src/app/x/probe.js";

describe("SEC-081 third re-check: controls", () => {
  it("the sibling form ../db from a new src/server subfolder is an error", async () => {
    expect(
      await guardErrors("src/server/sub/probe.ts", 'import { db } from "../db";', "throw"),
    ).not.toEqual([]);
  });

  it("a plain alias of module and a .constructor read are errors", async () => {
    expect(await guardErrors(PAGE_JS, "const mm = module;", "throw")).not.toEqual([]);
    expect(await guardErrors(PAGE_TS, "const F = (() => {}).constructor;", "throw")).not.toEqual(
      [],
    );
  });

  it("the shapes the real tree uses stay clean", async () => {
    for (const code of [
      "const items = [1]; const i = 0; const n = items[items.length - 1]; const o = items[i + 1];",
      "const v = Reflect.apply(Math.max, null, [1]);",
      "const u = globalThis.crypto.randomUUID();",
      'type G = typeof globalThis & { k?: unknown };\nconst KEY = "k";\nconst s = (globalThis as G)[KEY];',
      "const e = process.env.NODE_ENV;",
    ]) {
      expect(await guardErrors(PAGE_TS, code, "throw"), code).toEqual([]);
    }
  });

  it("real tree: no import specifier under src starts with ./.. or is an absolute path", () => {
    const offenders: string[] = [];
    const spec = /(?:from|import\(|require\()\s*["']((?:\.\/\.\.|[A-Za-z]:[\\/]|\/)[^"']*)["']/g;
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      for (const match of readFileSync(file, "utf8").matchAll(spec)) {
        offenders.push(`${rel}: ${match[1] ?? ""}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("SEC-081 third re-check, group 1: listed globals through the cast, a member, or an alias", () => {
  for (const [label, file, code] of [
    [
      "cast of module with a key in a variable",
      PAGE_TS,
      'const k = "require"; const m = (module as Record<string, (s: string) => unknown>)[k]("../../server/db");',
    ],
    [
      "cast of __non_webpack_require__ with a key in a variable",
      PAGE_TS,
      'const k = "call"; const m = (__non_webpack_require__ as Record<string, (a: null, s: string) => unknown>)[k](null, "../../server/db");',
    ],
    [
      "cast of Reflect with a key in a variable",
      PAGE_TS,
      'const k = "construct"; const c = (Reflect as Record<string, unknown>)[k];',
    ],
    [
      "__non_webpack_require__.call",
      PAGE_JS,
      'const m = __non_webpack_require__.call(null, "../../server/db");',
    ],
    ["__webpack_require__.c (the module cache)", PAGE_JS, "const cache = __webpack_require__.c;"],
    [
      "an alias of the global object through globalThis.globalThis",
      PAGE_TS,
      'const g = globalThis.globalThis; const k = "eval"; const e = g[k];',
    ],
    [
      "an alias of the global object through globalThis.global",
      PAGE_JS,
      'const g = globalThis.global; const k = "eval"; const e = g[k];',
    ],
    [
      "an alias of module through globalThis.module",
      PAGE_JS,
      'const mm = globalThis.module; const k = "require"; const r = mm[k]("../../server/db");',
    ],
  ] as const) {
    it.fails(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});

describe("SEC-081 third re-check, group 2: constructor without a member access", () => {
  for (const [label, code] of [
    [
      "destructuring with an identifier key",
      'const { constructor: F } = () => {}; const m = F("return process")();',
    ],
    [
      "destructuring with a string key",
      'const { "constructor": F } = () => {}; const m = F("return process")();',
    ],
    [
      "destructuring with a computed literal key",
      'const { ["constructor"]: F } = () => {}; const m = F("return process")();',
    ],
    [
      "destructuring in a parameter",
      'function f({ constructor: F }: { constructor: (s: string) => () => unknown }) { return F("return process")(); }\nconst m = f(() => {});',
    ],
    [
      "a plain string literal kept in a variable and used as a key",
      'const k = "constructor"; const F = (() => {})[k]; const m = F("return process")();',
    ],
  ] as const) {
    it.fails(`${label} is an error`, async () => {
      expect(await guardErrors(PAGE_TS, code)).not.toEqual([]);
    });
  }
});

describe("SEC-084: a specifier that starts with ./.. or is absolute passes the normal-form check", () => {
  for (const [label, file, code] of [
    [
      "page imports scripts through ./..",
      PAGE_TS,
      'import { x } from "./../../../scripts/bootstrap-admin";',
    ],
    [
      "page dynamic import of scripts through ./..",
      PAGE_TS,
      'const m = await import("./../../../scripts/bootstrap-admin");',
    ],
    [
      "page require of scripts through ./..",
      PAGE_JS,
      'const m = require("./../../../scripts/bootstrap-admin");',
    ],
    [
      "component imports tests through ./..",
      "src/components/x/probe.tsx",
      'import { x } from "./../../../tests/helpers/db";',
    ],
    [
      "a new src/server subfolder imports the db layer through ./../db",
      "src/server/sub/probe.ts",
      'import { db } from "./../db";',
    ],
    [
      "page imports scripts by a Windows absolute path",
      PAGE_TS,
      'import { x } from "C:/dev/web shoping/scripts/bootstrap-admin";',
    ],
  ] as const) {
    it.fails(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});
