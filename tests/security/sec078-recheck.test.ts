/**
 * Security re-check of SEC-078 (qa fix in a202868): the e2e env-file scanner must refuse every
 * driver assignment that `@next/env` (the e2e server's loader) reads.
 *
 * The SEC-078 cases in `sec074-077-recheck.test.ts` pin the two reported shapes. This file is a
 * differential sweep: every code point that JavaScript's `\s` matches, plus U+0085 (a line end in
 * some parsers, not in JavaScript), is put in each position where a separator can stand. For each
 * text, if `@next/env` sets a driver variable, the scanner must refuse the run. Over-reporting (the
 * scanner refuses a text the server does not read) is allowed by design and not asserted.
 *
 * Two families: a whole assignment that starts after the separator (SEC-078, fixed), and one
 * assignment whose name, `=` or `:`, and value are split by the separator (SEC-079, fixed:
 * the scanner now parses with `@next/env` itself).
 *
 * Invisible characters are built with `String.fromCodePoint` only (SEC-043).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../e2e/support/constants";
import { assertNoDriverOverrideForE2e, scanEnvText } from "../../e2e/support/env-file-scan";

const requireFromRepo = createRequire(join(REPO_ROOT, "package.json"));
const NEXT_DIR = dirname(requireFromRepo.resolve("next/package.json"));
const NEXT_ENV_ENTRY = createRequire(join(NEXT_DIR, "package.json")).resolve("@next/env");
const DRIVER_NAMES = ["PGOPTIONS", "NODE_PG_FORCE_NATIVE"] as const;

type NextEnv = {
  loadEnvConfig: (
    dir: string,
    dev: boolean,
    log: { info: () => void; error: () => void },
    forceReload: boolean,
  ) => { combinedEnv: Record<string, string | undefined> };
};

function nextEnvSetsDriver(text: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "sec078-"));
  const saved = { ...process.env };
  try {
    writeFileSync(join(dir, ".env"), text, "utf8");
    for (const name of DRIVER_NAMES) delete process.env[name];
    const nextEnv = requireFromRepo(NEXT_ENV_ENTRY) as NextEnv;
    const { combinedEnv } = nextEnv.loadEnvConfig(dir, true, { info() {}, error() {} }, true);
    return DRIVER_NAMES.some((name) => (combinedEnv[name] ?? "") !== "");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
  }
}

function scannerRefuses(text: string): boolean {
  try {
    assertNoDriverOverrideForE2e(scanEnvText(text), "the .env file");
    return false;
  } catch {
    return true;
  }
}

const CODE_POINTS = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

type Template = [string, (s: string) => string];

// SEC-078 family: a whole assignment starts after the separator. Fixed in a202868.
const STARTS_AFTER: Template[] = [
  ["leading", (s) => `${s}PGOPTIONS=-c role=x\n`],
  ["after a single-quoted value", (s) => `A='1'${s}PGOPTIONS=-c role=x\n`],
  ["after a double-quoted value", (s) => `A="1"${s}PGOPTIONS=-c role=x\n`],
  ["after a backtick value", (s) => `A=\`1\`${s}PGOPTIONS=-c role=x\n`],
  ["after an unquoted value", (s) => `A=1${s}PGOPTIONS=-c role=x\n`],
  ["after an empty value", (s) => `A=${s}PGOPTIONS=-c role=x\n`],
  ["after a comment", (s) => `# c${s}PGOPTIONS=-c role=x\n`],
  ["after a value and a comment", (s) => `A=1 # c${s}NODE_PG_FORCE_NATIVE=1\n`],
  ["between export and the name", (s) => `export${s}PGOPTIONS=-c role=x\n`],
  ["after a byte order mark", (s) => `${String.fromCodePoint(0xfeff)}${s}PGOPTIONS=-c role=x\n`],
];

// SEC-079 family: the separator stands inside one assignment, between the name, the `=` or `:`,
// and the value. dotenv's `\s` crosses CR, LF, U+2028, and U+2029 there; a line scanner cannot.
const INSIDE: Template[] = [
  ["around the equals sign", (s) => `PGOPTIONS${s}=${s}-c role=x\n`],
  ["before the equals sign", (s) => `PGOPTIONS${s}=-c role=x\n`],
  ["after the equals sign", (s) => `PGOPTIONS=${s}-c role=x\n`],
  ["after the equals sign, quoted value", (s) => `PGOPTIONS=${s}'-c role=x'\n`],
  ["after the colon, quoted value", (s) => `PGOPTIONS:${s}'-c role=x'\n`],
  ["twice before the equals sign", (s) => `PGOPTIONS${s}${s}=-c role=x\n`],
  ["after the colon", (s) => `PGOPTIONS:${s}-c role=x\n`],
];

function sweep(templates: Template[]): { serverReads: number; missed: string[] } {
  const missed: string[] = [];
  let serverReads = 0;
  for (const codePoint of CODE_POINTS) {
    const separator = String.fromCodePoint(codePoint);
    for (const [label, build] of templates) {
      const text = build(separator);
      if (!nextEnvSetsDriver(text)) continue;
      serverReads += 1;
      if (!scannerRefuses(text)) {
        missed.push(`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} ${label}`);
      }
    }
  }
  return { serverReads, missed };
}

describe("SEC-078 re-check: differential sweep of separators against @next/env", () => {
  it("SEC-078: refuses every assignment that @next/env reads after a separator", () => {
    const { serverReads, missed } = sweep(STARTS_AFTER);
    // The sweep must reach the server often, or it proves nothing.
    expect(serverReads).toBeGreaterThan(90);
    expect(missed).toEqual([]);
  }, 60_000);

  it("the split-assignment fixtures reach the server (SEC-079 case below is not vacuous)", () => {
    const newline = String.fromCodePoint(0x0a);
    expect(nextEnvSetsDriver(`PGOPTIONS${newline}=-c role=x\n`)).toBe(true);
    expect(nextEnvSetsDriver(`PGOPTIONS:${newline}-c role=x\n`)).toBe(true);
  });

  // SEC-079 (fixed): name, `=` or `:`, and value on different lines.
  it("SEC-079: refuses an assignment split across line terminators", () => {
    const { serverReads, missed } = sweep(INSIDE);
    expect(serverReads).toBeGreaterThan(20);
    expect(missed).toEqual([]);
  }, 60_000);
});
