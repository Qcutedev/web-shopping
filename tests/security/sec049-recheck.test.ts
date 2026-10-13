/**
 * Re-check of SEC-049 (commit 51c1dda: the lag rule and the published-prefix rule of
 * `isWeakAuthSecret` in src/server/env.ts). Owner: security. Review:
 * docs/reviews/SEC-049-recheck.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040,
 * SEC-043).
 *
 * A case written `it.fails` states the secure behaviour of an open finding: it is reported as an
 * expected failure while the flaw exists and turns red when the code is fixed; the fix then
 * changes `it.fails` to `it` without touching the body. SEC-051 is fixed; its case is an `it`.
 *
 * Pure: no database, no network. One case reads src/server/auth/auth.ts.
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ENV_RULES,
  EnvValidationError,
  loadEnvAtStartup,
  parseEnv,
  readAuthSecret,
} from "@/server/env";
import { createLogger } from "@/server/logger";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const CANARY = "Zq7SECRETcanary";
const GOOD_SECRET = `${CANARY}-a8f3k2m9q1w7e5r0t6y4u2i8o3p1`;
const APP_URL = "https://shop.example.test";
const DATABASE_URL = "postgresql://shop:Zq7dbPw@db.example.test:5432/shop?schema=public";
/** Random-looking filler written out, so a case behaves the same on every run. */
const FILLER = "Kd2Xw9Lm4Rt6Pn3b";

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
function textOf(error: unknown): string {
  return [
    String(error),
    (error as Error).stack ?? "",
    JSON.stringify(error),
    JSON.stringify((error as EnvValidationError).issues ?? []),
  ].join("\n");
}
const capitalise = (word: string) => `${word[0]?.toUpperCase()}${word.slice(1)}`;
const WEAK = [{ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretWeak }];
const PLACEHOLDER = [{ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder }];

/** Both readers, production. */
function bothReaders(value: string): { variable: string; rule: string }[][] {
  return [
    issuesOf(() => parseEnv(production({ AUTH_SECRET: value }))),
    issuesOf(() => readAuthSecret(production({ AUTH_SECRET: value }))),
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SEC-049 re-check: the lag rule, at its edges", () => {
  // Each value below trips the lag rule only (checked with an instrumented copy of env.ts in the
  // review): no other rule refuses it, so a copy without the lag rule, with a smaller largest lag,
  // with a larger share, or with `>` for `>=` accepts it.
  it("lag 1 alone: 16 neighbour pairs one code point apart in 32 characters (16 of 31 positions) are refused", () => {
    const value = "KLqr34GHwxMNbc56TUjkPQef12YZmnDE";
    expect(value).toHaveLength(32);
    for (const issues of bothReaders(value)) expect(issues).toEqual(WEAK);
  });

  it("the share is 'at least half': 16 of 32 positions are refused, 15 of 32 are accepted", () => {
    const atHalf = "KLqr34GHwxMNbc56TUjkPQef12YZmnDE!";
    const belowHalf = "KLqr39GHwxMNbc56TUjkPQef12YZmnDE!";
    for (const issues of bothReaders(atHalf)) expect(issues).toEqual(WEAK);
    for (const issues of bothReaders(belowHalf)) expect(issues).toEqual([]);
  });

  it("lag 8 alone: a 7-character random-looking unit with a counter is refused", () => {
    for (const value of [
      "Kd2Xw9L1Kd2Xw9L2Kd2Xw9L3Kd2Xw9L4",
      "Kd2Xw9L1Kd2Xw9L2Kd2Xw9L3Kd2Xw9L4Kd2Xw9L5",
    ]) {
      for (const issues of bothReaders(value)) expect(issues, value).toEqual(WEAK);
    }
  });

  it("counting in hexadecimal sits exactly on the share (15 of 30 at lag 2) and is refused", () => {
    for (const issues of bothReaders("000102030405060708090a0b0c0d0e0f")) {
      expect(issues).toEqual(WEAK);
    }
  });
});

describe("SEC-049 re-check: the prefix rule", () => {
  it("each prefix, in any case, followed by a random tail, is refused; the same tail without the prefix is accepted", () => {
    const tail = `${FILLER}Yc5Hj8Vz`;
    expect(readAuthSecret(production({ AUTH_SECRET: `x-${tail}-q7Lw2Np9Ks` }))).toBe(
      `x-${tail}-q7Lw2Np9Ks`,
    );
    for (const prefix of ["better-auth-secret", "integration-test-secret"]) {
      for (const spelled of [
        prefix,
        prefix.toUpperCase(),
        `${prefix[0]?.toUpperCase()}${prefix.slice(1)}`,
      ]) {
        for (const separator of ["", "-", ":", "_"]) {
          const value = `${spelled}${separator}${tail}`;
          for (const issues of bothReaders(value)) expect(issues, value).toEqual(WEAK);
        }
      }
    }
  });
});

