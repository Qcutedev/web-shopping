/**
 * SEC-081 / SEC-083 / SEC-084 fourth re-check, security, 2026-10-23, against commit 84b93f6.
 * Owner: security.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Commit 84b93f6 rejects the 19 spellings of tests/security/sec081-recheck-3.test.ts (checked
 * there). The owner accepted the name-based residual in D-045 (docs/SECURITY.md, SEC-081,
 * "Accepted residual"). This file pins the spellings that still pass and that are NOT inside that
 * written residual:
 *
 *   SEC-085  a single string literal that names `constructor` or a loader, wrapped in a TypeScript
 *            expression (`as`, `satisfies`, `<T>`, `!`) or bound as a default value, used as a
 *            computed key. Remediation (e) and the computed-literal selectors read `.value` of the
 *            node itself, so a wrapper hides it.
 *   SEC-086  specifier forms that the normal-form check does not see: percent-encoded segments
 *            (`%2e%2e`, `%64b`), an NTFS stream suffix (`db::$INDEX_ALLOCATION`), and `data:` URLs
 *            (code the linter never reads).
 *   SEC-087  a relative specifier that leaves src for a folder other than scripts, tests, e2e,
 *            prisma (the repository root, a new top-level folder): that file may itself import
 *            scripts or tests, which may import the db layer. Nothing refuses either hop.
 *
 * Each `it.fails` asserts the secure behaviour (an ESLint error from no-restricted-imports or
 * no-restricted-syntax) and is expected to fail today. Flip it to `it` when the guard rejects it.
 * Spellings inside the accepted residual (a string built by a call, a template with expressions,
 * an array, object, enum or class member, a conditional; `Reflect.getPrototypeOf` and other
 * Reflect helpers; unlisted names such as `import.meta.webpackContext`) are recorded in
 * docs/SECURITY.md and are not pinned here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

const rel = (file: string): string => relative(ROOT, file).split(sep).join("/");

// Load the config once; a cold load under parallel runs must not count as an expected failure.
vi.setConfig({ testTimeout: 60_000 });
beforeAll(async () => {
  eslint = new ESLint({ cwd: ROOT });
  await eslint.lintText("export {};\n", { filePath: "src/app/x/warm.ts" });
}, 120_000);

const PAGE_TS = "src/app/x/probe.ts";
const PAGE_JS = "src/app/x/probe.js";
const SERVER_SUB = "src/server/sub/probe.ts";

describe("SEC-081 fourth re-check: controls", () => {
  it("the unwrapped forms of the SEC-085 spellings are errors", async () => {
    for (const code of [
      'const F = (() => {})["constructor"];',
      'const k = "constructor";',
      'let k; k = "constructor";',
      'const g = (globalThis as any)["eval"];',
    ]) {
      expect(await guardErrors(PAGE_TS, code, "throw"), code).not.toEqual([]);
    }
  });

  it("the plain forms of the SEC-086 specifiers are errors", async () => {
    for (const [file, code] of [
      [PAGE_TS, 'import { x } from "./../../../scripts/bootstrap-admin";'],
      [PAGE_TS, 'import { db } from "../../server/db";'],
      [PAGE_TS, 'import { x } from "../../../scripts/bootstrap-admin";'],
      [SERVER_SUB, 'import { db } from "../db";'],
      [PAGE_TS, 'import { db } from "@/server/db";'],
      [PAGE_TS, 'import { x } from "file:///C:/dev/scripts/bootstrap-admin";'],
    ] as const) {
      expect(await guardErrors(file, code, "throw"), code).not.toEqual([]);
    }
  });

  it("the shapes the real tree uses stay clean", async () => {
    for (const code of [
      'const v = pick(error, "constructor");',
      'const c = Reflect.get(Object.prototype, "constructor");',
      "const items = [1]; const i = 0; const n = items[items.length - 1]; const o = items[i + 1];",
      'type G = typeof globalThis & { k?: unknown };\nconst KEY = "k";\nconst s = (globalThis as G)[KEY];',
      'const s = "x" as const;',
      'function f(k = "name") { return k; }',
      'import { x } from "../y";',
    ]) {
      expect(await guardErrors(PAGE_TS, code, "throw"), code).toEqual([]);
    }
  });

  it("real tree: no specifier under src is percent-encoded, has a stream suffix, or is a URL", () => {
    const offenders: string[] = [];
    const spec = /(?:from|import\(|require\()\s*["']([^"']*)["']/g;
    for (const file of walk(join(ROOT, "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(spec)) {
        const value = match[1] ?? "";
        if (/%|::|^(data|https?):/i.test(value)) offenders.push(`${rel(file)}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("real tree: no relative specifier under src leaves src (db layer to prisma/generated excepted)", () => {
    const offenders: string[] = [];
    const spec = /(?:from|import\(|require\()\s*["'](\.{1,2}\/[^"']*)["']/g;
    const src = join(ROOT, "src");
    for (const file of walk(src)) {
      for (const match of readFileSync(file, "utf8").matchAll(spec)) {
        const target = resolve(dirname(file), match[1] ?? "");
        if (target === src || target.startsWith(src + sep)) continue;
        const allowed =
          rel(file).startsWith("src/server/db/") && rel(target).startsWith("prisma/generated/");
        if (!allowed) offenders.push(`${rel(file)}: ${match[1] ?? ""}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("real tree: a string literal naming constructor or a loader appears only in the two known calls", () => {
    const found: string[] = [];
    const name =
      /["'`](require|createRequire|getBuiltinModule|mainModule|_load|eval|Function|constructor|construct)["'`]/g;
    for (const file of walk(join(ROOT, "src"))) {
      const path = rel(file);
      if (path.startsWith("src/server/db/") || /\.test\.tsx?$/.test(path)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        for (const match of line.matchAll(name)) found.push(`${path}:${index + 1}: ${match[0]}`);
      });
    }
    // src/server/errors.ts passes "constructor" to readProperty; src/server/auth/library-error.ts
    // reads it with Reflect.get (inside the D-045 residual). Any new occurrence must be reviewed.
    expect(found.map((entry) => entry.replace(/:\d+:/, ":"))).toEqual([
      'src/server/auth/library-error.ts: "constructor"',
      'src/server/errors.ts: "constructor"',
    ]);
  });
});

describe("SEC-085: a single literal name hidden by a TypeScript wrapper or a default value", () => {
  for (const [label, code] of [
    ["computed key `as string`", 'const F = (() => {})["constructor" as string];'],
    ["computed key `as const` in parentheses", 'const F = (() => {})[("constructor" as const)];'],
    ["computed key angle-bracket cast", 'const F = (() => {})[<string>"constructor"];'],
    ["computed key non-null assertion", 'const F = (() => {})["constructor"!];'],
    ["computed key `satisfies`", 'const F = (() => {})["constructor" satisfies string];'],
    [
      "globalThis cast with a literal key `as string`",
      'const g = (globalThis as any)["eval" as string];',
    ],
    [
      "variable initialised `as const`",
      'const k = "constructor" as const; const F = (() => {})[k];',
    ],
    [
      "variable initialised `satisfies`",
      'const k = "constructor" satisfies string; const F = (() => {})[k];',
    ],
    [
      "variable initialised by an angle-bracket cast",
      'const k = <const>"constructor"; const F = (() => {})[k];',
    ],
    [
      "variable initialised with a non-null assertion",
      'const k = "constructor"!; const F = (() => {})[k];',
    ],
    [
      "assignment `as const`",
      'let k: string; k = "constructor" as const; const F = (() => {})[k];',
    ],
    [
      "assignment of a template without expressions",
      "let k: string; k = `constructor`; const F = (() => {})[k];",
    ],
    ["parameter default", 'function f(k = "constructor") { return (() => {})[k]; }'],
    [
      "object destructuring default",
      'const { k = "constructor" } = {} as { k?: string }; const F = (() => {})[k];',
    ],
    [
      "array destructuring default",
      'const [k = "constructor"] = [] as string[]; const F = (() => {})[k];',
    ],
  ] as const) {
    it.fails(`${label} is an error`, async () => {
      expect(await guardErrors(PAGE_TS, code)).not.toEqual([]);
    });
  }
});

describe("SEC-086: specifier forms the normal-form check does not see", () => {
  for (const [label, file, code] of [
    // Node's ESM resolver decodes these (checked: new URL + fileURLToPath give the real file).
    [
      "percent-encoded dot segments to scripts (static)",
      PAGE_TS,
      'import { x } from "./%2e%2e/%2e%2e/%2e%2e/scripts/bootstrap-admin";',
    ],
    [
      "percent-encoded dot segments to scripts (dynamic, .js)",
      PAGE_JS,
      'const m = await import("./%2e%2e/%2e%2e/%2e%2e/scripts/bootstrap-admin.ts");',
    ],
    ["percent-encoded db segment", PAGE_TS, 'import { db } from "../../server/%64b";'],
    [
      "percent-encoded scripts segment",
      PAGE_TS,
      'import { x } from "../../../%73cripts/bootstrap-admin";',
    ],
    [
      "percent-encoded sibling db from a src/server subfolder",
      SERVER_SUB,
      'import { db } from "../%64b";',
    ],
    // NTFS directory stream suffix: TypeScript resolves these on Windows (checked).
    [
      "alias with an NTFS stream suffix",
      PAGE_TS,
      'import { db } from "@/server/db::$INDEX_ALLOCATION";',
    ],
    [
      "relative path with an NTFS stream suffix (require, .js)",
      PAGE_JS,
      'const m = require("../../server/db::$INDEX_ALLOCATION");',
    ],
    [
      "scripts with an NTFS stream suffix",
      PAGE_TS,
      'import { x } from "../../../scripts::$INDEX_ALLOCATION/bootstrap-admin";',
    ],
    [
      "sibling db with an NTFS stream suffix",
      SERVER_SUB,
      'import { db } from "../db::$INDEX_ALLOCATION";',
    ],
    // data: URL: Node imports it (checked: it yields createRequire); its code is never linted.
    [
      "dynamic import of a data: URL (.js)",
      PAGE_JS,
      'const m = await import("data:text/javascript;base64,ZXhwb3J0e2NyZWF0ZVJlcXVpcmV9ZnJvbSdub2RlOm1vZHVsZSc=");',
    ],
    [
      "re-export from a data: URL (.js)",
      PAGE_JS,
      'export * from "data:text/javascript,export{createRequire}from%27node:module%27";',
    ],
  ] as const) {
    it.fails(`${label} is an error`, async () => {
      expect(await guardErrors(file, code)).not.toEqual([]);
    });
  }
});

describe("SEC-087: leaving src for a folder the SEC-083 pattern does not list", () => {
  for (const [label, hopFile, hopCode, pageCode] of [
    [
      "a new top-level folder re-exports a tests helper that imports the db layer",
      "shared/leak.ts",
      'export * from "../tests/helpers/reset";',
      'import { x } from "../../../shared/leak";',
    ],
    [
      "a root file re-exports scripts",
      "leak.ts",
      'export * from "./scripts/bootstrap-admin";',
      'import { x } from "../../../leak";',
    ],
  ] as const) {
    // Secure behaviour: at least one of the two hops is an error.
    it.fails(`${label}: one hop is an error`, async () => {
      const errors = [
        ...(await guardErrors(hopFile, hopCode)),
        ...(await guardErrors(PAGE_TS, pageCode)),
      ];
      expect(errors).not.toEqual([]);
    });
  }
});
