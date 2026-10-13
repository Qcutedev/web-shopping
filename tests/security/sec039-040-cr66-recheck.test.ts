/**
 * Re-check of SEC-039 and SEC-040 (fix 6cec19c, register 3e62ab8) and of the start-up validation
 * of AUTH_SECRET (CR-66, commit a561503). Owner: security. Review:
 * docs/reviews/SEC-039-040-recheck.md. Pure: no database, no network, no server.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape: every code
 * point is a number given to `String.fromCodePoint`, because the agents' file-writing tool turns
 * an escape into the character itself (SEC-040).
 *
 * A case written `it.fails` states the secure behaviour of an open finding (SEC-041 to SEC-045):
 * it is reported as an expected failure while the flaw exists and turns red when the code is
 * fixed; the fix then changes `it.fails` to `it` without touching the body.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NAME_ALLOWED_TEXT, signUpBodySchema } from "@/modules/auth/schema";
import {
  AUTH_SECRET_MIN_LENGTH,
  ENV_RULES,
  EnvValidationError,
  parseEnv,
  readAuthSecret,
} from "@/server/env";
import { errorResponse } from "@/server/http";
import { createLogger } from "@/server/logger";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const nameSchema = signUpBodySchema.shape.name;
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const accepted = (name: string): boolean => nameSchema.safeParse(name).success;
const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

/** The five invisible characters the rule keeps on purpose (SEC-033 owner decision; emoji). */
const KEPT = [0x200b, 0x200c, 0x200d, 0xfe0e, 0xfe0f] as const;

function scalarsWith(property: RegExp): number[] {
  const found: number[] = [];
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (property.test(cp(code))) found.push(code);
  }
  return found;
}

describe("SEC-039 re-check: the fix holds", () => {
  it("the only Cf, Cn, Co, or Default_Ignorable code points accepted anywhere are the five kept ones", () => {
    const kept = new Set<number>(KEPT);
    const passed: string[] = [];
    const candidates = scalarsWith(/^[\p{Cf}\p{Cn}\p{Co}\p{Default_Ignorable_Code_Point}]$/u);
    // Every candidate at the end, after a letter; every 61st also at the start and in the middle
    // (the full cross product is three million regex runs).
    candidates.forEach((code, index) => {
      if (kept.has(code)) return;
      const char = cp(code);
      const names = index % 61 === 0 ? [`A${char}`, `${char}A`, `A${char}A`] : [`A${char}`];
      for (const name of names) if (NAME_ALLOWED_TEXT.test(name)) passed.push(hex(code));
    });
    expect(candidates.length).toBeGreaterThan(900_000);
    expect(passed).toEqual([]);
    for (const code of KEPT) expect(NAME_ALLOWED_TEXT.test(`A${cp(code)}`), hex(code)).toBe(true);
  });

  it("no blank-looking character makes a name alone, twice, or wrapped in the kept characters", () => {
    for (const code of [0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0x1d159, 0x3000, 0x00a0]) {
      for (const name of [
        cp(code),
        cp(code, code),
        cp(0x200b, code, 0x200c),
        cp(code, 0xfe0f),
        cp(0xfe0e, code, 0x200d),
      ]) {
        expect(accepted(name), `${hex(code)} ${JSON.stringify(name)}`).toBe(false);
      }
    }
    // The kept characters alone or together are never a name.
    expect(accepted(cp(...KEPT))).toBe(false);
    expect(accepted(cp(0xfe0f).repeat(50))).toBe(false);
  });

  it("no accepted single character turns into a refused one under NFC, NFD, NFKC, or NFKD", () => {
    // A later consumer that normalises a stored name must not produce a forbidden character.
    const forbidden = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cn}\p{Co}\p{Default_Ignorable_Code_Point}]/u;
    const kept = new Set<number>(KEPT);
    const produced: string[] = [];
    for (let code = 0x20; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = cp(code);
      if (!NAME_ALLOWED_TEXT.test(`A${char}`)) continue;
      for (const form of ["NFC", "NFD", "NFKC", "NFKD"] as const) {
        for (const out of char.normalize(form)) {
          const outCode = out.codePointAt(0) ?? 0;
          if (forbidden.test(out) && !kept.has(outCode)) produced.push(`${hex(code)} ${form}`);
        }
      }
    }
    expect(produced).toEqual([]);
  });

  it("legitimate names stay accepted: Thai with marks and U+200B, emoji with U+FE0F, keycaps, ZWJ families, flags", () => {
    for (const name of [
      cp(0x0e2a, 0x0e21, 0x0e0a, 0x0e32, 0x0e22, 0x20, 0x0e43, 0x0e08, 0x0e14, 0x0e35),
      cp(0x0e23, 0x0e49, 0x0e32, 0x0e19, 0x200b, 0x0e04, 0x0e49, 0x0e32),
      cp(0x0e01, 0x0e34, 0x0e4a, 0x0e1f),
      cp(0x2764, 0xfe0f),
      cp(0x263a, 0xfe0e),
      cp(0x31, 0xfe0f, 0x20e3),
      cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
      cp(0x1f1f9, 0x1f1ed),
      cp(0x845b, 0x6c34),
    ]) {
      expect(accepted(name), JSON.stringify(name)).toBe(true);
    }
  });

  it("the pattern keeps the u flag and the anchors, and the bootstrap name uses the same schema", () => {
    expect(NAME_ALLOWED_TEXT.flags).toContain("u");
    expect(NAME_ALLOWED_TEXT.source.startsWith("^")).toBe(true);
    expect(NAME_ALLOWED_TEXT.source.endsWith("$")).toBe(true);
    const bootstrap = readFileSync(join(ROOT, "src/modules/auth/bootstrap-admin.ts"), "utf8");
    expect(bootstrap).toContain("signUpBodySchema");
  });
});

