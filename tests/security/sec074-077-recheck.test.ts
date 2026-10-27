/**
 * Security re-check of SEC-074 to SEC-077 (qa fixes in d729de0), and SEC-078.
 *
 * - SEC-074: the e2e server gets `PGOPTIONS=""`, `NODE_PG_FORCE_NATIVE=""`, and
 *   `NODE_ENV=development` in `webServer.env`. The empty values must survive the launch chain
 *   Playwright uses (a shell, `pnpm exec`, a forked server process) and must not be overridden by
 *   `@next/env`. The env-file scanner is checked against `@next/env` itself.
 * - SEC-075: own upload root (git-ignored) and a per-run secret in the config.
 * - SEC-076: `--hostname 127.0.0.1` and an IPv4 loopback origin.
 * - SEC-077: the canary check refuses a server that does not read the e2e database, and runs
 *   before the first request that writes.
 * - SEC-078: the scanner refuses an assignment that `@next/env` reads after a quoted value
 *   followed by U+2028 or U+2029 (fixed, plain `it`).
 *
 * Invisible characters are written as escapes only (SEC-043).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { E2E_HOST, E2E_ORIGIN, E2E_UPLOAD_DIR, REPO_ROOT } from "../../e2e/support/constants";
import { assertNoDriverOverrideForE2e, scanEnvText } from "../../e2e/support/env-file-scan";
import { e2eServerCommand, e2eServerEnvironment } from "../../e2e/support/server-environment";
import { assertServerShowsCanary, newCanarySlug } from "../../e2e/support/server-identity";

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

/** What `@next/env` (the e2e server's loader) sets for the driver names from one `.env` text. */
function nextEnvDriverNames(fileName: string, text: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "sec074-"));
  const saved = { ...process.env };
  try {
    writeFileSync(join(dir, fileName), text, "utf8");
    for (const name of DRIVER_NAMES) delete process.env[name];
    const nextEnv = requireFromRepo(NEXT_ENV_ENTRY) as NextEnv;
    const silent = { info: () => {}, error: () => {} };
    const { combinedEnv } = nextEnv.loadEnvConfig(dir, true, silent, true);
    return DRIVER_NAMES.filter((name) => (combinedEnv[name] ?? "") !== "");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Names playwright.config.ts adds to `webServer.env` next to `e2eServerEnvironment(...)`.
 * `SIGN_UP_RATE_LIMIT` is refused by src/server/env.ts and getAuthRuntime when
 * NODE_ENV=production (CR-S116-03); any new name needs a security review first.
 */
const REVIEWED_EXTRAS: readonly string[] = ["SIGN_UP_RATE_LIMIT"];

/** Index just past the bracket that closes the one at `open`; throws when unbalanced. */
function closeOf(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) throw new Error("unterminated string");
      i = end;
    } else if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch === ")" || ch === "}" || ch === "]") {
      if (stack.pop() !== ch) throw new Error("unbalanced brackets");
      if (stack.length === 0) return i + 1;
    }
  }
  throw new Error("unbalanced brackets");
}

/**
 * The extra names in `webServer.env`. Fails the test unless the value is `e2eServerEnvironment(...)`
 * or `{ ...e2eServerEnvironment(...), NAME, NAME: value }` with no second spread and the call first.
 */
function webServerEnvExtras(config: string): string[] {
  const code = config.replace(/^\s*\/\/.*$/gm, "");
  const webServer = code.indexOf("webServer: {");
  expect(webServer).toBeGreaterThan(-1);
  const block = code.slice(webServer, closeOf(code, webServer + "webServer: ".length));
  const envAt = block.search(/\benv:\s*/);
  expect(envAt).toBeGreaterThan(-1);
  const value = block.slice(envAt).replace(/^env:\s*/, "");
  if (value.startsWith("e2eServerEnvironment(")) return [];
  expect(value.startsWith("{")).toBe(true);
  const inner = value.slice(1, closeOf(value, 0) - 1).trim();
  const call = "...e2eServerEnvironment(";
  expect(inner.startsWith(call)).toBe(true);
  const rest = inner.slice(closeOf(inner, call.length - 1));
  const names: string[] = [];
  let depth = 0;
  let entry = "";
  const flush = () => {
    const text = entry.trim();
    entry = "";
    if (text === "") return;
    const match = /^(?:([A-Za-z_$][\w$]*)|"([^"]+)"|'([^']+)')\s*(?::[\s\S]*)?$/.exec(text);
    if (!match) throw new Error(`webServer.env entry not reviewed: ${text}`);
    names.push(match[1] ?? match[2] ?? match[3]!);
  };
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = rest.indexOf(ch, i + 1);
      entry += rest.slice(i, end + 1);
      i = end;
      continue;
    }
    if ("({[".includes(ch)) depth++;
    if (")}]".includes(ch)) depth--;
    if (ch === "," && depth === 0) flush();
    else entry += ch;
  }
  flush();
  return names;
}

