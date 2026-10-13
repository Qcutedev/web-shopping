import { afterEach, describe, expect, it, vi } from "vitest";

import { assertClientAddressConfig, MAX_TRUSTED_PROXY_HOPS } from "./client-address";
import {
  AUTH_LIBRARY_VARIABLES,
  AUTH_SECRET_MIN_DISTINCT_CHARACTERS,
  AUTH_SECRET_MIN_LENGTH,
  DEFAULT_PAYMENT_TIMEOUT_MINUTES,
  ENV_RULES,
  type EnvIssue,
  type EnvSource,
  EnvValidationError,
  MAX_PAYMENT_TIMEOUT_MINUTES,
  parseEnv,
  PAYMENT_SWEEP_INTERVAL_MS,
  readAuthSecret,
  readDatabaseUrl,
} from "./env";
import { assertSameOrigin } from "./http";
import { createLogger, DEFAULT_LOG_LEVEL, setLogLevel } from "./logger";

// Made-up values. Each is unmistakable, so a test can assert that none of it reaches a message.
const DATABASE_URL = "postgresql://shop_app:Zq7canaryPw@db.example.test:5432/shop";
const APP_URL = "https://shop.example.test";
const AUTH_SECRET = "Zq7canary-auth-secret-Kd2Xw9Lm4Rt6Pn3b";

/** A valid development environment; a case overrides or removes what it is about. */
function source(overrides: Record<string, string | undefined> = {}): EnvSource {
  return { NODE_ENV: "development", APP_URL, DATABASE_URL, AUTH_SECRET, ...overrides };
}

/** A valid production environment. */
function production(overrides: Record<string, string | undefined> = {}): EnvSource {
  return source({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1", ...overrides });
}

function failure(env: EnvSource): EnvValidationError {
  try {
    parseEnv(env);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error("parseEnv accepted an environment the test expected it to refuse.");
}

function issuesOf(env: EnvSource): EnvIssue[] {
  return [...failure(env).issues];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  // The level is one per process and outlives a module reset, so each case starts from the default.
  setLogLevel(DEFAULT_LOG_LEVEL);
});

describe("parseEnv: a valid environment", () => {
  it("returns the configuration with the documented defaults", () => {
    expect(parseEnv(source())).toEqual({
      nodeEnv: "development",
      appUrl: APP_URL,
      appOrigin: APP_URL,
      databaseUrl: DATABASE_URL,
      authSecret: AUTH_SECRET,
      trustedProxy: { trustedProxyHops: 0 },
      paymentTimeoutMinutes: 15,
      logLevel: "info",
    });
    expect(DEFAULT_PAYMENT_TIMEOUT_MINUTES).toBe(15);
  });

  it("treats a missing NODE_ENV as development", () => {
    expect(parseEnv(source({ NODE_ENV: undefined })).nodeEnv).toBe("development");
  });

  it("treats an empty string like a variable that is not set", () => {
    const env = parseEnv(
      source({
        NODE_ENV: "",
        TRUSTED_PROXY_HOPS: "",
        TRUSTED_CLIENT_IP_HEADER: "",
        PAYMENT_TIMEOUT_MINUTES: "",
        LOG_LEVEL: "",
        DATABASE_URL_TEST: "",
      }),
    );
    expect(env.nodeEnv).toBe("development");
    expect(env.trustedProxy).toEqual({ trustedProxyHops: 0 });
    expect(env.paymentTimeoutMinutes).toBe(15);
    expect(env.logLevel).toBe("info");
  });

  it("ignores variables it does not know", () => {
    const env = parseEnv(source({ SOMETHING_ELSE: "x", TRUST_PROXY: "true", PATH: "/usr/bin" }));
    expect(Object.keys(env).sort()).toEqual([
      "appOrigin",
      "appUrl",
      "authSecret",
      "databaseUrl",
      "logLevel",
      "nodeEnv",
      "paymentTimeoutMinutes",
      "trustedProxy",
    ]);
    // SR-01: there is no boolean "trust proxy" switch; an unknown variable trusts nothing.
    expect(env.trustedProxy).toEqual({ trustedProxyHops: 0 });
  });

  it("returns a frozen configuration", () => {
    const env = parseEnv(source());
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.trustedProxy)).toBe(true);
  });

  it("does not validate DATABASE_URL_TEST outside production", () => {
    expect(() => parseEnv(source({ DATABASE_URL_TEST: "anything at all" }))).not.toThrow();
    expect(() =>
      parseEnv(source({ NODE_ENV: "test", DATABASE_URL_TEST: "anything" })),
    ).not.toThrow();
  });

  it("accepts the local placeholder passwords outside production", () => {
    for (const nodeEnv of ["development", "test"]) {
      const env = parseEnv(
        source({
          NODE_ENV: nodeEnv,
          DATABASE_URL: "postgresql://marketplace:local_dev_only_not_a_secret@127.0.0.1:5432/dev",
        }),
      );
      expect(env.databaseUrl).toContain("local_dev_only_not_a_secret");
    }
  });
});

describe("parseEnv: NODE_ENV", () => {
  it.each(["development", "test", "production"])("accepts %s", (value) => {
    const env = value === "production" ? production() : source({ NODE_ENV: value });
    expect(parseEnv(env).nodeEnv).toBe(value);
  });

  it.each(["prod", "Production", "staging", " production", "1"])("refuses %j", (value) => {
    expect(issuesOf(source({ NODE_ENV: value }))).toEqual([
      { variable: "NODE_ENV", rule: ENV_RULES.nodeEnv },
    ]);
  });
});

describe("parseEnv: APP_URL", () => {
  it("is required", () => {
    expect(issuesOf(source({ APP_URL: undefined }))).toEqual([
      { variable: "APP_URL", rule: ENV_RULES.required },
    ]);
    expect(issuesOf(source({ APP_URL: "" }))).toEqual([
      { variable: "APP_URL", rule: ENV_RULES.required },
    ]);
  });

  it.each([
    "shop.example.test",
    "//shop.example.test",
    "/relative",
    "ftp://shop.example.test",
    "javascript:alert(1)",
    "file:///etc/hosts",
    "http://",
    "not a url",
    " ",
  ])("refuses %j", (value) => {
    expect(issuesOf(source({ APP_URL: value }))).toEqual([
      { variable: "APP_URL", rule: ENV_RULES.appUrl },
    ]);
  });

  it.each([
    ["http://localhost:3000", "http://localhost:3000"],
    ["https://shop.example.test/", "https://shop.example.test"],
    ["https://shop.example.test:443/some/path?x=1", "https://shop.example.test"],
    ["https://shop.example.test:8443", "https://shop.example.test:8443"],
    ["HTTPS://Shop.Example.Test", "https://shop.example.test"],
  ])("accepts %j and gives the origin %j", (value, origin) => {
    const env = parseEnv(source({ APP_URL: value }));
    expect(env.appUrl).toBe(value);
    expect(env.appOrigin).toBe(origin);
  });

  // SECURITY.md (TM-16 review): env.ts must reject what makes assertSameOrigin throw TypeError.
  it("accepts exactly the values that assertSameOrigin accepts as its allowed origin", () => {
    const request = new Request("https://shop.example.test/x", { method: "GET" });
    const candidates = [
      "http://localhost:3000",
      "https://shop.example.test/path",
      "shop.example.test",
      "ftp://shop.example.test",
      "mailto:someone",
      "http://",
      "",
      "x",
    ];
    for (const candidate of candidates) {
      let acceptedByOriginCheck = true;
      try {
        assertSameOrigin(request, candidate);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        acceptedByOriginCheck = false;
      }
      let acceptedByEnv = true;
      try {
        parseEnv(source({ APP_URL: candidate }));
      } catch {
        acceptedByEnv = false;
      }
      expect({ candidate, acceptedByEnv }).toEqual({
        candidate,
        acceptedByEnv: acceptedByOriginCheck,
      });
    }
  });
});

