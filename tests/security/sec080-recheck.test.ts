/**
 * Security re-check of SEC-080 (qa fix in c2bf1f9): `scanEnvText` parses twice, the second time
 * with the real environment minus the driver names, and takes the driver names from that pass.
 *
 * The cases are differential: each fixture is given to the server's loader (`loadEnvConfig` of a
 * fresh `@next/env`, real environment) and to the scanner. Whenever the server ends up with a
 * non-empty driver value, the scanner must refuse. Shapes go beyond the three of
 * `sec079-recheck.test.ts`: defaults, alternates, prefixes, chains through a file variable, a
 * lower-case name, quoting, and a name the real environment already holds.
 *
 * SEC-082 (new, open): `DATABASE_URL` is not a driver name, so it is still taken from the first
 * pass (empty environment). A development URL written as a reference is read as empty and dropped
 * from the comparison with the test URL (`collectDevelopmentUrls`).
 *
 * This file holds no character outside printable ASCII (SEC-040, SEC-043).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REPO_ROOT } from "../../e2e/support/constants";
import {
  assertNoDriverOverrideForE2e,
  collectDevelopmentUrls,
  scanEnvText,
} from "../../e2e/support/env-file-scan";

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

/** What a starting `next dev` sets for `name` from a `.env` holding `text`, in this environment. */
function serverValue(text: string, name: string): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "sec080-"));
  const saved = { ...process.env };
  try {
    writeFileSync(join(dir, ".env"), text, "utf8");
    delete process.env[name];
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

const PROBE = "-c role=x";

/** [label, text, driver name as the server sees it] */
const shapes: ReadonlyArray<readonly [string, string, string]> = [
  ["braced", "PGOPTIONS=${SEC080_PROBE}\n", "PGOPTIONS"],
  ["bare", "PGOPTIONS=$SEC080_PROBE\n", "PGOPTIONS"],
  ["prefix", "PGOPTIONS=pre${SEC080_PROBE}\n", "PGOPTIONS"],
  ["default of unset", "PGOPTIONS=${SEC080_UNSET:-$SEC080_PROBE}\n", "PGOPTIONS"],
  ["dash default of unset", "PGOPTIONS=${SEC080_UNSET-${SEC080_PROBE}}\n", "PGOPTIONS"],
  ["set with default", "PGOPTIONS=${SEC080_PROBE:-}\n", "PGOPTIONS"],
  ["chain through file", "A80=${SEC080_PROBE}\nPGOPTIONS=$A80\n", "PGOPTIONS"],
  ["chain, reference first", "PGOPTIONS=${B80}\nB80=${SEC080_PROBE}\n", "PGOPTIONS"],
  ["double-quoted", 'NODE_PG_FORCE_NATIVE="${SEC080_PROBE}"\n', "NODE_PG_FORCE_NATIVE"],
  ["export prefix", "export PGOPTIONS=${SEC080_PROBE}\n", "PGOPTIONS"],
  ["colon form", "PGOPTIONS: ${SEC080_PROBE}\n", "PGOPTIONS"],
  ["single-quoted", "PGOPTIONS='${SEC080_PROBE}'\n", "PGOPTIONS"],
  ["escaped dollar", "PGOPTIONS=\\${SEC080_PROBE}\n", "PGOPTIONS"],
  ["two references", "PGOPTIONS=${SEC080_EMPTY}${SEC080_PROBE}\n", "PGOPTIONS"],
];

describe("SEC-080 re-check: driver values expanded from the real environment", () => {
  it("the shapes are not vacuous: all of them reach the server non-empty", () => {
    vi.stubEnv("SEC080_PROBE", PROBE);
    vi.stubEnv("SEC080_EMPTY", "");
    const reaching = shapes.filter(([, text, name]) => (serverValue(text, name) ?? "") !== "");
    expect(reaching.length).toBe(shapes.length);
  });

  it("every shape the server reads as non-empty is refused by the scanner", () => {
    vi.stubEnv("SEC080_PROBE", PROBE);
    vi.stubEnv("SEC080_EMPTY", "");
    const missed = shapes
      .filter(([, text, name]) => (serverValue(text, name) ?? "") !== "")
      .filter(([, text]) => !scannerRefuses(text))
      .map(([label]) => label);
    expect(missed).toEqual([]);
  });

  it("a lower-case driver name that references the environment is refused", () => {
    vi.stubEnv("SEC080_PROBE", PROBE);
    expect(scannerRefuses("pgoptions=${SEC080_PROBE}\n")).toBe(true);
  });

  it("a driver name the real environment holds as empty does not hide the file value", () => {
    vi.stubEnv("SEC080_PROBE", PROBE);
    vi.stubEnv("PGOPTIONS", "");
    expect(scannerRefuses("PGOPTIONS=${SEC080_PROBE}\n")).toBe(true);
    expect(scannerRefuses("PGOPTIONS=-c role=x\n")).toBe(true);
  });

  it("a driver value referencing the other driver name is refused when the file sets it", () => {
    vi.stubEnv("NODE_PG_FORCE_NATIVE", "");
    expect(scannerRefuses("NODE_PG_FORCE_NATIVE=1\nPGOPTIONS=${NODE_PG_FORCE_NATIVE}\n")).toBe(
      true,
    );
  });

  it("a reference to an unset variable is still accepted (no false refusal)", () => {
    expect(scannerRefuses("PGOPTIONS=${SEC080_SURELY_UNSET}\n")).toBe(false);
    expect(scannerRefuses("A=1\nB=${A}\n")).toBe(false);
  });

  it("the environment is restored after both passes, also on a refusal", () => {
    vi.stubEnv("SEC080_PROBE", PROBE);
    vi.stubEnv("PGOPTIONS", "");
    const before = { ...process.env };
    expect(scannerRefuses("PGOPTIONS=${SEC080_PROBE}\n")).toBe(true);
    expect({ ...process.env }).toEqual(before);
  });

  it("driver names come from pass 2 and other names still come from the file", () => {
    vi.stubEnv("SEC080_PROBE", PROBE);
    const parsed = scanEnvText("PGOPTIONS=${SEC080_PROBE}\nX80=1\n");
    expect(parsed["PGOPTIONS"]).toBe(PROBE);
    expect(parsed["X80"]).toBe("1");
  });
});

describe("SEC-082: a development DATABASE_URL written as a reference", () => {
  const url = "postgresql://dev:dev@127.0.0.1:5432/marketplace";

  it("the server reads the reference as the URL (the case below is not vacuous)", () => {
    vi.stubEnv("SEC082_DEV_URL", url);
    expect(serverValue("DATABASE_URL=${SEC082_DEV_URL}\n", "DATABASE_URL")).toBe(url);
  });

  // Open (SEC-082). Flip to `it` when fixed.
  it.fails("the scanner reads it as the server does, so the comparison sees it", () => {
    vi.stubEnv("SEC082_DEV_URL", url);
    const content = scanEnvText("DATABASE_URL=${SEC082_DEV_URL}\n");
    const { otherSources } = collectDevelopmentUrls({
      processUrl: undefined,
      envFileUrl: undefined,
      nextFiles: [[".env.local", content]],
    });
    expect(otherSources).toEqual(["the .env.local file"]);
  });
});