describe("SEC-049 re-check: order, gating, and output", () => {
  it("the placeholder rule still wins: a value that is placeholder, prefixed, and lag-patterned gives one placeholder issue", () => {
    for (const value of [
      "better-auth-secret-not_a_secret-Kd2Xw9Lm4Rt6",
      "not_a_secret1not_a_secret2not_a_secret3",
      "Kd2Xw9L1Kd2Xw9L2not_a_secretKd2Xw9L3Kd2Xw9L4",
    ]) {
      for (const issues of bothReaders(value)) expect(issues, value).toEqual(PLACEHOLDER);
    }
  });

  it("a value under 32 characters gives only the length issue, never the weak issue", () => {
    for (const value of ["better-auth-secret-0", "a1b2c3d4e5f6g7h8i9j0"]) {
      for (const issues of bothReaders(value)) {
        expect(issues, value).toEqual([
          { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretTooShort },
        ]);
      }
    }
  });

  it("development and test accept every SEC-049 shape, in both readers", () => {
    const shapes = [
      "secret1secret2secret3secret4secret5",
      "Kd2Xw9L1Kd2Xw9L2Kd2Xw9L3Kd2Xw9L4",
      "KLqr34GHwxMNbc56TUjkPQef12YZmnDE",
      `better-auth-secret-${FILLER}`,
      `INTEGRATION-TEST-SECRET-${FILLER}`,
    ];
    for (const nodeEnv of ["development", "test"]) {
      for (const value of shapes) {
        expect(readAuthSecret(source({ NODE_ENV: nodeEnv, AUTH_SECRET: value })), value).toBe(
          value,
        );
        expect(parseEnv(source({ NODE_ENV: nodeEnv, AUTH_SECRET: value })).authSecret, value).toBe(
          value,
        );
      }
    }
  });

  it("a NODE_ENV that is not exactly 'production' cannot slip a weak secret past the running server: parseEnv refuses the spelling, and getAuth calls getEnv before readAuthSecret", () => {
    // readAuthSecret looks at NODE_ENV as written and so accepts a weak value with 'Production'.
    // That reader is never the first one: the start-up hook runs parseEnv, and getAuth calls
    // getEnv() (parseEnv) before readAuthSecret(). Both orders are pinned here.
    const weak = "secret1secret2secret3secret4secret5";
    for (const nodeEnv of ["Production", "PRODUCTION", "production ", "prod"]) {
      expect(readAuthSecret(source({ NODE_ENV: nodeEnv, AUTH_SECRET: weak })), nodeEnv).toBe(weak);
      expect(
        issuesOf(() =>
          parseEnv(source({ NODE_ENV: nodeEnv, TRUSTED_PROXY_HOPS: "1", AUTH_SECRET: weak })),
        ),
        nodeEnv,
      ).toContainEqual({ variable: "NODE_ENV", rule: ENV_RULES.nodeEnv });
    }
    const text = readFileSync(join(ROOT, "src/server/auth/auth.ts"), "utf8");
    const getEnvAt = text.search(
      /const env = getEnv\(\);\s*instance\s*=\s*createAuth\(\{\s*secret:\s*readAuthSecret\(\)/,
    );
    expect(getEnvAt).toBeGreaterThan(0);
  });

  it("a patterned or prefix-refused value never reaches the error or the start-up log line", () => {
    for (const value of [
      `${CANARY}1${CANARY}2${CANARY}3`,
      `better-auth-secret-${CANARY}-${FILLER}`,
    ]) {
      const error = caught(() => parseEnv(production({ AUTH_SECRET: value })));
      expect(error, value).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues, value).toEqual(WEAK);
      expect(textOf(error), value).not.toContain(CANARY);

      const lines: string[] = [];
      const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
      for (const [name, v] of Object.entries({
        ...production({ AUTH_SECRET: value }),
        PAYMENT_TIMEOUT_MINUTES: "",
        LOG_LEVEL: "",
        TRUSTED_CLIENT_IP_HEADER: "",
        DATABASE_URL_TEST: "",
        PGPASSWORD: "",
        BETTER_AUTH_SECRET: "",
        BETTER_AUTH_SECRETS: "",
        BETTER_AUTH_URL: "",
        BETTER_AUTH_TRUSTED_ORIGINS: "",
        BETTER_AUTH_TELEMETRY: "",
        BETTER_AUTH_TELEMETRY_ENDPOINT: "",
        BETTER_AUTH_TELEMETRY_DEBUG: "",
      })) {
        vi.stubEnv(name, v ?? "");
      }
      expect(
        caught(() => loadEnvAtStartup({ logger })),
        value,
      ).toBeInstanceOf(EnvValidationError);
      expect(lines, value).toHaveLength(1);
      expect(lines[0], value).toContain(ENV_RULES.authSecretWeak);
      expect(lines[0], value).not.toContain(CANARY);
      vi.unstubAllEnvs();
    }
  });
});

describe("SEC-049 re-check: legitimate random values are not refused", () => {
  // Measured in the review with 1,000,000 values per form (results in the review file). Here a
  // smaller sample with a bound that a real regression would break and chance would not: every
  // form below had at most 1 refusal in 1,000,000. Two UUIDs with dashes (12 in 1,000,000, the
  // repeated-window rule) and 40 decimal digits (93 in 1,000,000, mostly the distinct-character
  // rule) are left out: older rules, not the lag rule, and too frequent for this bound.
  const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const PRINTABLE = Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
  const pick = (alphabet: string, n: number) =>
    Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join("");

  it("documented and common generator forms: at most 1 refusal in 5,000 per form", () => {
    const forms: Record<string, () => string> = {
      "openssl rand -hex 32": () => randomBytes(32).toString("hex"),
      "openssl rand -base64 32": () => randomBytes(32).toString("base64"),
      "base64url of 32 bytes": () => randomBytes(32).toString("base64url"),
      "openssl rand -hex 16": () => randomBytes(16).toString("hex"),
      "openssl rand -base64 48": () => randomBytes(48).toString("base64"),
      "UUIDv4 without dashes": () => randomUUID().replaceAll("-", ""),
      "password manager, 32 alphanumeric": () => pick(ALNUM, 32),
      "password manager, 32 printable": () => pick(PRINTABLE, 32),
    };
    for (const [form, generate] of Object.entries(forms)) {
      let refused = 0;
      for (let i = 0; i < 5_000; i += 1) {
        const issues = issuesOf(() => readAuthSecret(production({ AUTH_SECRET: generate() })));
        if (issues.length > 0) {
          expect(issues, form).toEqual(WEAK);
          refused += 1;
        }
      }
      expect(refused, form).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-051

describe("SEC-051 the published-prefix rule matches only the hyphenated spelling", () => {
  it("production refuses the published values with their separators changed and a few characters edited", () => {
    for (const weak of [
      // the integration secret with `_` for `-` and two characters changed: a guessable edit of a
      // published value; the hyphenated spelling of the same edit is refused by the prefix rule
      "integration_test_secret_0123X56789_abcdeXghij",
      "integration.test.secret.0123X56789.abcdeXghij",
      "IntegrationTestSecret0123X56789abcdeXghij",
      // the library default spelled without hyphens, its digits edited out of every 8-step run
      "BetterAuthSecret1234X678901X34567890",
      "better_auth_secret_1234X678901X34567890",
    ]) {
      expect(
        issuesOf(() => parseEnv(production({ AUTH_SECRET: weak }))),
        JSON.stringify(weak),
      ).toEqual(WEAK);
    }
  });

  it("every separator spelling of both prefixes is refused, in both readers", () => {
    const tail = `${FILLER}Yc5Hj8Vz`;
    for (const words of [
      ["better", "auth", "secret"],
      ["integration", "test", "secret"],
    ]) {
      for (const separator of ["", "-", "_", ".", " ", "--", "_-", "/", "+", "~"]) {
        const base = words.join(separator);
        for (const spelled of [base, base.toUpperCase(), words.map(capitalise).join(separator)]) {
          for (const value of [
            `${spelled}${tail}`,
            `${spelled}-${tail}`,
            `${separator}${spelled}${tail}`,
          ]) {
            // a blank is outside printable ASCII and is refused by an older rule: still refused
            for (const issues of bothReaders(value))
              expect(issues, JSON.stringify(value)).toEqual(WEAK);
          }
        }
      }
    }
  });

  it("random values are not refused by the squeezed-prefix rule: at most 1 refusal in 20,000 per form", () => {
    const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const PRINTABLE = Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
    const pick = (alphabet: string, n: number) =>
      Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join("");
    // Old rules refuse about 2 in 1,000,000 of these. A random value squeezes to one of the two
    // prefixes with a probability of about 36^-16, so any refusal here is another rule's. The
    // last form is the most exposed one: separators between letters are removed by the squeeze.
    const forms: Record<string, () => string> = {
      hex32: () => randomBytes(32).toString("hex"),
      base64: () => randomBytes(32).toString("base64"),
      base64url: () => randomBytes(32).toString("base64url"),
      alnum32: () => pick(ALNUM, 32),
      printable32: () => pick(PRINTABLE, 32),
      lettersAndSeparators: () => pick("abcdefghijklmnopqrstuvwxyz-_.", 32),
    };
    for (const [form, generate] of Object.entries(forms)) {
      let refused = 0;
      for (let i = 0; i < 20_000; i += 1) {
        const issues = issuesOf(() => readAuthSecret(production({ AUTH_SECRET: generate() })));
        if (issues.length > 0) refused += 1;
      }
      expect(refused, form).toBeLessThanOrEqual(1);
    }
  }, 30_000);
});