function scannerRefuses(text: string): boolean {
  try {
    assertNoDriverOverrideForE2e(scanEnvText(text), "the .env file");
    return false;
  } catch {
    return true;
  }
}

describe("SEC-074 re-check: the scanner against @next/env", () => {
  // Each text makes @next/env set a driver variable; the scanner must refuse every one.
  const SERVER_READS: Record<string, string> = {
    "byte order mark": "\uFEFFPGOPTIONS=-c role=x\n",
    "lone CR": "A=1\rPGOPTIONS=-c role=x\rNODE_PG_FORCE_NATIVE=1\r",
    "colon form": "PGOPTIONS: -c role=x\n",
    "leading U+2028": "\u2028PGOPTIONS=-c role=x\n",
    "leading no-break space": "\u00A0PGOPTIONS=-c role=x\n",
    "tabs around =": "PGOPTIONS\t=\t-c role=x\n",
    "export with a tab": "export\tPGOPTIONS=x\n",
    "backtick value": "PGOPTIONS=`-c role=x`\n",
    "lower case name (Windows env is case-insensitive)": "pgoptions=x\n",
    "after a comment": "# c\nNODE_PG_FORCE_NATIVE=1\n",
  };

  for (const [label, text] of Object.entries(SERVER_READS)) {
    it(`refuses what @next/env reads: ${label}`, () => {
      const serverSees = nextEnvDriverNames(".env", text);
      // The fixture must really reach the server, or the case proves nothing.
      if (label.startsWith("lower case") && process.platform !== "win32") return;
      expect(serverSees.length).toBeGreaterThan(0);
      expect(scannerRefuses(text)).toBe(true);
    });
  }

  // SEC-078: JavaScript `^`/`$` in multiline mode also break at U+2028 and U+2029, and dotenv's
  // pattern ends a quoted value there, so the next assignment on the same "line" is read. The
  // scanner splits on CR and LF only, and its `.` does not cross U+2028, so it sees nothing.
  for (const [label, separator] of [
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ] as const) {
    // `.env`, not `.env.local`: under vitest NODE_ENV is test, and @next/env skips `.env.local` then.
    it(`SEC-078: refuses PGOPTIONS after a quoted value and ${label}`, () => {
      const text = `A='1'${separator}PGOPTIONS=-c role=x\n`;
      expect(nextEnvDriverNames(".env", text)).toEqual(["PGOPTIONS"]);
      expect(scannerRefuses(text)).toBe(true);
    });
  }
});

