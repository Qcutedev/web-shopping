/**
 * Re-check of SEC-043 (commits 395ec6e and 59ed184), SEC-044 and SEC-045 (commit c46c52e, register
 * e362c62). Owner: security. Review: docs/reviews/SEC-043-045-recheck.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape: every code
 * point is a number given to `String.fromCodePoint` (SEC-040, SEC-043).
 *
 * A case written `it.fails` states the secure behaviour of an open finding (SEC-046 to SEC-048):
 * it is reported as an expected failure while the flaw exists and turns red when the code is
 * fixed; the fix then changes `it.fails` to `it` without touching the body. SEC-046 and SEC-047
 * were flipped in commit 544d2ee (re-checked in sec046-047-recheck.test.ts).
 *
 * One case starts a child Node process and a listener on 127.0.0.1 (SEC-046); nothing leaves the
 * machine. Everything else is pure: no database, no network.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BetterAuthError } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_LIBRARY_VARIABLES,
  ENV_RULES,
  EnvValidationError,
  parseEnv,
  readAuthSecret,
} from "@/server/env";
import { errorResponse } from "@/server/http";
import { createLogger } from "@/server/logger";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

const CANARY = "Zq7SECRETcanary";
const GOOD_SECRET = `${CANARY}-a8f3k2m9q1w7e5r0t6y4u2i8o3p1`;
const APP_URL = "https://shop.example.test";
const DATABASE_URL = "postgresql://shop:Zq7dbPw@db.example.test:5432/shop?schema=public";
const LIBRARY_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const INTEGRATION_SECRET = "integration-test-secret-0123456789-abcdefghij";

function source(overrides: Record<string, string | undefined> = {}) {
  return { NODE_ENV: "development", APP_URL, DATABASE_URL, AUTH_SECRET: GOOD_SECRET, ...overrides };
}
function production(overrides: Record<string, string | undefined> = {}) {
  return source({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1", ...overrides });
}
function issuesOf(run: () => unknown): { variable: string; rule: string }[] {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvValidationError) return [...error.issues];
    throw error;
  }
  return [];
}
/** Issues from both readers; they must agree on AUTH_SECRET. */
function bothReaders(env: Record<string, string | undefined>) {
  return { parse: issuesOf(() => parseEnv(env)), read: issuesOf(() => readAuthSecret(env)) };
}
const WEAK = [{ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretWeak }];

// ---------------------------------------------------------------------------------------------
// SEC-043