describe("parseEnv: DATABASE_URL", () => {
  it("is required", () => {
    expect(issuesOf(source({ DATABASE_URL: undefined }))).toEqual([
      { variable: "DATABASE_URL", rule: ENV_RULES.required },
    ]);
    expect(issuesOf(source({ DATABASE_URL: "" }))).toEqual([
      { variable: "DATABASE_URL", rule: ENV_RULES.required },
    ]);
  });

  it.each([
    "mysql://u:p@db.example.test/shop",
    "https://db.example.test/shop",
    "db.example.test:5432/shop",
    "postgresql",
    "not a url",
  ])("refuses %j", (value) => {
    expect(issuesOf(source({ DATABASE_URL: value }))).toEqual([
      { variable: "DATABASE_URL", rule: ENV_RULES.databaseUrl },
    ]);
  });

  it.each(["postgresql://u:p@db.example.test:5432/shop", "postgres://u:p@db.example.test/shop"])(
    "accepts %j",
    (value) => {
      expect(parseEnv(source({ DATABASE_URL: value })).databaseUrl).toBe(value);
    },
  );
});

describe("parseEnv: production refusals (SEC-009)", () => {
  it.each(["local_dev_only_not_a_secret", "local_test_only_not_a_secret"])(
    "refuses a DATABASE_URL that contains %s",
    (placeholder) => {
      const url = `postgresql://marketplace:${placeholder}@db.example.test:5432/shop`;
      expect(issuesOf(production({ DATABASE_URL: url }))).toEqual([
        { variable: "DATABASE_URL", rule: ENV_RULES.databaseUrlPlaceholder },
      ]);
    },
  );

  it("refuses the placeholder wherever it stands in the URL", () => {
    const url = "postgresql://local_dev_only_not_a_secret@db.example.test/shop?x=1";
    expect(issuesOf(production({ DATABASE_URL: url }))).toEqual([
      { variable: "DATABASE_URL", rule: ENV_RULES.databaseUrlPlaceholder },
    ]);
  });

  it("refuses a set DATABASE_URL_TEST, whatever its value", () => {
    for (const value of ["postgresql://u:p@127.0.0.1:5433/shop_test", "x"]) {
      expect(issuesOf(production({ DATABASE_URL_TEST: value }))).toEqual([
        { variable: "DATABASE_URL_TEST", rule: ENV_RULES.databaseUrlTestInProduction },
      ]);
    }
  });

  it("accepts a production environment without either", () => {
    expect(parseEnv(production()).nodeEnv).toBe("production");
  });
});

// SEC-025: the driver does not use the variable as written. It percent-decodes the password,
// prefers a `password` query parameter, and falls back to PGPASSWORD when the URL has none.
describe("parseEnv: the placeholder in the form the driver will use (SEC-025)", () => {
  const PLACEHOLDERS = ["local_dev_only_not_a_secret", "local_test_only_not_a_secret"] as const;
  const PLACEHOLDER_ISSUE = { variable: "DATABASE_URL", rule: ENV_RULES.databaseUrlPlaceholder };
  const PGPASSWORD_ISSUE = { variable: "PGPASSWORD", rule: ENV_RULES.pgPasswordPlaceholder };

  /** Every character written as an escape. */
  function fullyEncoded(text: string): string {
    return Array.from(
      text,
      (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
    ).join("");
  }

  /** Spellings that do not contain the placeholder as written and decode to it. */
  function spellings(placeholder: string): string[] {
    return [
      placeholder.replace("_", "%5F"),
      placeholder.replace("_", "%5f"),
      placeholder.replaceAll("_", "%5F"),
      `%6C${placeholder.slice(1)}`,
      fullyEncoded(placeholder),
    ];
  }

  function refusedByBoth(env: EnvSource, expected: EnvIssue[]): void {
    expect(issuesOf(env)).toEqual(expected);
    let thrown: unknown;
    try {
      readDatabaseUrl(env);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect((thrown as EnvValidationError).issues).toEqual(expected);
  }

  it.each(PLACEHOLDERS)("refuses %s percent-encoded in front of the host", (placeholder) => {
    for (const spelling of spellings(placeholder)) {
      expect(spelling).not.toContain(placeholder);
      refusedByBoth(
        production({ DATABASE_URL: `postgresql://shop_app:${spelling}@db.example.test:5432/shop` }),
        [PLACEHOLDER_ISSUE],
      );
    }
  });

  it.each(PLACEHOLDERS)(
    "refuses %s percent-encoded in the password query parameter",
    (placeholder) => {
      for (const spelling of spellings(placeholder)) {
        for (const url of [
          `postgresql://shop_app@db.example.test/shop?password=${spelling}`,
          `postgresql://shop_app:Zq7canaryPw@db.example.test/shop?schema=public&password=${spelling}`,
          // The driver uses the last of two parameters with the same name.
          `postgresql://shop_app@db.example.test/shop?password=Zq7canaryPw&password=${spelling}`,
        ]) {
          refusedByBoth(production({ DATABASE_URL: url }), [PLACEHOLDER_ISSUE]);
        }
      }
    },
  );

  it("refuses an encoded placeholder beside an escape that is not well formed, without throwing", () => {
    // The driver still decodes the well-formed escapes of such a string, so they are judged too.
    for (const url of [
      "postgresql://shop_app:local%5Fdev_only_not_a_secret%ZZ@db.example.test/shop",
      "postgresql://shop_app:%E0%A4%A@db.example.test/shop?password=local%5Ftest_only_not_a_secret",
      "postgresql://shop_app:local%5Fdev_only_not_a_secret%@db.example.test/shop",
      "postgresql://shop_app:%local%5Fdev_only_not_a_secret@db.example.test/shop",
    ]) {
      refusedByBoth(production({ DATABASE_URL: url }), [PLACEHOLDER_ISSUE]);
    }
  });

  it("an escape that is not well formed is not a refusal by itself, and nothing is thrown", () => {
    for (const password of ["%", "%ZZ", "100%", "%E0%A4%A", "a%2", "%C3%28", "%ff%fe"]) {
      const url = `postgresql://shop_app:${password}Zq7canaryPw@db.example.test/shop`;
      expect(parseEnv(production({ DATABASE_URL: url })).databaseUrl).toBe(url);
      expect(readDatabaseUrl(production({ DATABASE_URL: url }))).toBe(url);
    }
  });

  it("refuses a placeholder that the URL parser puts together by dropping a tab or a line break", () => {
    for (const blank of ["\t", "\n", "\r"]) {
      const url = `postgresql://shop_app:local_dev${blank}_only_not_a_secret@db.example.test/shop`;
      expect(url).not.toContain("local_dev_only_not_a_secret");
      refusedByBoth(production({ DATABASE_URL: url }), [PLACEHOLDER_ISSUE]);
    }
  });

  it("reports the variable once, however many forms of the placeholder it holds", () => {
    const url =
      "postgresql://shop_app:local_dev_only_not_a_secret@db.example.test/shop?password=local%5Ftest_only_not_a_secret";
    refusedByBoth(production({ DATABASE_URL: url }), [PLACEHOLDER_ISSUE]);
  });

  it.each(PLACEHOLDERS)("refuses a PGPASSWORD that contains %s", (placeholder) => {
    for (const value of [placeholder, `x${placeholder}`, `${placeholder}1`]) {
      refusedByBoth(
        production({
          DATABASE_URL: "postgresql://shop_app@db.example.test/shop",
          PGPASSWORD: value,
        }),
        [PGPASSWORD_ISSUE],
      );
      // Whether or not the URL carries a password of its own.
      refusedByBoth(production({ PGPASSWORD: value }), [PGPASSWORD_ISSUE]);
    }
  });

  it("reports DATABASE_URL and PGPASSWORD together, each by its own name", () => {
    refusedByBoth(
      production({
        DATABASE_URL: "postgresql://shop_app:local%5Fdev_only_not_a_secret@db.example.test/shop",
        PGPASSWORD: "local_test_only_not_a_secret",
      }),
      [PLACEHOLDER_ISSUE, PGPASSWORD_ISSUE],
    );
  });

  it("accepts any other PGPASSWORD, and an empty one, in production", () => {
    // The driver does not decode this variable, so an escaped spelling in it is another password.
    for (const value of [
      "Zq7canaryPw",
      "local_dev",
      "local%5Fdev_only_not_a_secret",
      "",
      undefined,
    ]) {
      expect(parseEnv(production({ PGPASSWORD: value })).nodeEnv).toBe("production");
      expect(readDatabaseUrl(production({ PGPASSWORD: value }))).toBe(DATABASE_URL);
    }
  });

  it("applies none of it outside production", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      const env = source({
        NODE_ENV: nodeEnv,
        DATABASE_URL: "postgresql://marketplace:local%5Fdev_only_not_a_secret@127.0.0.1:5432/dev",
        PGPASSWORD: "local_dev_only_not_a_secret",
      });
      expect(() => parseEnv(env)).not.toThrow();
      expect(() => readDatabaseUrl(env)).not.toThrow();
    }
  });

  it("keeps accepting a password that only resembles a placeholder", () => {
    for (const password of ["local%5Fother", "p%40ss%3Aword", "local_dev", "not_a_secret_1"]) {
      const url = `postgresql://shop_app:${password}@db.example.test/shop?password=${password}`;
      expect(parseEnv(production({ DATABASE_URL: url })).databaseUrl).toBe(url);
    }
  });

  it("puts no value, encoded or decoded, into the error or the start-up log line", async () => {
    const canary = "Zq7canary";
    const env = production({
      DATABASE_URL: `postgresql://shop_app:${canary}local%5Fdev_only_not_a_secret@db.example.test/shop?password=${canary}%6Cocal_test_only_not_a_secret`,
      PGPASSWORD: `${canary}local_dev_only_not_a_secret`,
    });
    const error = failure(env);
    const everything = JSON.stringify([error.message, error.issues, error.stack, { ...error }]);
    for (const value of [canary, "example.test", "_not_a_secret", "%5F", "%6C", "shop_app"]) {
      expect(everything).not.toContain(value);
    }
    expect(error.message).toContain(`- PGPASSWORD ${ENV_RULES.pgPasswordPlaceholder}`);

    for (const name of [
      "DATABASE_URL_TEST",
      "TRUSTED_CLIENT_IP_HEADER",
      "PAYMENT_TIMEOUT_MINUTES",
      "LOG_LEVEL",
    ]) {
      vi.stubEnv(name, undefined);
    }
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.resetModules();
    const { loadEnvAtStartup: load } = await import("./env");
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    expect(() => load({ logger })).toThrow();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "error",
      issues: [PLACEHOLDER_ISSUE, PGPASSWORD_ISSUE],
    });
    for (const value of [canary, "example.test", "_not_a_secret", "%5F", "%6C", "shop_app"]) {
      expect(lines[0]).not.toContain(value);
    }
  });
});