describe("SEC-040 re-check: the rule's source holds only printable ASCII", () => {
  it("src/modules/auth/schema.ts has no byte above 0x7E and no control byte but LF and CR", () => {
    const bytes = readFileSync(join(ROOT, "src/modules/auth/schema.ts"));
    const bad: number[] = [];
    bytes.forEach((byte, offset) => {
      if (byte > 0x7e || (byte < 0x20 && byte !== 0x0a && byte !== 0x0d)) bad.push(offset);
    });
    expect(bad).toEqual([]);
  });

  it("the regex source spells every exception as an escape", () => {
    // What the reviewer reads in the file: the exception class and the blank list as escapes.
    const text = readFileSync(join(ROOT, "src/modules/auth/schema.ts"), "utf8");
    const backslash = String.fromCharCode(0x5c);
    expect(text).toContain(
      `(?![${backslash}u200B-${backslash}u200D${backslash}uFE0E${backslash}uFE0F])`,
    );
    expect(text).toContain(`${backslash}u{1D159}`);
  });
});

/** Literal characters a reader cannot see, or sees as a plain space. */
function isInvisible(code: number): boolean {
  if (
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
    (code >= 0x7f && code <= 0x9f)
  ) {
    return true;
  }
  if (
    [
      0x00a0, 0x1680, 0x202f, 0x205f, 0x3000, 0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0x1d159,
    ].includes(code)
  ) {
    return true;
  }
  if (code >= 0x2000 && code <= 0x200a) return true;
  return /^[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}]$/u.test(cp(code));
}

function invisibleInRepository(): string[] {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const found: string[] = [];
  for (const path of listed.split("\n").filter(Boolean)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(ROOT, path));
    } catch {
      continue; // listed but deleted in the working tree
    }
    if (bytes.includes(0)) continue; // binary
    bytes
      .toString("utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const char of line) {
          const code = char.codePointAt(0) ?? 0;
          if (code > 0x7e && isInvisible(code))
            found.push(`${path}:${String(index + 1)} ${hex(code)}`);
          else if (code < 0x20 && isInvisible(code))
            found.push(`${path}:${String(index + 1)} ${hex(code)}`);
        }
      });
  }
  return found;
}

describe("SEC-043 literal invisible characters remain in test files outside tests/security", () => {
  it("no tracked or untracked text file of the repository holds one", () => {
    expect(invisibleInRepository()).toEqual([]);
  });
});

