/**
 * Re-check of SEC-046 and SEC-047 (commit 544d2ee). Owner: security. Review:
 * docs/reviews/SEC-046-047-recheck.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape: every code
 * point is a number given to `String.fromCodePoint` (SEC-040, SEC-043).
 *
 * A case written `it.fails` states the secure behaviour of an open finding (SEC-049): it is
 * reported as an expected failure while the flaw exists and turns red when the code is fixed; the
 * fix then changes `it.fails` to `it` without touching the body.
 *
 * Pure: no database, no network. One case reads the installed auth library's files.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_LIBRARY_VARIABLES,
  ENV_RULES,
  EnvValidationError,
  loadEnvAtStartup,
  parseEnv,
  readAuthSecret,
} from "@/server/env";
import { createLogger } from "@/server/logger";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

const CANARY = "Zq7SECRETcanary";
const GOOD_SECRET = `${CANARY}-a8f3k2m9q1w7e5r0t6y4u2i8o3p1`;
const APP_URL = "https://shop.example.test";
const DATABASE_URL = "postgresql://shop:Zq7dbPw@db.example.test:5432/shop?schema=public";
const LIBRARY_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const INTEGRATION_SECRET = "integration-test-secret-0123456789-abcdefghij";

/**
 * The seven names, written here and not taken from AUTH_LIBRARY_VARIABLES, so a name dropped
 * from the export fails a behavioural case and not only the list pin.
 */
const LIBRARY_VARIABLES = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_SECRETS",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "BETTER_AUTH_TELEMETRY",
  "BETTER_AUTH_TELEMETRY_ENDPOINT",
  "BETTER_AUTH_TELEMETRY_DEBUG",
] as const;