describe("parseEnv: TRUSTED_PROXY_HOPS (SR-01)", () => {
  it.each(["0", "1", "2", "3", "4", "5"])("accepts %s", (value) => {
    const env = parseEnv(source({ TRUSTED_PROXY_HOPS: value }));
    expect(env.trustedProxy).toEqual({ trustedProxyHops: Number(value) });
  });

  it.each(["6", "10", "-1", "1.0", "1.5", "+1", " 1", "1 ", "0x1", "01", "one", "true", "false"])(
    "refuses %j",
    (value) => {
      expect(issuesOf(source({ TRUSTED_PROXY_HOPS: value }))).toEqual([
        { variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHops },
      ]);
    },
  );

  // CR-50: the pattern in env.ts is one character class, "[0-MAX]". That is right only while
  // the maximum is a single digit; this case goes red the day SR-01 raises it to 10 or more.
  it("is validated by a one-digit pattern, which holds only while the maximum is one digit", () => {
    expect(Number.isInteger(MAX_TRUSTED_PROXY_HOPS)).toBe(true);
    expect(MAX_TRUSTED_PROXY_HOPS).toBeGreaterThanOrEqual(0);
    expect(MAX_TRUSTED_PROXY_HOPS).toBeLessThanOrEqual(9);
    const highest = String(MAX_TRUSTED_PROXY_HOPS);
    expect(parseEnv(source({ TRUSTED_PROXY_HOPS: highest })).trustedProxy.trustedProxyHops).toBe(
      MAX_TRUSTED_PROXY_HOPS,
    );
    for (const value of [String(MAX_TRUSTED_PROXY_HOPS + 1), `${highest}0`, `0${highest}`]) {
      expect(issuesOf(source({ TRUSTED_PROXY_HOPS: value }))).toEqual([
        { variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHops },
      ]);
    }
  });

  it("defaults to 0 outside production", () => {
    expect(parseEnv(source()).trustedProxy.trustedProxyHops).toBe(0);
    expect(parseEnv(source({ NODE_ENV: "test" })).trustedProxy.trustedProxyHops).toBe(0);
  });

  it("must be set explicitly in production, and 0 is an accepted answer", () => {
    expect(issuesOf(production({ TRUSTED_PROXY_HOPS: undefined }))).toEqual([
      { variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHopsExplicit },
    ]);
    expect(issuesOf(production({ TRUSTED_PROXY_HOPS: "" }))).toEqual([
      { variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHopsExplicit },
    ]);
    expect(parseEnv(production({ TRUSTED_PROXY_HOPS: "0" })).trustedProxy).toEqual({
      trustedProxyHops: 0,
    });
  });

  it("is still required explicitly in production when the single header is set", () => {
    expect(
      issuesOf(
        production({ TRUSTED_PROXY_HOPS: undefined, TRUSTED_CLIENT_IP_HEADER: "X-Client-Address" }),
      ),
    ).toEqual([{ variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHopsExplicit }]);
  });
});