describe("SEC-041 the kept invisible characters are accepted anywhere and in any number", () => {
  it.fails("a variation selector is refused after a character that has no emoji form", () => {
    expect(accepted(`Admin${cp(0xfe0f)}`)).toBe(false);
    expect(accepted(`Ad${cp(0xfe0e)}min`)).toBe(false);
  });

  it.fails(
    "a run of kept invisible characters is refused (hidden data, invisible duplicates)",
    () => {
      // 95 invisible characters from a five-symbol alphabet: about 220 hidden bits after "Admin".
      const hidden = Array.from({ length: 95 }, (_, i) => KEPT[(i * 7) % 5] ?? 0x200b);
      expect(accepted(`Admin${cp(...hidden)}`)).toBe(false);
      expect(accepted(`Admin${cp(0x200b, 0x200b)}`)).toBe(false);
    },
  );
});

describe("SEC-042 combining marks stack on one base without limit", () => {
  it.fails("more than four combining marks on one base character are refused", () => {
    expect(accepted(`A${cp(0x0301).repeat(95)}`)).toBe(false);
    expect(accepted(`Admin${cp(0x0336).repeat(90)}`)).toBe(false);
    expect(accepted(`A${cp(0x0301, 0x0302, 0x0303, 0x0304, 0x0306)}`)).toBe(false);
  });

  it("Thai with a vowel and a tone mark on one consonant stays accepted", () => {
    expect(accepted(cp(0x0e19, 0x0e49, 0x0e33))).toBe(true);
    expect(accepted(cp(0x0e01, 0x0e34, 0x0e4a, 0x0e1f))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// CR-66: AUTH_SECRET at start-up.

const CANARY = "Zq7SECRETcanary";
const GOOD_SECRET = `${CANARY}-a8f3k2m9q1w7e5r0t6y4u2i8o3p1`;
const APP_URL = "https://shop.example.test";
const DATABASE_URL = "postgresql://shop:Zq7dbPw@db.example.test:5432/shop?schema=public";

function source(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
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
function everyRendering(error: unknown): string {
  const e = error as Error;
  return [String(e), e.message, e.stack ?? "", JSON.stringify(e), inspect(e, { depth: 5 })].join(
    "\n",
  );
}

function envExampleSecret(): string {
  const text = readFileSync(join(ROOT, ".env.example"), "utf8");
  const match = /^AUTH_SECRET="([^"]*)"/m.exec(text);
  if (match?.[1] === undefined) throw new Error("AUTH_SECRET not found in .env.example");
  return match[1];
}

describe("CR-66 re-check: AUTH_SECRET is refused when missing, short, or the published placeholder", () => {
  it("missing or empty is refused in every NODE_ENV, by parseEnv and readAuthSecret alike", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      for (const value of [undefined, ""]) {
        const env =
          nodeEnv === "production"
            ? production({ AUTH_SECRET: value })
            : source({ NODE_ENV: nodeEnv, AUTH_SECRET: value });
        expect(issuesOf(() => parseEnv(env))).toEqual([
          { variable: "AUTH_SECRET", rule: ENV_RULES.required },
        ]);
        expect(issuesOf(() => readAuthSecret(env))).toEqual([
          { variable: "AUTH_SECRET", rule: ENV_RULES.required },
        ]);
      }
    }
  });

  it("31 UTF-16 units are refused and 32 accepted, in parseEnv and readAuthSecret alike", () => {
    expect(AUTH_SECRET_MIN_LENGTH).toBe(32);
    const short = `${CANARY}${"k".repeat(31 - CANARY.length)}`;
    expect(short).toHaveLength(31);
    for (const env of [source({ AUTH_SECRET: short }), production({ AUTH_SECRET: short })]) {
      expect(issuesOf(() => parseEnv(env))).toEqual([
        { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretTooShort },
      ]);
      expect(issuesOf(() => readAuthSecret(env))).toEqual([
        { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretTooShort },
      ]);
    }
    const exact = `${short}k`;
    expect(parseEnv(production({ AUTH_SECRET: exact })).authSecret).toBe(exact);
  });

  it("the exact value of .env.example is refused in production by both readers and accepted outside it", () => {
    const placeholder = envExampleSecret();
    expect(placeholder.length).toBeGreaterThanOrEqual(32);
    const rule = [{ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder }];
    expect(issuesOf(() => parseEnv(production({ AUTH_SECRET: placeholder })))).toEqual(rule);
    expect(issuesOf(() => readAuthSecret(production({ AUTH_SECRET: placeholder })))).toEqual(rule);
    expect(parseEnv(source({ AUTH_SECRET: placeholder })).authSecret).toBe(placeholder);
  });

  it("no refusal, of AUTH_SECRET or of another variable, carries the secret in any rendering of the error", () => {
    const cases: Record<string, string | undefined>[] = [
      source({ AUTH_SECRET: `${CANARY}-short` }),
      production({ AUTH_SECRET: `${CANARY}-not_a_secret-0123456789abcdef` }),
      source({ APP_URL: "not a url" }),
      production({ TRUSTED_PROXY_HOPS: undefined }),
      production({ DATABASE_URL: "postgresql://u:local_dev_only_not_a_secret@h:5432/d" }),
    ];
    for (const env of cases) {
      for (const reader of [() => parseEnv(env), () => readAuthSecret(env)]) {
        try {
          reader();
        } catch (error) {
          expect(error).toBeInstanceOf(EnvValidationError);
          expect(everyRendering(error)).not.toContain(CANARY);
          expect((error as Error).cause).toBeUndefined();
        }
      }
    }
  });

  it("loadEnvAtStartup logs one line with no secret and throws; the logged env object is redacted", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_URL", APP_URL);
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("AUTH_SECRET", `${CANARY}-short`);
    vi.resetModules();
    const fresh = await import("@/server/env");
    expect(() => fresh.loadEnvAtStartup({ logger })).toThrow(fresh.EnvValidationError);
    expect(lines).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(CANARY);

    // A careless `logger.info("env", { env })` must not print the secret or the database password.
    const env = parseEnv(source());
    logger.info("configuration", { env });
    expect(lines.join("\n")).not.toContain(CANARY);
    expect(lines.join("\n")).not.toContain("Zq7dbPw");
  });
});

describe("SEC-044 a low-entropy or published AUTH_SECRET of 32 characters starts a production server", () => {
  it.fails(
    "production refuses a secret of one repeated character, of blanks, or one published in this repository or the library",
    () => {
      for (const weak of [
        "x".repeat(32),
        " ".repeat(32),
        "better-auth-secret-12345678901234567890", // the library's own default (DEFAULT_SECRET)
        "integration-test-secret-0123456789-abcdefghij", // tests/integration/auth/support.ts
      ]) {
        expect(
          issuesOf(() => parseEnv(production({ AUTH_SECRET: weak }))),
          JSON.stringify(weak),
        ).not.toEqual([]);
      }
    },
  );
});

describe("SEC-045 BETTER_AUTH_SECRETS in the environment replaces the validated AUTH_SECRET", () => {
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

  it("without BETTER_AUTH_SECRETS the library signs with the validated secret (control)", async () => {
    vi.stubEnv("BETTER_AUTH_SECRETS", undefined);
    const auth = await freshAuth();
    expect((await auth.$context).secret).toBe(GOOD_SECRET);
  });

  it.fails(
    "a one-character BETTER_AUTH_SECRETS entry does not become the signing secret",
    async () => {
      vi.stubEnv("BETTER_AUTH_SECRETS", "1:x");
      const auth = await freshAuth();
      expect((await auth.$context).secret).toBe(GOOD_SECRET);
    },
  );

  it.fails("a malformed BETTER_AUTH_SECRETS entry does not reach the server log", async () => {
    vi.stubEnv("BETTER_AUTH_SECRETS", `${CANARY}-rotated-secret-without-version`);
    const auth = await freshAuth();
    let thrown: unknown;
    try {
      await auth.$context;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    // What a route handler does with an unexpected library error (routes.ts mapLibraryError
    // passes it through unchanged; errorResponse logs it as the cause of a 500).
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const response = errorResponse(thrown, { requestId: "r-1", logger });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(CANARY);
    expect(lines.join("\n")).not.toContain(CANARY);
  });
});
