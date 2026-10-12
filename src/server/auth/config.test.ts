import { describe, expect, it } from "vitest";

import { EnvValidationError } from "../env";
import {
  AUTH_SECRET_MIN_LENGTH,
  AUTH_SECRET_RULES,
  clipText,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  readAuthSecret,
  SESSION_LIFETIME_SECONDS,
  SESSION_PURGE_INTERVAL_MS,
} from "./config";

const GOOD = "Zq7canary-secret-0123456789abcdefghij";

function issuesOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.issues;
    throw error;
  }
  return undefined;
}

describe("readAuthSecret", () => {
  it("returns a secret of at least 32 characters", () => {
    expect(readAuthSecret({ AUTH_SECRET: GOOD })).toBe(GOOD);
    expect(readAuthSecret({ AUTH_SECRET: "x".repeat(AUTH_SECRET_MIN_LENGTH) })).toHaveLength(32);
  });

  it("refuses an absent or empty secret: there is no default", () => {
    for (const source of [{}, { AUTH_SECRET: "" }, { AUTH_SECRET: undefined }]) {
      expect(issuesOf(() => readAuthSecret(source))).toEqual([
        { variable: "AUTH_SECRET", rule: AUTH_SECRET_RULES.required },
      ]);
    }
  });

  it("refuses a short secret", () => {
    expect(issuesOf(() => readAuthSecret({ AUTH_SECRET: "x".repeat(31) }))).toEqual([
      { variable: "AUTH_SECRET", rule: AUTH_SECRET_RULES.tooShort },
    ]);
  });

  it("refuses a placeholder in production only", () => {
    const placeholder = "local_dev_only_not_a_secret_0123456789";
    expect(readAuthSecret({ AUTH_SECRET: placeholder, NODE_ENV: "development" })).toBe(placeholder);
    expect(
      issuesOf(() => readAuthSecret({ AUTH_SECRET: placeholder, NODE_ENV: "production" })),
    ).toEqual([{ variable: "AUTH_SECRET", rule: AUTH_SECRET_RULES.placeholder }]);
  });

  it("never puts the value into the error", () => {
    try {
      readAuthSecret({ AUTH_SECRET: "Zq7canary-short" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("Zq7canary");
      expect(JSON.stringify((error as EnvValidationError).issues)).not.toContain("Zq7canary");
    }
  });
});

describe("configured values", () => {
  it("are the ones docs/SECURITY.md lists", () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(604_800);
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    // SR-07 item 5: runs at most 12 hours apart.
    expect(SESSION_PURGE_INTERVAL_MS).toBeLessThanOrEqual(12 * 60 * 60 * 1_000);
  });
});

describe("clipText", () => {
  it("keeps short text, cuts long text, and gives null for nothing", () => {
    expect(clipText("abc", 5)).toBe("abc");
    expect(clipText("abcdef", 3)).toBe("abc");
    expect(clipText("", 3)).toBeNull();
    expect(clipText(null, 3)).toBeNull();
    expect(clipText(undefined, 3)).toBeNull();
  });

  it("never splits a surrogate pair", () => {
    const text = `ab${"\u{1F600}"}cd`;
    expect(clipText(text, 3)).toBe("ab");
    expect(clipText(text, 4)).toBe(`ab${"\u{1F600}"}`);
    expect(clipText(text, 3)?.isWellFormed()).toBe(true);
  });
});