describe("parseEnv: TRUSTED_CLIENT_IP_HEADER (SR-01)", () => {
  it("is passed on when valid, with no hops", () => {
    expect(parseEnv(source({ TRUSTED_CLIENT_IP_HEADER: "Fly-Client-IP" })).trustedProxy).toEqual({
      trustedProxyHops: 0,
      trustedClientIpHeader: "Fly-Client-IP",
    });
    expect(
      parseEnv(
        production({ TRUSTED_PROXY_HOPS: "0", TRUSTED_CLIENT_IP_HEADER: "X-Client-Address" }),
      ).trustedProxy,
    ).toEqual({ trustedProxyHops: 0, trustedClientIpHeader: "X-Client-Address" });
  });

  it.each(["X Real IP", "x_real_ip", "x-real-ip:", "a".repeat(65), "x-réal", "a,b"])(
    "refuses the name %j",
    (value) => {
      expect(issuesOf(source({ TRUSTED_CLIENT_IP_HEADER: value }))).toEqual([
        { variable: "TRUSTED_CLIENT_IP_HEADER", rule: ENV_RULES.trustedClientIpHeader },
      ]);
    },
  );

  it.each(["X-Forwarded-For", "x-forwarded-for", "Forwarded", "COOKIE", "Authorization", "host"])(
    "refuses %j",
    (value) => {
      expect(issuesOf(source({ TRUSTED_CLIENT_IP_HEADER: value }))).toEqual([
        { variable: "TRUSTED_CLIENT_IP_HEADER", rule: ENV_RULES.trustedClientIpHeaderForbidden },
      ]);
    },
  );

  it("cannot be combined with TRUSTED_PROXY_HOPS greater than 0", () => {
    expect(
      issuesOf(source({ TRUSTED_PROXY_HOPS: "1", TRUSTED_CLIENT_IP_HEADER: "X-Client-Address" })),
    ).toEqual([
      { variable: "TRUSTED_CLIENT_IP_HEADER", rule: ENV_RULES.trustedClientIpHeaderWithHops },
    ]);
  });

  // SR-01: env.ts rejects at start what getClientAddress would refuse with a TypeError per call.
  it("never returns a configuration that assertClientAddressConfig refuses", () => {
    const hops = [undefined, "0", "1", "5", "6", "x"];
    const headers = [undefined, "X-Client-Address", "X-Forwarded-For", "bad name", "Host"];
    let accepted = 0;
    for (const TRUSTED_PROXY_HOPS of hops) {
      for (const TRUSTED_CLIENT_IP_HEADER of headers) {
        let config;
        try {
          config = parseEnv(source({ TRUSTED_PROXY_HOPS, TRUSTED_CLIENT_IP_HEADER })).trustedProxy;
        } catch {
          continue;
        }
        accepted += 1;
        expect(() => assertClientAddressConfig(config)).not.toThrow();
      }
    }
    // Hops unset, 0, 1, or 5 without a header; hops unset or 0 with the one valid header.
    expect(accepted).toBe(6);
  });
});

describe("parseEnv: PAYMENT_TIMEOUT_MINUTES (D-028)", () => {
  it("defaults to 15", () => {
    expect(parseEnv(source()).paymentTimeoutMinutes).toBe(15);
  });

  it.each([
    ["1", 1],
    ["15", 15],
    ["90", 90],
    [String(MAX_PAYMENT_TIMEOUT_MINUTES), MAX_PAYMENT_TIMEOUT_MINUTES],
  ])("accepts %j", (value, minutes) => {
    expect(parseEnv(source({ PAYMENT_TIMEOUT_MINUTES: value })).paymentTimeoutMinutes).toBe(
      minutes,
    );
  });

  it.each(["0", "-5", "1.5", "15m", "015", " 15", "1e2", "1441", "99999", "fifteen", "Infinity"])(
    "refuses %j",
    (value) => {
      expect(issuesOf(source({ PAYMENT_TIMEOUT_MINUTES: value }))).toEqual([
        { variable: "PAYMENT_TIMEOUT_MINUTES", rule: ENV_RULES.paymentTimeoutMinutes },
      ]);
    },
  );

  it("has no setting for the sweep interval: it is the owner's one minute (D-033 point 12)", () => {
    expect(PAYMENT_SWEEP_INTERVAL_MS).toBe(60_000);
    const env = parseEnv(source({ PAYMENT_SWEEP_INTERVAL_MS: "5", PAYMENT_SWEEP_INTERVAL: "5" }));
    expect(JSON.stringify(env)).not.toContain("weep");
  });
});

describe("parseEnv: LOG_LEVEL", () => {
  it.each(["debug", "info", "warn", "error"])("accepts %s", (value) => {
    expect(parseEnv(source({ LOG_LEVEL: value })).logLevel).toBe(value);
  });

  it.each(["trace", "INFO", "warning", "0"])("refuses %j", (value) => {
    expect(issuesOf(source({ LOG_LEVEL: value }))).toEqual([
      { variable: "LOG_LEVEL", rule: ENV_RULES.logLevel },
    ]);
  });
});

describe("parseEnv: the error", () => {
  it("names every variable at fault, each with its rule, in one error", () => {
    const error = failure({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://marketplace:local_dev_only_not_a_secret@127.0.0.1:5432/dev",
      AUTH_SECRET: "local_dev_only_not_a_secret_0123456789",
      DATABASE_URL_TEST: "postgresql://marketplace:x@127.0.0.1:5433/shop_test",
      TRUSTED_CLIENT_IP_HEADER: "bad name",
      PAYMENT_TIMEOUT_MINUTES: "soon",
      LOG_LEVEL: "loud",
    });
    expect(error.issues).toEqual([
      { variable: "APP_URL", rule: ENV_RULES.required },
      { variable: "TRUSTED_CLIENT_IP_HEADER", rule: ENV_RULES.trustedClientIpHeader },
      { variable: "PAYMENT_TIMEOUT_MINUTES", rule: ENV_RULES.paymentTimeoutMinutes },
      { variable: "LOG_LEVEL", rule: ENV_RULES.logLevel },
      { variable: "DATABASE_URL", rule: ENV_RULES.databaseUrlPlaceholder },
      { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder },
      { variable: "DATABASE_URL_TEST", rule: ENV_RULES.databaseUrlTestInProduction },
      { variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHopsExplicit },
    ]);
    expect(error.name).toBe("EnvValidationError");
    expect(error.message).toBe(
      [
        "Invalid environment configuration. The server cannot start.",
        "- APP_URL is required",
        "- TRUSTED_CLIENT_IP_HEADER must match ^[A-Za-z0-9-]{1,64}$",
        "- PAYMENT_TIMEOUT_MINUTES must be an integer from 1 to 1440",
        "- LOG_LEVEL must be debug, info, warn, or error",
        "- DATABASE_URL must not contain a local placeholder password from .env.example when NODE_ENV=production",
        "- AUTH_SECRET must not be a placeholder from .env.example when NODE_ENV=production",
        "- DATABASE_URL_TEST must not be set when NODE_ENV=production",
        "- TRUSTED_PROXY_HOPS must be set explicitly when NODE_ENV=production",
      ].join("\n"),
    );
  });

  it("names an empty environment's three required variables", () => {
    expect(issuesOf({})).toEqual([
      { variable: "APP_URL", rule: ENV_RULES.required },
      { variable: "DATABASE_URL", rule: ENV_RULES.required },
      { variable: "AUTH_SECRET", rule: ENV_RULES.required },
    ]);
  });

  // A rejected value is as likely to be a secret as an accepted one (a password pasted into the
  // wrong variable), so no part of any value may appear, whichever rule refused it.
  it("never contains a value, for any variable and any rule", () => {
    const canary = "Zq7canary";
    const everyVariableWrong: Record<string, string> = {
      NODE_ENV: `${canary}-node-env`,
      APP_URL: `${canary}-app-url`,
      DATABASE_URL: `mysql://user:${canary}-db-password@db.example.test/shop`,
      AUTH_SECRET: `${canary}-short`,
      DATABASE_URL_TEST: `postgresql://user:${canary}-test-password@127.0.0.1:5433/shop_test`,
      TRUSTED_PROXY_HOPS: `${canary}-hops`,
      TRUSTED_CLIENT_IP_HEADER: `${canary} header`,
      PAYMENT_TIMEOUT_MINUTES: `${canary}-timeout`,
      LOG_LEVEL: `${canary}-level`,
    };
    const sources: EnvSource[] = [
      everyVariableWrong,
      // The rules that depend on production and on two variables together.
      production({
        DATABASE_URL: `postgresql://user:${canary}local_dev_only_not_a_secret@db.example.test/shop`,
        DATABASE_URL_TEST: `${canary}-test`,
        AUTH_SECRET: `${canary}-not_a_secret-0123456789abcdef`,
        TRUSTED_PROXY_HOPS: "2",
        TRUSTED_CLIENT_IP_HEADER: `X-${canary}`,
      }),
      production({ TRUSTED_PROXY_HOPS: undefined, TRUSTED_CLIENT_IP_HEADER: "Cookie" }),
    ];
    for (const env of sources) {
      const error = failure(env);
      const everything = JSON.stringify([error.message, error.issues, error.stack, { ...error }]);
      expect(everything).not.toContain(canary);
      expect(everything).not.toContain("example.test");
      expect(error.cause).toBeUndefined();
      const rules = new Set<string>(Object.values(ENV_RULES));
      for (const issue of error.issues) expect(rules.has(issue.rule)).toBe(true);
    }
    expect(failure(everyVariableWrong).issues.map((issue) => issue.variable)).toEqual([
      "NODE_ENV",
      "APP_URL",
      "DATABASE_URL",
      "AUTH_SECRET",
      "TRUSTED_PROXY_HOPS",
      "TRUSTED_CLIENT_IP_HEADER",
      "PAYMENT_TIMEOUT_MINUTES",
      "LOG_LEVEL",
    ]);
  });
});

