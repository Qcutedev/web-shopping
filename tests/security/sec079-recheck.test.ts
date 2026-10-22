/**
 * Security re-check of SEC-079 (qa fix in 76e43d8): `scanEnvText` now hands the env file text to
 * the `@next/env` that `next` resolves to, with `process.env` cleared during the call.
 *
 * The SEC-079 sweep in `sec078-recheck.test.ts` covers split assignments. This file checks what the
 * new design itself could get wrong:
 *   - the call leaves `process.env` exactly as it found it, also when the text is refused;
 *   - each call is independent (a fresh module copy: no `__NEXT_PROCESSED_ENV` short cut, no value
 *     carried from an earlier call);
 *   - SEC-080 (new, open): the server expands `$NAME` and `${NAME}` against the real process
 *     environment, the scanner against an empty one. A driver variable whose file value is only a
 *     reference therefore reaches the server non-empty while the scanner reads it as empty and
 *     does not refuse.
 *
 * This file holds no character outside printable ASCII (SEC-040, SEC-043).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REPO_ROOT } from "../../e2e/support/constants";
import { assertNoDriverOverrideForE2e, scanEnvText } from "../../e2e/support/env-file-scan";

const requireFromRepo = createRequire(join(REPO_ROOT, "package.json"));
const NEXT_DIR = dirname(requireFromRepo.resolve("next/package.json"));
const NEXT_ENV_ENTRY = createRequire(join(NEXT_DIR, "package.json")).resolve("@next/env");

type NextEnv = {
  loadEnvConfig: (
    dir: string,
    dev: boolean,
    log: { info: () => void; error: () => void },
    forceReload: boolean,
  ) => { combinedEnv: Record<string, string | undefined> };
};

/** What the e2e server's loader sets for `name` from a `.env` holding `text`, in this process. */
function serverValue(text: string, name: string): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "sec079-"));
  const saved = { ...process.env };
  try {
    writeFileSync(join(dir, ".env"), text, "utf8");
    delete process.env[name];
    // A fresh copy, as a starting server has: `@next/env` keeps the environment of its first call
    // as its initial environment, and `scanEnvText` leaves a copy whose initial environment is empty.
    delete requireFromRepo.cache[NEXT_ENV_ENTRY];
    const nextEnv = requireFromRepo(NEXT_ENV_ENTRY) as NextEnv;
    const { combinedEnv } = nextEnv.loadEnvConfig(dir, true, { info() {}, error() {} }, true);
    return combinedEnv[name];
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SEC-079 re-check: the scanner is the server's parser and leaves no trace", () => {
  it("process.env is identical before and after a call, for a refused and an accepted text", () => {
    vi.stubEnv("SEC079_MARKER", "kept");
    const before = { ...process.env };
    expect(scannerRefuses("PGOPTIONS=-c role=x\nA=1\n")).toBe(true);
    expect({ ...process.env }).toEqual(before);
    expect(scannerRefuses("A=1\nB=2\n")).toBe(false);
    expect({ ...process.env }).toEqual(before);
    expect(process.env["PGOPTIONS"]).toBe(before["PGOPTIONS"]);
    expect(process.env["A"]).toBe(before["A"]);
  });

  it("each call stands alone: a second text is parsed in full, no value of the first leaks in", () => {
    expect(scanEnvText("FIRST=1\n")).toEqual({ FIRST: "1" });
    expect(scanEnvText("NODE_PG_FORCE_NATIVE=1\n")).toEqual({ NODE_PG_FORCE_NATIVE: "1" });
    expect(scanEnvText("SECOND=2\n")).toEqual({ SECOND: "2" });
  });

  it("a driver variable already set in the real environment is still read from the file", () => {
    // `processEnv` skips names that its initial environment holds; the scanner clears it first.
    vi.stubEnv("PGOPTIONS", "");
    expect(scannerRefuses("PGOPTIONS=-c role=x\n")).toBe(true);
  });
});

describe("SEC-080: a driver value that only references another variable", () => {
  const references = [
    ["braced", "PGOPTIONS=${SEC080_PROBE}\n", "PGOPTIONS"],
    ["bare", "PGOPTIONS=$SEC080_PROBE\n", "PGOPTIONS"],
    ["double-quoted", 'NODE_PG_FORCE_NATIVE="${SEC080_PROBE}"\n', "NODE_PG_FORCE_NATIVE"],
  ] as const;

  it("the fixtures reach the server non-empty (the case below is not vacuous)", () => {
    vi.stubEnv("SEC080_PROBE", "-c role=x");
    for (const [, text, name] of references) {
      expect(serverValue(text, name)).toBe("-c role=x");
    }
  });

  // Open (SEC-080). Flip to `it` when fixed.
  it.fails("the scanner refuses a driver value the server expands from the environment", () => {
    vi.stubEnv("SEC080_PROBE", "-c role=x");
    const missed = references.filter(([, text]) => !scannerRefuses(text)).map(([label]) => label);
    expect(missed).toEqual([]);
  });
});