function source(overrides: Record<string, string | undefined> = {}) {
  return { NODE_ENV: "development", APP_URL, DATABASE_URL, AUTH_SECRET: GOOD_SECRET, ...overrides };
}
function production(overrides: Record<string, string | undefined> = {}) {
  return source({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1", ...overrides });
}
function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}
function issuesOf(run: () => unknown): { variable: string; rule: string }[] {
  const error = caught(run);
  if (error === undefined) return [];
  if (error instanceof EnvValidationError) return [...error.issues];
  throw error;
}
/** Every text an error offers: message, stack, JSON, and the issues. */
function textOf(error: unknown): string {
  return [
    String(error),
    (error as Error).stack ?? "",
    JSON.stringify(error),
    JSON.stringify((error as EnvValidationError).issues ?? []),
  ].join("\n");
}
const WEAK = [{ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretWeak }];

/** Starts `loadEnvAtStartup` on a stubbed production process environment and returns its log. */
function startUpLog(overrides: Record<string, string>): { error: unknown; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
  const base: Record<string, string> = {
    NODE_ENV: "production",
    APP_URL,
    DATABASE_URL,
    AUTH_SECRET: GOOD_SECRET,
    TRUSTED_PROXY_HOPS: "0",
    TRUSTED_CLIENT_IP_HEADER: "",
    PAYMENT_TIMEOUT_MINUTES: "",
    LOG_LEVEL: "",
    DATABASE_URL_TEST: "",
    PGPASSWORD: "",
  };
  for (const variable of LIBRARY_VARIABLES) base[variable] = "";
  for (const [name, value] of Object.entries({ ...base, ...overrides })) vi.stubEnv(name, value);
  const error = caught(() => loadEnvAtStartup({ logger }));
  return { error, lines };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------------------------
// SEC-046

describe("SEC-046 re-check: every library variable is refused by name, for that reason only", () => {
  it("the export holds exactly the seven names", () => {
    expect([...AUTH_LIBRARY_VARIABLES].sort()).toEqual([...LIBRARY_VARIABLES].sort());
  });

  it("each of the seven, with any non-empty value, is refused by both readers in every NODE_ENV with exactly one issue: its name and the library-variable rule", () => {
    for (const variable of LIBRARY_VARIABLES) {
      for (const value of ["1", "true", "false", "0", `https://${CANARY}.example.test/collect`]) {
        for (const nodeEnv of ["development", "test", "production"]) {
          const env =
            nodeEnv === "production"
              ? production({ [variable]: value })
              : source({ NODE_ENV: nodeEnv, [variable]: value });
          const expected = [{ variable, rule: ENV_RULES.authLibraryVariable }];
          const label = `${variable}=${value} ${nodeEnv}`;
          for (const reader of [() => parseEnv(env), () => readAuthSecret(env)]) {
            const error = caught(reader);
            expect(error, label).toBeInstanceOf(EnvValidationError);
            expect((error as EnvValidationError).issues, label).toEqual(expected);
            expect(textOf(error), label).not.toContain(CANARY);
          }
        }
      }
      // Empty is "not set", as for every variable of env.ts.
      expect(
        issuesOf(() => parseEnv(production({ [variable]: "" }))),
        variable,
      ).toEqual([]);
      expect(
        issuesOf(() => readAuthSecret(production({ [variable]: "" }))),
        variable,
      ).toEqual([]);
    }
  });

  it("all seven at once: seven issues in the order of the list, and the start-up log line names them without any value", () => {
    const all = Object.fromEntries(
      LIBRARY_VARIABLES.map((variable) => [variable, `${CANARY}-${variable.toLowerCase()}`]),
    );
    const expected = LIBRARY_VARIABLES.map((variable) => ({
      variable,
      rule: ENV_RULES.authLibraryVariable,
    }));
    expect(issuesOf(() => parseEnv(production(all)))).toEqual(expected);
    expect(issuesOf(() => readAuthSecret(production(all)))).toEqual(expected);

    const { error, lines } = startUpLog(all);
    expect(error).toBeInstanceOf(EnvValidationError);
    expect(textOf(error)).not.toContain(CANARY);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? "";
    for (const variable of LIBRARY_VARIABLES) expect(line).toContain(`"variable":"${variable}"`);
    expect(line).not.toContain(CANARY);
    expect(line.toLowerCase()).not.toContain("canary");
  });

  it("the auth instance reads the secret through readAuthSecret before the library is created, so a refused variable stops the library (and its telemetry) from starting", () => {
    const text = readFileSync(join(ROOT, "src/server/auth/auth.ts"), "utf8");
    expect(text).toMatch(/instance\s*=\s*createAuth\(\{\s*secret:\s*readAuthSecret\(\)/);
    expect(text).toContain("telemetry: { enabled: false }");
  });

  it("the list is complete for the installed library: every BETTER_AUTH_ name in better-auth, @better-auth/core, and @better-auth/telemetry is refused or known inert", () => {
    const betterAuth = realpathSync(join(ROOT, "node_modules/better-auth"));
    const roots = [
      betterAuth,
      realpathSync(join(betterAuth, "..", "@better-auth", "core")),
      realpathSync(join(betterAuth, "..", "@better-auth", "telemetry")),
    ];
    const version = (dir: string) =>
      (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
    // A library update must re-list the names (SEC-046 remediation); this pin makes it fail here.
    expect(roots.map(version)).toEqual(["1.7.7", "1.7.7", "1.7.7"]);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(mjs|cjs|js)$/.test(name)) files.push(full);
      }
    };
    for (const dir of roots) {
      expect(existsSync(join(dir, "dist")), dir).toBe(true);
      walk(join(dir, "dist"));
    }
    const found = new Set<string>();
    let telemetryIdUses = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\b[A-Z_]*BETTER_AUTH_[A-Z_]+\b/g)) found.add(match[0]);
      if (!file.includes("env-impl")) {
        telemetryIdUses += text.split("BETTER_AUTH_TELEMETRY_ID").length - 1;
      }
    }
    // Inert: the three framework URL names lose to the explicit `baseURL` (SEC-045 re-check);
    // BETTER_AUTH_TELEMETRY_ID is a getter of @better-auth/core that nothing reads (asserted).
    const inert = [
      "BETTER_AUTH_TELEMETRY_ID",
      "NEXT_PUBLIC_BETTER_AUTH_URL",
      "NUXT_PUBLIC_BETTER_AUTH_URL",
      "PUBLIC_BETTER_AUTH_URL",
    ];
    expect([...found].sort()).toEqual([...LIBRARY_VARIABLES, ...inert].sort());
    expect(telemetryIdUses).toBe(0);
    // 60 s: walks the library's dist folders; the 5 s default timed out under a full parallel run
    // (sixty-fourth session). Assertions unchanged.
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// SEC-047

/** Random-looking filler written out (not generated), so a case fails the same way every run. */
const FILLER = "Kd2Xw9Lm4Rt6Pn3b";

describe("SEC-047 re-check: bypass attempts against the strengthened floor", () => {
  it("one character added, case changed, or a published value altered: refused by both readers", () => {
    for (const weak of [
      // published values: case, added characters, inside a longer value, altered digits
      LIBRARY_DEFAULT_SECRET.toUpperCase(),
      "bEtTeR-aUtH-sEcReT-12345678901234567890",
      `X${LIBRARY_DEFAULT_SECRET}`,
      `${FILLER}${LIBRARY_DEFAULT_SECRET}${FILLER}`,
      "better-auth-secret-1234567890X1234567890",
      "better_auth_secret_12345678901234567890",
      "better-auth-secret-1234567x901234567890",
      "09876543210987654321-terces-htua-retteb",
      INTEGRATION_SECRET.toUpperCase(),
      `${INTEGRATION_SECRET}!`,
      // repetition with one change
      `${"password".repeat(4)}1`,
      `1${"password".repeat(4)}`,
      `${"Password".repeat(2)}X${"Password".repeat(2)}`,
      "PasswordPASSWORDpasswordPassWord",
      `${FILLER}${FILLER}X`,
      `${FILLER}a${FILLER}`, // the same 16 characters twice, one character between
      // runs with a constant step anywhere in an otherwise random value
      `${FILLER}abcdefgh${FILLER}`,
      `${FILLER}HGFEDCBA${FILLER}`,
      `${FILLER}acegikmo${FILLER}`, // step 2
      `${FILLER}zzzzzzzz${FILLER}`, // step 0
      `${FILLER}!"#$%&'(${FILLER}`, // step 1 through punctuation
      // characters outside printable ASCII in an otherwise random value
      `${FILLER} ${FILLER}`,
      `${FILLER}${cp(0x09)}${FILLER}`,
      `${FILLER}${cp(0x7f)}${FILLER}`,
      `${FILLER}${cp(0xa0)}${FILLER}`,
      `${FILLER}${cp(0x200b)}${FILLER}`,
      `${FILLER}${cp(0xfeff)}${FILLER}`,
      `${FILLER}${cp(0xff41)}${FILLER}`, // fullwidth a
      `${FILLER}${cp(0x0430)}${FILLER}`, // Cyrillic a
      `${FILLER}${cp(0x1f600)}${FILLER}`,
      `${FILLER}${cp(0xd800)}${FILLER}`, // lone surrogate
    ]) {
      for (const reader of [
        () => parseEnv(production({ AUTH_SECRET: weak })),
        () => readAuthSecret(production({ AUTH_SECRET: weak })),
      ]) {
        expect(issuesOf(reader), JSON.stringify(weak)).toEqual(WEAK);
      }
    }
  });

  it("the placeholder rule still wins over the weak rule: one issue per value", () => {
    const value = `local_dev_only_not_a_secret${cp(0xa0)}${"a".repeat(10)}`;
    expect(issuesOf(() => parseEnv(production({ AUTH_SECRET: value })))).toEqual([
      { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder },
    ]);
  });

  it("the weak rule is production only: development and test accept every shape above", () => {
    for (const nodeEnv of ["development", "test"]) {
      for (const value of [LIBRARY_DEFAULT_SECRET.toUpperCase(), `${FILLER}${cp(0xa0)}${FILLER}`]) {
        expect(readAuthSecret(source({ NODE_ENV: nodeEnv, AUTH_SECRET: value }))).toBe(value);
      }
    }
  });

  it("random values of the documented and common generation commands are accepted (at most 2 refusals in 20,000 per form)", () => {
    // Measured in this re-check on 1,000,000 values each: 0 refused for `openssl rand -hex 32`,
    // `openssl rand -base64 32`, base64url of 32 bytes, upper-case hex of 32 bytes, and base64 of
    // 24 bytes; 1 for `openssl rand -hex 16` (a run "12345678"). At those rates more than 2 in
    // 20,000 has a probability below 1e-6.
    const forms: Record<string, () => string> = {
      "openssl rand -hex 32": () => randomBytes(32).toString("hex"),
      "openssl rand -base64 32": () => randomBytes(32).toString("base64"),
      "base64url of 32 bytes": () => randomBytes(32).toString("base64url"),
      "openssl rand -hex 16": () => randomBytes(16).toString("hex"),
      "hex of 32 bytes, upper case": () => randomBytes(32).toString("hex").toUpperCase(),
    };
    for (const [form, generate] of Object.entries(forms)) {
      let refused = 0;
      for (let i = 0; i < 20_000; i += 1) {
        const value = generate();
        const issues = issuesOf(() => readAuthSecret(production({ AUTH_SECRET: value })));
        if (issues.length > 0) {
          expect(issues, form).toEqual(WEAK);
          refused += 1;
        }
      }
      expect(refused, form).toBeLessThanOrEqual(2);
    }
    // 60 s: 100,000 secrets take about 2 s alone; the 5 s default timed out under a full
    // parallel run (sixty-fourth session). Assertions and counts unchanged.
  }, 60_000);

  it("the fixtures the commit introduced are accepted in production, and the old one is refused", () => {
    for (const value of [
      "Zq7canary-auth-secret-Kd2Xw9Lm4Rt6Pn3b",
      GOOD_SECRET,
      `${FILLER}${FILLER.split("").reverse().join("")}`,
    ]) {
      expect(readAuthSecret(production({ AUTH_SECRET: value })), value).toBe(value);
    }
    expect(
      issuesOf(() =>
        readAuthSecret(production({ AUTH_SECRET: "Zq7canary-auth-secret-0123456789abcdef" })),
      ),
    ).toEqual(WEAK);
  });
});

/** A second filler with no character run in common with FILLER, so FILLER + FILLER_2 has no pattern. */
const FILLER_2 = "Yc5Hj8Vz7Qs1Gf0U";

describe("SEC-047 re-check: each rule refuses on its own (no other rule masks it)", () => {
  // In the cases above most values hold FILLER twice, so the repeated-window rule refuses them
  // whatever the other rules do; a copy of env.ts without the printable-ASCII rule, the distinct
  // count, or step 0 passed them. Each value here trips one rule only (checked by hand against
  // the four rules). Not testable by any value: `isRepetition` (a periodic value of 32 or more
  // characters always repeats an 8-character window) and the substring and case parts of the
  // published-value rule (both listed values hold a run of 8 digits in steps of 1).
  it("the control: FILLER + FILLER_2 is accepted in production", () => {
    const value = `${FILLER}${FILLER_2}`;
    expect(readAuthSecret(production({ AUTH_SECRET: value }))).toBe(value);
  });

  it("printable ASCII only: one blank, control, invisible, or look-alike code point between two different fillers is refused", () => {
    for (const code of [0x20, 0x09, 0x7f, 0xa0, 0x200b, 0xfeff, 0xff41, 0x0430, 0x1f600, 0xd800]) {
      const value = `${FILLER}${cp(code)}${FILLER_2}`;
      for (const reader of [
        () => parseEnv(production({ AUTH_SECRET: value })),
        () => readAuthSecret(production({ AUTH_SECRET: value })),
      ]) {
        expect(issuesOf(reader), String(code)).toEqual(WEAK);
      }
    }
  });

  it("step 0: eight equal characters between two different fillers are refused", () => {
    const value = `${FILLER}zzzzzzzz${FILLER_2}`;
    expect(issuesOf(() => readAuthSecret(production({ AUTH_SECRET: value })))).toEqual(WEAK);
    expect(issuesOf(() => parseEnv(production({ AUTH_SECRET: value })))).toEqual(WEAK);
  });

  it("fewer than 8 distinct: 32 characters over 7 symbols, with no repeated window and no run, are refused", () => {
    const value = "dwdw92XLXL9XLXd2dd9dKKLKXLLwX29K";
    expect(new Set(value).size).toBe(7);
    expect(issuesOf(() => readAuthSecret(production({ AUTH_SECRET: value })))).toEqual(WEAK);
    expect(issuesOf(() => parseEnv(production({ AUTH_SECRET: value })))).toEqual(WEAK);
  });
});

describe("SEC-047 re-check: no part of a refused secret reaches an error or the start-up log", () => {
  const shapes: [string, string][] = [
    ["non-ASCII", `${CANARY}${cp(0xa0)}${FILLER}${FILLER}`],
    ["repeated window", `${CANARY}${FILLER}x${FILLER}`],
    ["constant step", `${CANARY}${FILLER}abcdefgh${FILLER}`],
    ["published inside", `${CANARY}${LIBRARY_DEFAULT_SECRET.toUpperCase()}`],
    ["one character repeated", `${CANARY}${"Z".repeat(30)}`],
  ];

  it("each refusal carries the fixed rule only, in parseEnv, readAuthSecret, and the start-up log line", () => {
    for (const [label, value] of shapes) {
      for (const reader of [
        () => parseEnv(production({ AUTH_SECRET: value })),
        () => readAuthSecret(production({ AUTH_SECRET: value })),
      ]) {
        const error = caught(reader);
        expect(error, label).toBeInstanceOf(EnvValidationError);
        expect((error as EnvValidationError).issues, label).toEqual(WEAK);
        expect(textOf(error), label).not.toContain(CANARY);
        expect(textOf(error), label).not.toContain(FILLER);
      }
      const { error, lines } = startUpLog({ AUTH_SECRET: value });
      expect(error, label).toBeInstanceOf(EnvValidationError);
      expect(lines, label).toHaveLength(1);
      expect(lines[0], label).toContain(ENV_RULES.authSecretWeak);
      expect(lines[0], label).not.toContain(CANARY);
      expect(lines[0], label).not.toContain(FILLER);
      vi.unstubAllEnvs();
    }
  });

  it("no rule text holds a character of a value: every rule is one of the constants", () => {
    const rules = new Set(Object.values(ENV_RULES));
    for (const [, value] of shapes) {
      for (const issue of issuesOf(() => parseEnv(production({ AUTH_SECRET: value })))) {
        expect(rules.has(issue.rule as never)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-049

describe("SEC-049 the pattern floor misses periodic values with a counter, interleaved runs, and lag patterns", () => {
  it("production refuses plainly patterned values that the four SEC-047 rules let through", () => {
    for (const weak of [
      "secret1secret2secret3secret4secret5", // a 7-character word with a counter
      "abcdefg!abcdefg@abcdefg#abcdefg$", // a 7-character run with changing separators
      "aBcDeFgHiJkLmNoPqRsTuVwXyZ012345", // the alphabet in alternating case
      "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6", // two interleaved sequences
      "acdfgijlmoprsuvxyACDFGIJLMOPRSUVX", // steps of 1 and 2 alternating
      "000102030405060708090a0b0c0d0e0f", // counting in hexadecimal
    ]) {
      expect(
        issuesOf(() => parseEnv(production({ AUTH_SECRET: weak }))),
        JSON.stringify(weak),
      ).toEqual(WEAK);
    }
  });
});