describe("parseEnv: AUTH_SECRET (CR-66)", () => {
  it("is required, and an empty value counts as not set", () => {
    for (const value of [undefined, ""]) {
      expect(issuesOf(source({ AUTH_SECRET: value }))).toEqual([
        { variable: "AUTH_SECRET", rule: ENV_RULES.required },
      ]);
    }
  });

  it("is required in every NODE_ENV, with no default", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(issuesOf(source({ NODE_ENV: nodeEnv, AUTH_SECRET: undefined }))).toEqual([
        { variable: "AUTH_SECRET", rule: ENV_RULES.required },
      ]);
    }
    expect(issuesOf(production({ AUTH_SECRET: undefined }))).toEqual([
      { variable: "AUTH_SECRET", rule: ENV_RULES.required },
    ]);
  });

  it("refuses a value shorter than the minimum and accepts one of exactly the minimum", () => {
    expect(AUTH_SECRET_MIN_LENGTH).toBe(32);
    expect(issuesOf(source({ AUTH_SECRET: "x".repeat(AUTH_SECRET_MIN_LENGTH - 1) }))).toEqual([
      { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretTooShort },
    ]);
    const exact = "x".repeat(AUTH_SECRET_MIN_LENGTH);
    expect(parseEnv(source({ AUTH_SECRET: exact })).authSecret).toBe(exact);
  });

  it("accepts the placeholder of .env.example outside production only", () => {
    const placeholder = "local_dev_only_not_a_secret_0123456789";
    for (const nodeEnv of ["development", "test"]) {
      expect(parseEnv(source({ NODE_ENV: nodeEnv, AUTH_SECRET: placeholder })).authSecret).toBe(
        placeholder,
      );
    }
    expect(issuesOf(production({ AUTH_SECRET: placeholder }))).toEqual([
      { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder },
    ]);
  });

  it("reports a short placeholder once, with the length rule", () => {
    expect(issuesOf(production({ AUTH_SECRET: "not_a_secret" }))).toEqual([
      { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretTooShort },
    ]);
  });

  it("never puts the value in the message, the issues, or the stack", () => {
    const secrets = [
      "Zq7canary-short",
      `Zq7canary-not_a_secret-${"0".repeat(AUTH_SECRET_MIN_LENGTH)}`,
    ];
    for (const secret of secrets) {
      for (const env of [source({ AUTH_SECRET: secret }), production({ AUTH_SECRET: secret })]) {
        if (secret.length >= AUTH_SECRET_MIN_LENGTH && env.NODE_ENV !== "production") continue;
        const error = failure(env);
        expect(error.issues.length).toBeGreaterThan(0);
        expect(JSON.stringify([error.message, error.issues, error.stack])).not.toContain(
          "Zq7canary",
        );
      }
    }
  });
});

