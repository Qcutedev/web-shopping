import { afterEach, describe, expect, it, vi } from "vitest";

import { assertClientAddressConfig } from "./client-address";
import {
  DEFAULT_PAYMENT_TIMEOUT_MINUTES,
  ENV_RULES,
  type EnvIssue,
  type EnvSource,
  EnvValidationError,
  loadEnvAtStartup,
  MAX_PAYMENT_TIMEOUT_MINUTES,
  parseEnv,
  PAYMENT_SWEEP_INTERVAL_MS,
  readDatabaseUrl,
} from "./env";
import { assertSameOrigin } from "./http";
import { createLogger } from "./logger";

// Made-up values. Each is unmistakable, so a test can assert that none of it reaches a message.
const DATABASE_URL = "postgresql://shop_app:Zq7canaryPw@db.example.test:5432/shop";
const APP_URL = "https://shop.example.test";

/** A valid development environment; a case overrides or removes what it is about. */
function source(overrides: Record<string, string | undefined> = {}): EnvSource {
  return { NODE_ENV: "development", APP_URL, DATABASE_URL, ...overrides };
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
  vi.resetModules();
});

describe("parseEnv: a valid environment", () => {
  it("returns the configuration with the documented defaults", () => {
    expect(parseEnv(source())).toEqual({
      nodeEnv: "development",
      appUrl: APP_URL,
      appOrigin: APP_URL,
      databaseUrl: DATABASE_URL,
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
        "- DATABASE_URL_TEST must not be set when NODE_ENV=production",
        "- TRUSTED_PROXY_HOPS must be set explicitly when NODE_ENV=production",
      ].join("\n"),
    );
  });

  it("names an empty environment's two required variables", () => {
    expect(issuesOf({})).toEqual([
      { variable: "APP_URL", rule: ENV_RULES.required },
      { variable: "DATABASE_URL", rule: ENV_RULES.required },
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
      "TRUSTED_PROXY_HOPS",
      "TRUSTED_CLIENT_IP_HEADER",
      "PAYMENT_TIMEOUT_MINUTES",
      "LOG_LEVEL",
    ]);
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
      DATABASE_URL_TEST: undefined,
      TRUSTED_PROXY_HOPS: undefined,
      TRUSTED_CLIENT_IP_HEADER: undefined,
      PAYMENT_TIMEOUT_MINUTES: undefined,
      LOG_LEVEL: undefined,
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

  it("is exported for the start-up hook", () => {
    expect(typeof loadEnvAtStartup).toBe("function");
  });
});