const BACKSLASH = String.fromCharCode(0x5c);
/** The six-character source escape of a BMP code point, upper-case hex: backslash, u, 4 digits. */
const escapeOf = (code: number): string =>
  `${BACKSLASH}u${code.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * A line of SEC-043 is pinned by its exact statement (the line with leading and trailing blanks
 * removed), not by its number, so the pin survives edits that move the line. It must match
 * exactly one line of the file. Built with `escapeOf` and `BACKSLASH` so this file holds no escape.
 */
type LinePin = { statement: string };

/** The seven lines named in SEC-043 and the code point each one held as a literal. */
const SEC043_LINES: [string, LinePin, number[]][] = [
  // Was src/proxy.test.ts:74.
  [
    "src/proxy.test.ts",
    { statement: `"theme=dark; ${escapeOf(0xa0)}better-auth.session_token=abc",` },
    [0xa0],
  ],
  // Was src/server/http.test.ts:1549.
  [
    "src/server/http.test.ts",
    {
      statement: `['"${BACKSLASH}${BACKSLASH}ud7ff${BACKSLASH}${BACKSLASH}ue000"', "${escapeOf(0xd7ff)}${escapeOf(0xe000)}"],`,
    },
    [0xd7ff, 0xe000],
  ],
  // Was src/server/http.test.ts:2034.
  ["src/server/http.test.ts", { statement: `"Error${escapeOf(0x2028)}",` }, [0x2028]],
  // Were lines 1633 and 1642; pinned by content since commit 19ca0ad edited this file.
  [
    "src/server/logger.test.ts",
    {
      statement: `log.security("warn", "Sign-in failed for somchai@example.com${escapeOf(0x2028)}", {`,
    },
    [0x2028],
  ],
  [
    "src/server/logger.test.ts",
    { statement: `expect(raw).not.toContain("${escapeOf(0x2028)}");` },
    [0x2028],
  ],
  // Was tests/integration/harness/test-database-url.test.ts:348.
  [
    "tests/integration/harness/test-database-url.test.ts",
    {
      statement: `["a no-break space in the name", urlFor("127.0.0.1", "shop${escapeOf(0xa0)}_test")],`,
    },
    [0xa0],
  ],
];

/** The pinned line's text and a label; the statement must match exactly one line. */
function pinnedLine(path: string, pin: LinePin): { text: string; label: string } {
  const lines = readFileSync(join(ROOT, path), "utf8").split("\n");
  const hits = lines.flatMap((text, index) => (text.trim() === pin.statement ? [index + 1] : []));
  expect(
    hits,
    `${path}: expected exactly one line equal to ${pin.statement}, found ${String(hits.length)}` +
      (hits.length > 1 ? ` (lines ${hits.join(", ")})` : ""),
  ).toHaveLength(1);
  return { text: lines[(hits[0] ?? 0) - 1] ?? "", label: `${path}:${String(hits[0])}` };
}

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
  ".prisma",
  ".sql",
  ".ps1",
  ".sh",
  ".toml",
  ".txt",
]);

describe("SEC-043 re-check: the literals are escapes now, and the repository scan has no blind spot", () => {
  it("the four files hold none of the seven code points as a literal, and each line now spells an escape", () => {
    for (const [path, , codes] of SEC043_LINES) {
      const text = readFileSync(join(ROOT, path), "utf8");
      for (const code of codes)
        expect(text.includes(cp(code)), `${path} ${String(code)}`).toBe(false);
    }
    for (const [path, pin, codes] of SEC043_LINES) {
      const { text, label } = pinnedLine(path, pin);
      for (const code of codes) {
        expect(text.toUpperCase(), label).toContain(escapeOf(code).toUpperCase());
      }
    }
  });

  it("no tracked or untracked file with a text extension holds a NUL byte or bytes that are not UTF-8", () => {
    // The scan of sec039-040-cr66-recheck.test.ts skips any file with a NUL byte as binary, and
    // decodes leniently, so a literal NUL or a stray Latin-1 byte (0xA0) would pass it unseen.
    const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const found: string[] = [];
    let scanned = 0;
    for (const path of listed.split("\n").filter(Boolean)) {
      if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase()) && !path.endsWith(".env.example")) {
        continue;
      }
      const full = join(ROOT, path);
      if (!existsSync(full)) continue;
      const bytes = readFileSync(full);
      scanned += 1;
      if (bytes.includes(0)) found.push(`${path}: NUL`);
      try {
        decoder.decode(bytes);
      } catch {
        found.push(`${path}: not UTF-8`);
      }
    }
    expect(scanned).toBeGreaterThan(200);
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-044

describe("SEC-044 re-check: weak production secrets refused by both readers", () => {
  it("the four values of the finding, refused by parseEnv and readAuthSecret with the weak rule", () => {
    for (const weak of [
      "x".repeat(32),
      " ".repeat(32),
      LIBRARY_DEFAULT_SECRET,
      INTEGRATION_SECRET,
    ]) {
      const { parse, read } = bothReaders(production({ AUTH_SECRET: weak }));
      expect(parse, JSON.stringify(weak)).toEqual(WEAK);
      expect(read, JSON.stringify(weak)).toEqual(WEAK);
    }
  });

  it("published values padded with blanks that trim() removes are refused", () => {
    const pads = [" ", "\t", "\n", "\r\n", cp(0xa0), cp(0x3000), cp(0xfeff), cp(0x2028)];
    for (const published of [LIBRARY_DEFAULT_SECRET, INTEGRATION_SECRET]) {
      for (const pad of pads) {
        for (const value of [
          `${pad}${published}`,
          `${published}${pad}`,
          `${pad}${published}${pad}`,
        ]) {
          const { parse, read } = bothReaders(production({ AUTH_SECRET: value }));
          expect(parse, JSON.stringify(value)).toEqual(WEAK);
          expect(read, JSON.stringify(value)).toEqual(WEAK);
        }
      }
    }
  });

  it("exact repetitions and fewer than 8 distinct code points are refused, also with astral or blank characters", () => {
    for (const weak of [
      "abcdefgh".repeat(4),
      "0123456789abcdef".repeat(2),
      `${CANARY}-`.repeat(3),
      cp(0xa0).repeat(32),
      cp(0x200b).repeat(32),
      "abcdefg".repeat(5),
      `${"ab".repeat(15)}cdefg`, // 7 distinct, not periodic
    ]) {
      const { parse, read } = bothReaders(production({ AUTH_SECRET: weak }));
      expect(parse, JSON.stringify(weak)).toEqual(WEAK);
      expect(read, JSON.stringify(weak)).toEqual(WEAK);
    }
  });

  it("no refusal of a weak secret carries any part of it", () => {
    const value = `${CANARY}-`.repeat(3);
    for (const reader of [
      () => parseEnv(production({ AUTH_SECRET: value })),
      () => readAuthSecret(production({ AUTH_SECRET: value })),
    ]) {
      let thrown: unknown;
      try {
        reader();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EnvValidationError);
      const text = [String(thrown), (thrown as Error).stack ?? "", JSON.stringify(thrown)].join(
        "\n",
      );
      expect(text).not.toContain(CANARY);
    }
  });

  it("random secrets of the documented and common forms are accepted (8 not 16 distinct is right)", () => {
    // 16 distinct would refuse about 93 percent of `openssl rand -hex 16` values and about 24
    // percent of `openssl rand -hex 32` values (measured in this re-check on 200,000 each).
    // Since SEC-047 (commit 544d2ee) the floor also refuses a run of 8 in constant steps, which a
    // random value holds with a tiny probability (1 of 1,000,000 `openssl rand -hex 16` values in
    // the SEC-046/047 re-check, 0 of 1,000,000 for the other forms). "Never" would make this case
    // flaky, so at most 1 refusal per form in 3,000 is allowed, and a refusal must be the weak
    // rule. At the measured rate more than 1 has a probability below 1e-5.
    const forms = [
      () => randomBytes(32).toString("base64url"),
      () => randomBytes(16).toString("hex"),
      () => randomBytes(32).toString("hex"),
      () => randomBytes(24).toString("base64"),
    ];
    const refused = forms.map(() => 0);
    for (let i = 0; i < 3000; i += 1) {
      forms.forEach((generate, form) => {
        const value = generate();
        const issues = issuesOf(() => readAuthSecret(production({ AUTH_SECRET: value })));
        if (issues.length > 0) {
          expect(issues).toEqual(WEAK);
          refused[form] = (refused[form] ?? 0) + 1;
        }
      });
    }
    for (const count of refused) expect(count).toBeLessThanOrEqual(1);
  });

  it("development and test accept the weak values (by design; production is the gate)", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(parseEnv(source({ NODE_ENV: nodeEnv, AUTH_SECRET: "x".repeat(32) })).authSecret).toBe(
        "x".repeat(32),
      );
    }
  });
});

describe("SEC-047 the weak-secret floor lets near-repetitions, skewed values, and altered published values through", () => {
  it("production refuses plainly non-random values that differ from the refused shapes by one character", () => {
    for (const weak of [
      `${"password".repeat(4)}1`, // a word four times and a digit
      `${"abcdefgh".repeat(4)}i`, // a period-8 run plus one character
      `${"0123456789abcdef".repeat(2)}X`,
      `${"a".repeat(25)}bcdefgh`, // one character 25 times, exactly 8 distinct
      "abcdefghijklmnopqrstuvwxyz012345", // the alphabet
      `${cp(0x200b).repeat(25)}abcdefg`, // invisible padding, 8 distinct
      LIBRARY_DEFAULT_SECRET.toUpperCase(),
      `${LIBRARY_DEFAULT_SECRET}!`,
      `${LIBRARY_DEFAULT_SECRET}${cp(0x200b)}`,
    ]) {
      expect(
        issuesOf(() => parseEnv(production({ AUTH_SECRET: weak }))),
        JSON.stringify(weak),
      ).toEqual(WEAK);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-045

describe("SEC-045 re-check: the library takes no secret, URL, or origin from its own variables", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function freshAuth() {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.resetModules();
    const { createAuth } = await import("@/server/auth/auth");
    return createAuth({
      secret: GOOD_SECRET,
      baseUrl: APP_URL,
      appOrigin: APP_URL,
      secureCookies: true,
      trustedProxy: { trustedProxyHops: 0 },
    });
  }

  it("BETTER_AUTH_SECRETS in any form, BETTER_AUTH_SECRET, and AUTH_SECRET in the process environment do not change the signing secret", async () => {
    const forms: Record<string, string>[] = [
      { BETTER_AUTH_SECRETS: "1:x" },
      { BETTER_AUTH_SECRETS: "2:y,1:z" },
      { BETTER_AUTH_SECRETS: `${CANARY}-no-version` },
      { BETTER_AUTH_SECRETS: "abc:def" },
      { BETTER_AUTH_SECRETS: "1:" },
      { BETTER_AUTH_SECRETS: " , " },
      { BETTER_AUTH_SECRET: "x" },
      { AUTH_SECRET: "x" },
      { BETTER_AUTH_SECRETS: "1:x", BETTER_AUTH_SECRET: "y", AUTH_SECRET: "z" },
    ];
    for (const form of forms) {
      for (const [name, value] of Object.entries(form)) vi.stubEnv(name, value);
      const auth = await freshAuth();
      const context = await auth.$context;
      expect(context.secret, JSON.stringify(form)).toBe(GOOD_SECRET);
      vi.unstubAllEnvs();
    }
  });

  it("BETTER_AUTH_URL does not change the base URL the library uses", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://attacker.example.test");
    const auth = await freshAuth();
    expect((await auth.$context).baseURL).toContain("shop.example.test");
  });

  it("createAuth passes `secrets` explicitly (read from the source, so a refactor that drops it fails here)", () => {
    const text = readFileSync(join(ROOT, "src/server/auth/auth.ts"), "utf8");
    expect(text).toMatch(
      /secrets:\s*\[\{\s*version:\s*AUTH_SECRET_VERSION,\s*value:\s*settings\.secret\s*\}\]/,
    );
  });

  it("each of the library variables (SEC-045, SEC-046) is refused by both readers in every NODE_ENV, by name only; empty is not refused", () => {
    expect([...AUTH_LIBRARY_VARIABLES].sort()).toEqual(
      [
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_SECRETS",
        "BETTER_AUTH_TELEMETRY",
        "BETTER_AUTH_TELEMETRY_DEBUG",
        "BETTER_AUTH_TELEMETRY_ENDPOINT",
        "BETTER_AUTH_TRUSTED_ORIGINS",
        "BETTER_AUTH_URL",
      ].sort(),
    );
    for (const variable of AUTH_LIBRARY_VARIABLES) {
      for (const nodeEnv of ["development", "test", "production"]) {
        const value = `${CANARY}-${variable}`;
        const env =
          nodeEnv === "production"
            ? production({ [variable]: value })
            : source({ NODE_ENV: nodeEnv, [variable]: value });
        const expected = [{ variable, rule: ENV_RULES.authLibraryVariable }];
        for (const reader of [() => parseEnv(env), () => readAuthSecret(env)]) {
          let thrown: unknown;
          try {
            reader();
          } catch (error) {
            thrown = error;
          }
          expect(thrown, `${variable} ${nodeEnv}`).toBeInstanceOf(EnvValidationError);
          expect((thrown as EnvValidationError).issues).toEqual(expected);
          const text = [String(thrown), (thrown as Error).stack ?? "", JSON.stringify(thrown)].join(
            "\n",
          );
          expect(text).not.toContain(CANARY);
        }
      }
      expect(issuesOf(() => parseEnv(production({ [variable]: "" })))).toEqual([]);
    }
  });

  it("the variable names are matched exactly: a lower-case or padded name is not one the library reads", () => {
    // On Linux the library reads only the upper-case names, so a lower-case one is inert. On
    // Windows `process.env` resolves names without regard to case for the library and for
    // `parseEnv(process.env)` alike, so both see it under the upper-case name. Not a gap.
    expect(issuesOf(() => parseEnv(production({ better_auth_secrets: "1:x" })))).toEqual([]);
  });
});

describe("SEC-046 the library's telemetry variables override `telemetry: { enabled: false }` and are not refused", () => {
  it("parseEnv and readAuthSecret refuse BETTER_AUTH_TELEMETRY and BETTER_AUTH_TELEMETRY_ENDPOINT by name", () => {
    for (const variable of ["BETTER_AUTH_TELEMETRY", "BETTER_AUTH_TELEMETRY_ENDPOINT"]) {
      const env = production({ [variable]: "1" });
      expect(
        issuesOf(() => parseEnv(env)),
        variable,
      ).toEqual([{ variable, rule: ENV_RULES.authLibraryVariable }]);
      expect(
        issuesOf(() => readAuthSecret(env)),
        variable,
      ).toEqual([{ variable, rule: ENV_RULES.authLibraryVariable }]);
    }
  });

  it("library behaviour pinned: with both variables set and NODE_ENV=production the library posts to the endpoint despite `enabled: false`", async () => {
    // Why the refusal above is needed. Runs in a child process because the library reads
    // NODE_ENV once at load and suppresses telemetry under test. Local listener only.
    const entry = join(ROOT, "node_modules/better-auth/dist/auth/minimal.mjs");
    expect(existsSync(entry)).toBe(true);
    expect(readFileSync(join(ROOT, "src/server/auth/auth.ts"), "utf8")).toContain(
      "telemetry: { enabled: false }",
    );
    const bodies: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        bodies.push(body);
        response.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const child = [
      `const { betterAuth } = await import(${JSON.stringify(pathToFileURL(entry).href)});`,
      "const auth = betterAuth({",
      `  baseURL: ${JSON.stringify(APP_URL)},`,
      `  secret: ${JSON.stringify(GOOD_SECRET)},`,
      `  secrets: [{ version: 1, value: ${JSON.stringify(GOOD_SECRET)} }],`,
      "  telemetry: { enabled: false },",
      "  emailAndPassword: { enabled: true },",
      '  logger: { level: "error" },',
      "});",
      "await auth.$context;",
      "await new Promise((resolve) => setTimeout(resolve, 1000));",
    ].join("\n");
    const run = (extra: Record<string, string>) =>
      new Promise<number | null>((resolve) => {
        const processHandle = spawn(process.execPath, ["--input-type=module", "-e", child], {
          env: {
            PATH: process.env.PATH ?? "",
            SystemRoot: process.env.SystemRoot ?? "",
            NODE_ENV: "production",
            ...extra,
          },
          stdio: "ignore",
        });
        processHandle.on("exit", resolve);
      });
    try {
      expect(await run({})).toBe(0);
      expect(bodies).toHaveLength(0);
      expect(
        await run({
          BETTER_AUTH_TELEMETRY: "1",
          BETTER_AUTH_TELEMETRY_ENDPOINT: `http://127.0.0.1:${String(port)}/collect`,
        }),
      ).toBe(0);
      expect(bodies).toHaveLength(1);
      const event = JSON.parse(bodies[0] ?? "{}") as { type?: string; payload?: object };
      expect(event.type).toBe("init");
      expect(Object.keys(event.payload ?? {})).toContain("systemInfo");
      expect(bodies[0]).not.toContain(CANARY); // the secret itself is not sent
    } finally {
      server.close();
    }
  }, 30_000);
});

describe("SEC-048 an unexpected library error is logged with its message (SEC-045 remediation item 3, not done)", () => {
  it("errorResponse logs a library error by class name only, so a value quoted in its message stays out of the log", async () => {
    // The pre-fix SEC-045 message form, now unreachable for that variable, stands for any library
    // error that quotes configuration or input.
    const error = new BetterAuthError(
      `Invalid BETTER_AUTH_SECRETS entry: "${CANARY}-rotated". Expected format: "<version>:<secret>"`,
    );
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const response = errorResponse(error, { requestId: "r-1", logger });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(CANARY);
    expect(lines.join("\n")).toContain("BetterAuthError");
    expect(lines.join("\n")).not.toContain(CANARY);
  });
});