describe("AUTH_SECRET in production: values that are plainly not random (SEC-044)", () => {
  const WEAK = [
    ["one repeated character", "x".repeat(32)],
    ["blanks only", " ".repeat(32)],
    ["fewer than 8 distinct characters", "gfedcbaabcdefggfedcbaabcdefgabcd"],
    ["a shorter unit repeated", "0123456789abcdef".repeat(2)],
    ["a longer unit repeated", "Zq7canary-unit-".repeat(3)],
    ["the library's built-in default", "better-auth-secret-12345678901234567890"],
    ["the library's default with blanks around it", " better-auth-secret-12345678901234567890 "],
    ["the integration-test secret", "integration-test-secret-0123456789-abcdefghij"],
    // SEC-047: values that differ from the shapes above by one character or by case.
    ["a word four times and a digit", `${"password".repeat(4)}1`],
    ["a period-8 run plus one character", `${"abcdefgh".repeat(4)}i`],
    ["a 16-character unit twice plus one", `${"0123456789abcdef".repeat(2)}X`],
    ["one character 25 times, exactly 8 distinct", `${"a".repeat(25)}bcdefgh`],
    ["the alphabet in order", "abcdefghijklmnopqrstuvwxyz012345"],
    ["a descending run of 8", "Zq7!Kd2#hgfedcbaXw9$Lm4%Rt6^Pn3&"],
    ["a run of digits", "Zq7!Kd2#12345678Xw9$Lm4%Rt6^Pn3&Yb5*"],
    ["invisible padding with 8 distinct letters", `${"\u200b".repeat(25)}abcdefg`],
    ["a non-ASCII letter in an otherwise random value", "Zq7!Kd2#Xw9$Lm4%Rt6^Pn3&Yb5*Vc8(\u00e9"],
    ["a blank inside an otherwise random value", "Zq7!Kd2#Xw9$Lm4%Rt6^Pn3&Yb5*Vc8( Hj1)"],
    ["the library default in upper case", "BETTER-AUTH-SECRET-12345678901234567890"],
    ["the library default in mixed case", "Better-Auth-Secret-12345678901234567890"],
    ["the library default with a character appended", "better-auth-secret-12345678901234567890!"],
    ["the library default with one in front", "Zq7!Kd2#better-auth-secret-12345678901234567890"],
    [
      "the library default with an invisible character",
      "better-auth-secret-12345678901234567890\u200b",
    ],
    ["the test secret in upper case", "INTEGRATION-TEST-SECRET-0123456789-ABCDEFGHIJ"],
    // SEC-049: the lag rule (one code-point difference at a lag of 1 to 8 over half the positions).
    ["a word with a counter", "secret1secret2secret3secret4secret5"],
    ["a 7-run with changing separators", "abcdefg!abcdefg@abcdefg#abcdefg$"],
    ["the alphabet in alternating case", "aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"],
    ["two interleaved sequences", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"],
    ["steps of 1 and 2 alternating", "acdfgijlmoprsuvxyACDFGIJLMOPRSUVX"],
    ["counting in hexadecimal", "000102030405060708090a0b0c0d0e0f"],
    ["a period of 5 with one changing character", "Kd2Xw1Kd2Xw2Kd2Xw3Kd2Xw4Kd2Xw5Kd2Xw6"],
    // SEC-049: the prefixes of the two published values, in any case, with a random tail.
    ["the library prefix and a random tail", "better-auth-secret-Kd2Xw9Lm4Rt6Pn3b"],
    ["the library prefix in mixed case", "Better-Auth-Secret:Kd2Xw9Lm4Rt6Pn3bYc5"],
    ["the test prefix and a random tail", "integration-test-secret-Kd2Xw9Lm4Rt6Pn3b"],
    [
      "the test secret with two characters changed",
      "integration-test-secret-0123456799-abcdefghXX",
    ],
  ] as const;

  it("refuses each, in parseEnv and readAuthSecret alike, naming the variable and the rule", () => {
    expect(AUTH_SECRET_MIN_DISTINCT_CHARACTERS).toBe(8);
    for (const [label, secret] of WEAK) {
      expect(secret.length, label).toBeGreaterThanOrEqual(AUTH_SECRET_MIN_LENGTH);
      const expected = [{ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretWeak }];
      expect(issuesOf(production({ AUTH_SECRET: secret })), label).toEqual(expected);
      let thrown: unknown;
      try {
        readAuthSecret({ AUTH_SECRET: secret, NODE_ENV: "production" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, label).toBeInstanceOf(EnvValidationError);
      expect((thrown as EnvValidationError).issues, label).toEqual(expected);
      if (secret.trim() !== "") {
        expect(
          JSON.stringify([(thrown as Error).message, (thrown as Error).stack]),
          label,
        ).not.toContain(secret.trim());
      }
    }
  });

  it("accepts each outside production: development and test stubs keep working", () => {
    for (const [label, secret] of WEAK) {
      for (const nodeEnv of ["development", "test"]) {
        expect(parseEnv(source({ NODE_ENV: nodeEnv, AUTH_SECRET: secret })).authSecret, label).toBe(
          secret,
        );
        expect(readAuthSecret({ AUTH_SECRET: secret, NODE_ENV: nodeEnv }), label).toBe(secret);
      }
    }
  });

  it("accepts random values of the documented forms in production", async () => {
    const { randomBytes } = await import("node:crypto");
    // The rule is a floor on pattern, not a proof, so a random value is refused with a tiny but
    // non-zero probability (measured in SEC-047: 0 of 500,000 for base64url-43, base64-44, and
    // hex-32; 1 of 500,000 for hex-64, about 2e-6). Asserting zero would make this case flaky at
    // about 1 run in 250, so it allows 2 refusals per form in 2,000 values: the chance of more
    // than 2 at that rate is below 1e-8.
    const forms = {
      "base64url-43": () => randomBytes(32).toString("base64url"),
      "hex-32": () => randomBytes(16).toString("hex"),
      "hex-64": () => randomBytes(32).toString("hex"),
      "base64-44": () => randomBytes(32).toString("base64"),
    };
    for (const [form, generate] of Object.entries(forms)) {
      let refused = 0;
      for (let i = 0; i < 2_000; i += 1) {
        const secret = generate();
        try {
          parseEnv(production({ AUTH_SECRET: secret }));
        } catch (error) {
          if (!(error instanceof EnvValidationError)) throw error;
          refused += 1;
        }
      }
      expect(refused, form).toBeLessThanOrEqual(2);
    }
    // The secret the other production cases of this file use stays accepted.
    expect(parseEnv(production()).authSecret).toBe(AUTH_SECRET);
  });

  it("accepts random values of more forms in production: the lag rule refuses none (SEC-049)", async () => {
    const { randomBytes } = await import("node:crypto");
    // Measured when the rule was written: 0 of 1,000,000 in each of hex-64, hex-32, base64-44, and
    // base64url-43 refused by the lag rule. The older rules refuse about 2 in 1,000,000, so one
    // refusal per form in 3,000 values is allowed (the chance of 2 or more is below 1e-9).
    const forms = {
      "base64url-43": () => randomBytes(32).toString("base64url"),
      "hex-32": () => randomBytes(16).toString("hex"),
      "hex-32-upper": () => randomBytes(16).toString("hex").toUpperCase(),
      "hex-64": () => randomBytes(32).toString("hex"),
      "base64-44": () => randomBytes(32).toString("base64"),
      "base64-32": () => randomBytes(24).toString("base64"),
    };
    for (const [form, generate] of Object.entries(forms)) {
      let refused = 0;
      for (let i = 0; i < 3_000; i += 1) {
        try {
          parseEnv(production({ AUTH_SECRET: generate() }));
        } catch (error) {
          if (!(error instanceof EnvValidationError)) throw error;
          refused += 1;
        }
      }
      expect(refused, form).toBeLessThanOrEqual(1);
    }
  });

  it("a placeholder is reported once, with the placeholder rule, even when it is also weak", () => {
    expect(issuesOf(production({ AUTH_SECRET: "not_a_secret".repeat(3) }))).toEqual([
      { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder },
    ]);
    // SEC-049: also when only the lag rule and the prefix rule would refuse it.
    for (const secret of [
      "not_a_secret1not_a_secret2not_a_secret3",
      "better-auth-secret-not_a_secret-Kd2Xw9Lm4Rt6",
    ]) {
      expect(issuesOf(production({ AUTH_SECRET: secret })), secret).toEqual([
        { variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder },
      ]);
    }
  });
});

describe("the auth library's own variables are refused (SEC-045)", () => {
  const CANARY_ENTRY = "Zq7canary-rotated-secret-without-version";

  it("lists exactly the variables better-auth 1.7.7 reads for its secret, URL, origins, and telemetry (SEC-046)", () => {
    expect([...AUTH_LIBRARY_VARIABLES]).toEqual([
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_SECRETS",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_TRUSTED_ORIGINS",
      "BETTER_AUTH_TELEMETRY",
      "BETTER_AUTH_TELEMETRY_ENDPOINT",
      "BETTER_AUTH_TELEMETRY_DEBUG",
    ]);
  });

  it("refuses each when set, in every NODE_ENV, by parseEnv and readAuthSecret, naming no value", () => {
    for (const variable of AUTH_LIBRARY_VARIABLES) {
      for (const value of ["1:x", CANARY_ENTRY, " "]) {
        const expected = [{ variable, rule: ENV_RULES.authLibraryVariable }];
        for (const env of [
          source({ [variable]: value }),
          source({ NODE_ENV: "test", [variable]: value }),
          production({ [variable]: value }),
        ]) {
          const error = failure(env);
          expect(error.issues, `${variable} ${env.NODE_ENV ?? ""}`).toEqual(expected);
          expect(JSON.stringify([error.message, error.issues, error.stack])).not.toContain(
            "Zq7canary",
          );
          let thrown: unknown;
          try {
            readAuthSecret(env);
          } catch (caught) {
            thrown = caught;
          }
          expect(thrown).toBeInstanceOf(EnvValidationError);
          expect((thrown as EnvValidationError).issues).toEqual(expected);
          expect(
            JSON.stringify([(thrown as Error).message, (thrown as Error).stack]),
          ).not.toContain("Zq7canary");
        }
      }
    }
  });

  it("an empty value counts as not set, as for every variable of this file", () => {
    for (const variable of AUTH_LIBRARY_VARIABLES) {
      expect(parseEnv(source({ [variable]: "" })).authSecret).toBe(AUTH_SECRET);
      expect(readAuthSecret({ AUTH_SECRET, [variable]: "" })).toBe(AUTH_SECRET);
    }
  });
});

describe("readAuthSecret", () => {
  it("returns a valid secret and needs no other variable", () => {
    expect(readAuthSecret({ AUTH_SECRET })).toBe(AUTH_SECRET);
  });

  it("applies the same rules as parseEnv, with the same variable and rule texts", () => {
    const cases: Array<[Record<string, string | undefined>, string]> = [
      [{}, ENV_RULES.required],
      [{ AUTH_SECRET: "" }, ENV_RULES.required],
      [{ AUTH_SECRET: "x".repeat(AUTH_SECRET_MIN_LENGTH - 1) }, ENV_RULES.authSecretTooShort],
      [
        { AUTH_SECRET: "local_dev_only_not_a_secret_0123456789", NODE_ENV: "production" },
        ENV_RULES.authSecretPlaceholder,
      ],
    ];
    for (const [env, rule] of cases) {
      let thrown: unknown;
      try {
        readAuthSecret(env);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EnvValidationError);
      expect((thrown as EnvValidationError).issues).toEqual([{ variable: "AUTH_SECRET", rule }]);
    }
  });

  it("accepts the placeholder outside production", () => {
    const placeholder = "local_dev_only_not_a_secret_0123456789";
    expect(readAuthSecret({ AUTH_SECRET: placeholder, NODE_ENV: "development" })).toBe(placeholder);
    expect(readAuthSecret({ AUTH_SECRET: placeholder })).toBe(placeholder);
  });

  it("does not leak the value", () => {
    for (const env of [
      { AUTH_SECRET: "Zq7canary-short" },
      { AUTH_SECRET: "Zq7canary-not_a_secret-0123456789abcdef", NODE_ENV: "production" },
    ]) {
      let thrown: unknown;
      try {
        readAuthSecret(env);
      } catch (error) {
        thrown = error;
      }
      const error = thrown as EnvValidationError;
      expect(JSON.stringify([error.message, error.issues, error.stack])).not.toContain("Zq7canary");
    }
  });
});

describe("readDatabaseUrl", () => {
  it("needs DATABASE_URL and nothing else", () => {
    expect(readDatabaseUrl({ DATABASE_URL })).toBe(DATABASE_URL);
  });

  it("names the variable when it is missing, empty, or not a PostgreSQL URL", () => {
    for (const [env, rule] of [
      [{}, ENV_RULES.required],
      [{ DATABASE_URL: "" }, ENV_RULES.required],
      [{ DATABASE_URL: "mysql://u:Zq7canaryPw@db.example.test/shop" }, ENV_RULES.databaseUrl],
    ] as const) {
      let thrown: unknown;
      try {
        readDatabaseUrl(env);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EnvValidationError);
      const error = thrown as EnvValidationError;
      expect(error.issues).toEqual([{ variable: "DATABASE_URL", rule }]);
      expect(error.message).not.toContain("Zq7canaryPw");
    }
  });

  it("applies the SEC-009 placeholder refusal in production only", () => {
    const url = "postgresql://marketplace:local_test_only_not_a_secret@127.0.0.1:5433/t";
    expect(readDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: url })).toBe(url);
    expect(() => readDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: url })).toThrow(
      EnvValidationError,
    );
  });
});