describe("SEC-074 re-check: the empty driver values survive the launch chain", () => {
  // Same shape as Playwright 1.64 (lib/runner/index.js: spawn with `shell: true`, process.env
  // under webServer.env), then `pnpm exec node`, then a fork like `next dev` does, then
  // @next/env over a file with a quoted value and U+2028 (the SEC-078 shape).
  it("PGOPTIONS and NODE_PG_FORCE_NATIVE stay empty after @next/env, NODE_ENV is development", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sec074-chain-"));
    try {
      writeFileSync(
        join(dir, ".env.development.local"),
        "A='1'\u2028PGOPTIONS=-c default_transaction_read_only=on\u2028NODE_PG_FORCE_NATIVE=1\n",
        "utf8",
      );
      writeFileSync(join(dir, ".env.test"), "PGOPTIONS=-c role=x\n", "utf8");
      const leaf = join(dir, "leaf.cjs");
      writeFileSync(
        leaf,
        [
          `const { combinedEnv } = require(${JSON.stringify(NEXT_ENV_ENTRY)}).loadEnvConfig(${JSON.stringify(dir)}, true, { info() {}, error() {} }, true);`,
          `process.stdout.write(JSON.stringify({ present: "PGOPTIONS" in process.env && "NODE_PG_FORCE_NATIVE" in process.env, PGOPTIONS: combinedEnv.PGOPTIONS, NODE_PG_FORCE_NATIVE: combinedEnv.NODE_PG_FORCE_NATIVE, NODE_ENV: process.env.NODE_ENV }));`,
        ].join("\n"),
      );
      const mid = join(dir, "mid.cjs");
      writeFileSync(
        mid,
        `require("node:child_process").fork(${JSON.stringify(leaf)}, { env: { ...process.env }, stdio: "inherit" });`,
      );
      const server = e2eServerEnvironment({
        databaseUrl: "postgresql://u:p@127.0.0.1:5433/marketplace_e2e",
        origin: E2E_ORIGIN,
        uploadDir: E2E_UPLOAD_DIR,
        authSecret: "x".repeat(64),
      });
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test" };
      for (const name of DRIVER_NAMES) delete env[name];
      Object.assign(env, server);
      const output = await new Promise<string>((done, fail) => {
        const child = spawn(`pnpm exec node "${mid}"`, [], {
          env,
          shell: true,
          cwd: REPO_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
        child.on("error", fail);
        child.on("exit", () => done(out));
      });
      const seen = JSON.parse(output.slice(output.indexOf("{"))) as Record<string, unknown>;
      expect(seen).toEqual({
        present: true,
        PGOPTIONS: "",
        NODE_PG_FORCE_NATIVE: "",
        NODE_ENV: "development",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("playwright.config.ts starts the server with these values and a per-run secret", () => {
    const config = readFileSync(resolve(REPO_ROOT, "playwright.config.ts"), "utf8");
    expect(config).toContain("command: e2eServerCommand()");
    expect(config).toContain('authSecret: randomBytes(32).toString("hex")');
    expect(config).toContain("reuseExistingServer: false");

    // webServer.env is either `e2eServerEnvironment({...})` itself, or an object literal whose
    // first entry spreads it. In the second shape nothing after the spread may replace a name
    // e2eServerEnvironment sets (NODE_ENV, PGOPTIONS, NODE_PG_FORCE_NATIVE, DATABASE_URL,
    // UPLOAD_DIR, AUTH_SECRET, ...), and the only extra names are the reviewed e2e-only ones.
    const extras = webServerEnvExtras(config);
    const pinned = Object.keys(
      e2eServerEnvironment({ databaseUrl: "d", origin: "o", uploadDir: "u", authSecret: "s" }),
    );
    for (const name of extras) expect(pinned).not.toContain(name);
    expect(extras.every((name) => REVIEWED_EXTRAS.includes(name))).toBe(true);
    // CR-S116-03: the e2e-only rate limit reaches the server only, never the runner process.
    expect(config.replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/process\.env\b/);
  });
});

describe("SEC-075 and SEC-076 re-check", () => {
  it("the e2e upload root is git-ignored and is not the development root", () => {
    const probe = join(E2E_UPLOAD_DIR, "probe.webp");
    const result = spawnSync("git", ["check-ignore", "-q", probe], { cwd: REPO_ROOT });
    expect(result.status).toBe(0);
    expect(resolve(E2E_UPLOAD_DIR)).not.toBe(resolve(process.env["UPLOAD_DIR"] ?? "\0"));
  });

  it("binds and names IPv4 loopback only", () => {
    expect(E2E_HOST).toBe("127.0.0.1");
    expect(e2eServerCommand()).toMatch(/ --hostname 127\.0\.0\.1 --port \d+$/);
    expect(new URL(E2E_ORIGIN).hostname).toBe("127.0.0.1");
  });
});

describe("SEC-077 re-check: the canary check", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  async function serve(body: string, status = 200): Promise<{ url: string; writes: string[] }> {
    const writes: string[] = [];
    server = createServer((req, res) => {
      if (req.method !== "GET") writes.push(`${req.method} ${req.url}`);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/api/v1/categories`, writes };
  }

  const read = (url: string) => async () => {
    const response = await fetch(url);
    return { status: response.status, body: await response.text() };
  };

  it("refuses a real server whose category list lacks the canary (another database)", async () => {
    const slug = newCanarySlug();
    const other = await serve(JSON.stringify({ data: [{ slug: newCanarySlug() }] }));
    await expect(assertServerShowsCanary(read(other.url), slug)).rejects.toThrow(/refused/);
    expect(other.writes).toEqual([]);
  });

  it("refuses a slug that appears only as a substring, an error status, and no answer", async () => {
    const slug = newCanarySlug();
    const partial = await serve(JSON.stringify({ data: [{ slug: `${slug}x` }] }));
    await expect(assertServerShowsCanary(read(partial.url), slug)).rejects.toThrow(/refused/);
    await new Promise<void>((done) => server!.close(() => done()));
    const failing = await serve(JSON.stringify({ data: [{ slug }] }), 500);
    await expect(assertServerShowsCanary(read(failing.url), slug)).rejects.toThrow(/refused/);
    await expect(
      assertServerShowsCanary(async () => Promise.reject(new Error("ECONNREFUSED")), slug),
    ).rejects.toThrow(/did not answer/);
  });

  it("accepts the server that shows the canary", async () => {
    const slug = newCanarySlug();
    const e2e = await serve(JSON.stringify({ data: [{ slug }] }));
    await expect(assertServerShowsCanary(read(e2e.url), slug)).resolves.toBeUndefined();
  });

  it("global-setup checks the canary before the sign-up and after it is written", () => {
    const setup = readFileSync(resolve(REPO_ROOT, "e2e/global-setup.ts"), "utf8");
    const written = setup.indexOf('run("canary"');
    const checked = setup.indexOf("await assertServerShowsCanary(");
    const signUp = setup.indexOf('api.post("/api/v1/auth/sign-up"');
    expect(written).toBeGreaterThan(-1);
    expect(checked).toBeGreaterThan(written);
    expect(signUp).toBeGreaterThan(checked);
    expect(setup.indexOf("api.post(")).toBe(signUp);
  });
});