describe("getEnv and import", () => {
  it("importing the module reads nothing and does not throw with an empty environment", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("APP_URL", undefined);
    vi.resetModules();
    const envModule = await import("./env");
    expect(typeof envModule.getEnv).toBe("function");
    // The failure belongs to the first call, not to the import.
    expect(() => envModule.getEnv()).toThrow(envModule.EnvValidationError);
  });

  it("validates process.env on the first call and keeps the result", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_URL", APP_URL);
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
    vi.stubEnv("DATABASE_URL_TEST", undefined);
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", undefined);
    vi.stubEnv("PAYMENT_TIMEOUT_MINUTES", "3");
    vi.stubEnv("LOG_LEVEL", undefined);
    vi.resetModules();
    const { getEnv } = await import("./env");
    const first = getEnv();
    expect(first.trustedProxy).toEqual({ trustedProxyHops: 2 });
    expect(first.paymentTimeoutMinutes).toBe(3);
    vi.stubEnv("PAYMENT_TIMEOUT_MINUTES", "9");
    expect(getEnv()).toBe(first);
  });

  it("does not keep a failed validation: a later call validates again", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_URL", undefined);
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
    vi.stubEnv("TRUSTED_PROXY_HOPS", undefined);
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", undefined);
    vi.stubEnv("PAYMENT_TIMEOUT_MINUTES", undefined);
    vi.stubEnv("LOG_LEVEL", undefined);
    vi.resetModules();
    const { getEnv, EnvValidationError: FreshError } = await import("./env");
    expect(() => getEnv()).toThrow(FreshError);
    vi.stubEnv("APP_URL", APP_URL);
    expect(getEnv().appOrigin).toBe(APP_URL);
  });

  it("refuses to run in a browser, before it reads any variable", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_URL", APP_URL);
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
    vi.stubEnv("TRUSTED_PROXY_HOPS", undefined);
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", undefined);
    vi.stubEnv("PAYMENT_TIMEOUT_MINUTES", undefined);
    vi.stubEnv("LOG_LEVEL", undefined);
    vi.resetModules();
    const { getEnv, EnvValidationError: FreshError } = await import("./env");
    vi.stubGlobal("window", {});
    let thrown: unknown;
    try {
      getEnv();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(FreshError);
    expect((thrown as Error).message).toBe(
      "src/server/env.ts was loaded in a browser. It is server-only.",
    );
    // The guard is the only thing in the way: the same environment is accepted on a server.
    vi.unstubAllGlobals();
    expect(getEnv().appOrigin).toBe(APP_URL);
  });
});

describe("loadEnvAtStartup", () => {
  function capture() {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({
      level: "debug",
      write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    });
    return { lines, logger };
  }

  function stubValid(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      NODE_ENV: "test",
      APP_URL,
      DATABASE_URL,
      AUTH_SECRET,
      DATABASE_URL_TEST: undefined,
      TRUSTED_PROXY_HOPS: undefined,
      TRUSTED_CLIENT_IP_HEADER: undefined,
      PAYMENT_TIMEOUT_MINUTES: undefined,
      LOG_LEVEL: undefined,
      PGPASSWORD: undefined,
      BETTER_AUTH_SECRET: undefined,
      BETTER_AUTH_SECRETS: undefined,
      BETTER_AUTH_URL: undefined,
      BETTER_AUTH_TRUSTED_ORIGINS: undefined,
      ...overrides,
    };
    for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
    vi.resetModules();
  }

  it("returns the configuration and logs nothing when it is valid", async () => {
    stubValid();
    const { loadEnvAtStartup: load } = await import("./env");
    const { lines, logger } = capture();
    expect(load({ logger }).appOrigin).toBe(APP_URL);
    expect(lines).toEqual([]);
  });

  it("stops the start when AUTH_SECRET is missing or weak, naming the variable and no value (CR-66)", async () => {
    for (const [overrides, rule] of [
      [{ AUTH_SECRET: undefined }, ENV_RULES.required],
      [{ AUTH_SECRET: "Zq7canary-short" }, ENV_RULES.authSecretTooShort],
      [
        {
          NODE_ENV: "production",
          TRUSTED_PROXY_HOPS: "1",
          AUTH_SECRET: "Zq7canary-not_a_secret-0123456789abcdef",
        },
        ENV_RULES.authSecretPlaceholder,
      ],
    ] as const) {
      stubValid(overrides);
      const { loadEnvAtStartup: load, EnvValidationError: FreshError } = await import("./env");
      const { lines, logger } = capture();
      expect(() => load({ logger })).toThrow(FreshError);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "error",
        component: "env",
        issues: [{ variable: "AUTH_SECRET", rule }],
      });
      expect(JSON.stringify(lines)).not.toContain("Zq7canary");
    }
  });

  it("stops the start when BETTER_AUTH_SECRETS is set, logging its name and no part of it (SEC-045)", async () => {
    for (const value of ["1:Zq7canary-x", "Zq7canary-rotated-secret-without-version"]) {
      stubValid({ BETTER_AUTH_SECRETS: value });
      const { loadEnvAtStartup: load, EnvValidationError: FreshError } = await import("./env");
      const { lines, logger } = capture();
      expect(() => load({ logger })).toThrow(FreshError);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "error",
        component: "env",
        issues: [{ variable: "BETTER_AUTH_SECRETS", rule: ENV_RULES.authLibraryVariable }],
      });
      expect(JSON.stringify(lines)).not.toContain("Zq7canary");
    }
  });

  it("stops the start in production when AUTH_SECRET is weak (SEC-044)", async () => {
    stubValid({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1", AUTH_SECRET: "x".repeat(32) });
    const { loadEnvAtStartup: load, EnvValidationError: FreshError } = await import("./env");
    const { lines, logger } = capture();
    expect(() => load({ logger })).toThrow(FreshError);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      issues: [{ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretWeak }],
    });
    expect(JSON.stringify(lines)).not.toContain("x".repeat(32));
  });

  it("logs one error line with variables and rules, no value, and throws", async () => {
    stubValid({
      APP_URL: "Zq7canary-not-a-url",
      DATABASE_URL: "mysql://user:Zq7canaryPw@db.example.test/shop",
      PAYMENT_TIMEOUT_MINUTES: "Zq7canary",
    });
    const { loadEnvAtStartup: load, EnvValidationError: FreshError } = await import("./env");
    const { lines, logger } = capture();
    expect(() => load({ logger })).toThrow(FreshError);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "Environment validation failed. The server cannot start.",
      component: "env",
      issues: [
        { variable: "APP_URL", rule: ENV_RULES.appUrl },
        { variable: "DATABASE_URL", rule: ENV_RULES.databaseUrl },
        { variable: "PAYMENT_TIMEOUT_MINUTES", rule: ENV_RULES.paymentTimeoutMinutes },
      ],
    });
    expect(JSON.stringify(lines)).not.toContain("Zq7canary");
    expect(JSON.stringify(lines)).not.toContain("example.test");
  });

  it("every rule text survives the logger's redaction unchanged", () => {
    const { lines, logger } = capture();
    const issues = Object.values(ENV_RULES).map((rule) => ({ variable: "AUTH_SECRET", rule }));
    logger.error("x", { component: "env", issues });
    expect(lines[0]?.issues).toEqual(issues);
  });

  it("warns once in production when no proxy is trusted (SR-01)", async () => {
    stubValid({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "0" });
    const { loadEnvAtStartup: load } = await import("./env");
    const { lines, logger } = capture();
    load({ logger });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", component: "env" });
    expect(String(lines[0]?.message)).toContain("every per-address rate limit is shared");
  });

  // The warning is written through `security("warn", ...)`: a logger configured at `error` still
  // writes it, with the same level, component, and text as `warn` did.
  it("writes the SR-01 warning through security(), which a logger at level error does not filter", async () => {
    stubValid({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "0" });
    const { loadEnvAtStartup: load } = await import("./env");
    const lines: Record<string, unknown>[] = [];
    const quiet = createLogger({
      level: "error",
      write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    });
    quiet.warn("an ordinary warn line is filtered at this level");
    expect(lines).toEqual([]);
    const security = vi.spyOn(quiet, "security");
    load({ logger: quiet });
    expect(security).toHaveBeenCalledTimes(1);
    expect(security.mock.calls[0]?.[0]).toBe("warn");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "warn",
      component: "env",
      message:
        "No trusted proxy is configured: the client address is unknown, so every per-address rate limit is shared by all clients.",
    });
    expect(JSON.stringify(lines)).not.toContain("example.test");
    expect(JSON.stringify(lines)).not.toContain("canary");
  });

  it.each([
    ["hops", { TRUSTED_PROXY_HOPS: "1" }],
    ["the single header", { TRUSTED_PROXY_HOPS: "0", TRUSTED_CLIENT_IP_HEADER: "X-Client-Addr" }],
  ])("does not warn in production when a proxy is trusted through %s", async (_label, proxy) => {
    stubValid({ NODE_ENV: "production", ...proxy });
    const { loadEnvAtStartup: load } = await import("./env");
    const { lines, logger } = capture();
    load({ logger });
    expect(lines).toEqual([]);
  });

  it("does not warn outside production", async () => {
    stubValid({ NODE_ENV: "development" });
    const { loadEnvAtStartup: load } = await import("./env");
    const { lines, logger } = capture();
    load({ logger });
    expect(lines).toEqual([]);
  });

  it("passes on an error that is not a validation error unchanged, and logs nothing", async () => {
    stubValid();
    const { loadEnvAtStartup: load, EnvValidationError: FreshError } = await import("./env");
    const { getLogLevel } = await import("./logger");
    const { lines, logger } = capture();
    // The one other error `getEnv` can throw: its browser guard.
    vi.stubGlobal("window", {});
    let thrown: unknown;
    try {
      load({ logger });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(FreshError);
    expect((thrown as Error).message).toContain("server-only");
    expect(lines).toEqual([]);
    expect(getLogLevel()).toBe("info");
  });

  describe("LOG_LEVEL reaches the process-wide logger", () => {
    /** Lines the process-wide logger writes to stdout while `action` runs. */
    function stdoutLines(action: () => void): Record<string, unknown>[] {
      const chunks: string[] = [];
      const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        chunks.push(String(chunk));
        return true;
      });
      try {
        action();
      } finally {
        write.mockRestore();
      }
      return chunks
        .join("")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    it.each(["debug", "info", "warn", "error"] as const)(
      "sets the level %s after a successful validation",
      async (level) => {
        stubValid({ LOG_LEVEL: level });
        const { loadEnvAtStartup: load } = await import("./env");
        const { getLogLevel, logger: processLogger } = await import("./logger");
        expect(getLogLevel()).toBe("info");
        expect(load({ logger: capture().logger }).logLevel).toBe(level);
        expect(getLogLevel()).toBe(level);
        // The level acts on the logger every module shares, and on a child of it.
        const written = stdoutLines(() => {
          processLogger.debug("d");
          processLogger.info("i");
          processLogger.child({ requestId: "req-12345678" }).warn("w");
          processLogger.error("e");
        });
        const all = ["debug", "info", "warn", "error"];
        expect(written.map((line) => line.level)).toEqual(all.slice(all.indexOf(level)));
      },
    );

    it("keeps the default level info when LOG_LEVEL is not set", async () => {
      stubValid();
      const { loadEnvAtStartup: load } = await import("./env");
      const { getLogLevel } = await import("./logger");
      load({ logger: capture().logger });
      expect(getLogLevel()).toBe("info");
    });

    it("leaves the level alone when the validation fails, so the error line is written", async () => {
      stubValid({ LOG_LEVEL: "error", APP_URL: undefined });
      const { loadEnvAtStartup: load, EnvValidationError: FreshError } = await import("./env");
      const { getLogLevel } = await import("./logger");
      let thrown: unknown;
      const written = stdoutLines(() => {
        try {
          load();
        } catch (error) {
          thrown = error;
        }
      });
      expect(thrown).toBeInstanceOf(FreshError);
      expect(getLogLevel()).toBe("info");
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        level: "error",
        issues: [{ variable: "APP_URL", rule: ENV_RULES.required }],
      });
    });

    // SR-01 requires the warning at start. It goes through `security("warn", ...)`, which no
    // level filters; every later `warn` line is dropped as configured.
    it("writes the SR-01 warning even with LOG_LEVEL=error, and only then applies the level", async () => {
      stubValid({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "0", LOG_LEVEL: "error" });
      const { loadEnvAtStartup: load } = await import("./env");
      const { getLogLevel, logger: processLogger } = await import("./logger");
      const written = stdoutLines(() => {
        load();
      });
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ level: "warn", component: "env" });
      expect(String(written[0]?.message)).toContain("every per-address rate limit is shared");
      expect(getLogLevel()).toBe("error");
      expect(stdoutLines(() => processLogger.warn("after the start"))).toEqual([]);
    });
  });
});
