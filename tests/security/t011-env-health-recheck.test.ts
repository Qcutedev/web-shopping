/**
 * Independent re-check of SEC-009 on the committed code of T-011 (commit ff4a567):
 * `src/server/env.ts`, `src/instrumentation.ts`, and the health check `src/server/health.ts`.
 * Owner: security agent.
 *
 *   it(...)        behaviour that was checked on 2026-10-12 and holds. A failure is a regression.
 *   it.fails(...)  an OPEN finding (SEC-025, SEC-026). The body asserts the secure behaviour, so
 *                  the test is reported as an expected failure while the flaw exists and turns
 *                  red when the code is fixed. The owner of the code (devops) may then change
 *                  `it.fails` to `it` and nothing else; the security agent re-checks before the
 *                  finding is closed.
 *
 * Nobody but the security agent may edit an assertion or a threshold here, or skip or delete a
 * case.
 *
 * Every connection string below is invented, except the two placeholder passwords, which are
 * the published throwaway values of `.env.example` and `docker-compose.yml` and are not secrets.
 * This file may not import the database driver; that the driver decodes the forms of SEC-025
 * was checked once by hand against the installed `pg-connection-string` 2.14.1 and `pg` 8.23.1
 * and is recorded in docs/SECURITY.md. Nothing here starts a server or opens a connection.
 *
 * Part of `pnpm test` (project "security"). Run alone with:
 *   pnpm exec vitest run --project security
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "../../src/instrumentation";
import {
  ENV_RULES,
  EnvValidationError,
  loadEnvAtStartup,
  parseEnv,
  readDatabaseUrl,
} from "../../src/server/env";
import { createHealthCheck } from "../../src/server/health";
import { createLogger } from "../../src/server/logger";

const DEV_PLACEHOLDER = "local_dev_only_not_a_secret";
const TEST_PLACEHOLDER = "local_test_only_not_a_secret";
/** Stands for a real password. If it shows up in an error or a log line, a value leaked. */
const REAL = "QZXVrealpassword";
const HOST = "qzxvdb.internal";

const url = (password: string, rest = ""): string =>
  `postgresql://marketplace:${password}@${HOST}:5432/marketplace${rest}`;

/** A production environment that is valid except for what a case changes. */
function production(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    APP_URL: "https://shop.example",
    DATABASE_URL: url(REAL),
    TRUSTED_PROXY_HOPS: "0",
    ...overrides,
  };
}

function refusal(source: Record<string, string | undefined>): EnvValidationError {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error("parseEnv accepted the environment");
}

/** Variable names and rules of a refusal, and proof that it carries no value. */
function issuesOf(source: Record<string, string | undefined>): string[] {
  const error = refusal(source);
  const everything = `${error.message}\n${String(error.stack)}\n${JSON.stringify(error.issues)}`;
  // The values that can be secrets: a connection string, in whole, and a password variable.
  for (const name of ["DATABASE_URL", "DATABASE_URL_TEST", "PGPASSWORD"]) {
    const value = source[name];
    if (value !== undefined && value.length >= 8) expect(everything, name).not.toContain(value);
  }
  expect(everything).not.toContain("postgres");
  expect(everything).not.toContain(DEV_PLACEHOLDER);
  expect(everything).not.toContain(TEST_PLACEHOLDER);
  expect(everything).not.toContain(REAL);
  expect(everything).not.toContain(HOST);
  return error.issues.map((issue) => `${issue.variable}: ${issue.rule}`);
}

const PLACEHOLDER_ISSUE = `DATABASE_URL: ${ENV_RULES.databaseUrlPlaceholder}`;
const TEST_URL_ISSUE = `DATABASE_URL_TEST: ${ENV_RULES.databaseUrlTestInProduction}`;

describe("SEC-009 re-check: production refuses the local set-up", () => {
  it("the base environment of these cases is accepted, so a refusal below is the rule under test", () => {
    expect(parseEnv(production()).databaseUrl).toBe(url(REAL));
    expect(readDatabaseUrl(production())).toBe(url(REAL));
  });

  it("each published placeholder password is refused as written, wherever it stands in the URL", () => {
    for (const placeholder of [DEV_PLACEHOLDER, TEST_PLACEHOLDER]) {
      const urls = [
        // The two lines of `.env.example`, as copied.
        `postgresql://marketplace:${placeholder}@127.0.0.1:5432/marketplace_dev?schema=public`,
        `postgresql://marketplace:${placeholder}@127.0.0.1:5433/marketplace_test?schema=public`,
        url(placeholder),
        `postgres://marketplace:${placeholder}@${HOST}/marketplace`,
        url(REAL, `?password=${placeholder}`),
        `postgresql://marketplace@${HOST}/marketplace?password=${placeholder}&schema=public`,
        url(`${placeholder}${REAL}`),
        url(`${REAL}${placeholder}`),
        `postgresql://${placeholder}:${REAL}@${HOST}/marketplace`,
      ];
      for (const candidate of urls) {
        expect(issuesOf(production({ DATABASE_URL: candidate }))).toEqual([PLACEHOLDER_ISSUE]);
        expect(() => readDatabaseUrl(production({ DATABASE_URL: candidate }))).toThrow(
          EnvValidationError,
        );
      }
    }
  });

  it("DATABASE_URL_TEST is refused in production whatever it holds, and an empty one is not set", () => {
    for (const value of [
      url(TEST_PLACEHOLDER),
      url(REAL),
      "postgresql://127.0.0.1:5433/x",
      "x",
      " ",
      "0",
    ]) {
      expect(issuesOf(production({ DATABASE_URL_TEST: value }))).toEqual([TEST_URL_ISSUE]);
    }
    expect(parseEnv(production({ DATABASE_URL_TEST: "" })).nodeEnv).toBe("production");
    expect(parseEnv(production({ DATABASE_URL_TEST: undefined })).nodeEnv).toBe("production");
    // Both faults of a copied `.env.example` are reported together.
    expect(
      issuesOf(
        production({
          DATABASE_URL: url(DEV_PLACEHOLDER),
          DATABASE_URL_TEST: url(TEST_PLACEHOLDER),
        }),
      ),
    ).toEqual([PLACEHOLDER_ISSUE, TEST_URL_ISSUE]);
  });

  it("the refusal cannot be avoided by misspelling NODE_ENV: an unknown value stops the start", () => {
    for (const nodeEnv of [
      "Production",
      "PRODUCTION",
      " production",
      "production ",
      "prod",
      "staging",
    ]) {
      const issues = issuesOf(
        production({ NODE_ENV: nodeEnv, DATABASE_URL: url(DEV_PLACEHOLDER) }),
      );
      expect(issues).toContain(`NODE_ENV: ${ENV_RULES.nodeEnv}`);
      expect(() =>
        readDatabaseUrl({ NODE_ENV: nodeEnv, DATABASE_URL: url(DEV_PLACEHOLDER) }),
      ).toThrow(EnvValidationError);
    }
  });

  it("outside production the local set-up is accepted: the rule is for NODE_ENV=production only", () => {
    // By design, and a limit of the control: a deployed host that runs `next dev` is not refused.
    for (const nodeEnv of ["development", "test", undefined, ""]) {
      const env = parseEnv({
        NODE_ENV: nodeEnv,
        APP_URL: "http://localhost:3000",
        DATABASE_URL: url(DEV_PLACEHOLDER),
        DATABASE_URL_TEST: url(TEST_PLACEHOLDER),
      });
      expect(env.nodeEnv).toBe(nodeEnv === "test" ? "test" : "development");
    }
  });

  it("the start-up log line names the variables and the rules and no value", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://shop.example");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
    vi.stubEnv("PAYMENT_TIMEOUT_MINUTES", "");
    vi.stubEnv("LOG_LEVEL", "");
    vi.stubEnv("DATABASE_URL", url(DEV_PLACEHOLDER));
    vi.stubEnv("DATABASE_URL_TEST", url(TEST_PLACEHOLDER));
    expect(() => loadEnvAtStartup({ logger: log })).toThrow(EnvValidationError);
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}") as { level?: string; issues?: unknown };
    expect(line.level).toBe("error");
    expect(line.issues).toEqual([
      { variable: "DATABASE_URL", rule: ENV_RULES.databaseUrlPlaceholder },
      { variable: "DATABASE_URL_TEST", rule: ENV_RULES.databaseUrlTestInProduction },
    ]);
    const raw = lines.join("\n");
    for (const value of [
      DEV_PLACEHOLDER,
      TEST_PLACEHOLDER,
      HOST,
      "postgresql://",
      "marketplace:",
    ]) {
      expect(raw).not.toContain(value);
    }
  });
});

describe("SEC-009 re-check: the start-up hook ends the process on a refused environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function stubProduction(databaseUrl: string): void {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://shop.example");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
    vi.stubEnv("PAYMENT_TIMEOUT_MINUTES", "");
    vi.stubEnv("LOG_LEVEL", "");
    vi.stubEnv("DATABASE_URL_TEST", "");
    vi.stubEnv("DATABASE_URL", databaseUrl);
  }

  it("a placeholder password in production: exit code 1, the exit requested, the error rethrown", async () => {
    stubProduction(url(DEV_PLACEHOLDER));
    const written: string[] = [];
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
      ...rest: unknown[]
    ) => {
      written.push(String(chunk));
      const callback = rest.find((item) => typeof item === "function") as (() => void) | undefined;
      callback?.();
      return true;
    }) as never);
    let thrown: unknown;
    try {
      await register();
    } catch (error) {
      thrown = error;
    }
    const exitCode = process.exitCode;
    const exitCalls = exit.mock.calls.map((call) => call[0]);
    write.mockRestore();
    exit.mockRestore();
    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect(exitCode).toBe(1);
    expect(exitCalls).toEqual([1]);
    const output = written.join("");
    expect(output).toContain("DATABASE_URL");
    expect(output).toContain(ENV_RULES.databaseUrlPlaceholder);
    expect(output).not.toContain(DEV_PLACEHOLDER);
    expect(output).not.toContain(HOST);
  });
});

// ---------------------------------------------------------------------------
// SEC-025 (OPEN, Low; code-review finding CR-46, confirmed). Owner of the code: devops.
// The placeholder check compares the raw text of DATABASE_URL. The driver decodes the URL before
// it uses the password, reads a `password` query parameter in preference to the one in front of
// the host, and falls back to PGPASSWORD when the URL has none.
// ---------------------------------------------------------------------------

describe("SEC-025 the placeholder check reads the raw text, not the password the driver will use", () => {
  /** Percent-encoded spellings of a password: every one decodes to exactly that password. */
  function spellings(password: string): string[] {
    const all = Array.from(
      password,
      (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
    ).join("");
    return [
      password.replace("_", "%5F"),
      password.replace("_", "%5f"),
      password.replaceAll("_", "%5F"),
      `%6C${password.slice(1)}`,
      `${password.slice(0, -1)}%74`,
      all,
    ];
  }

  it("each spelling below is the placeholder once decoded, and none contains it as written", () => {
    for (const placeholder of [DEV_PLACEHOLDER, TEST_PLACEHOLDER]) {
      for (const spelling of spellings(placeholder)) {
        expect(spelling).not.toContain(placeholder);
        expect(decodeURIComponent(new URL(url(spelling)).password)).toBe(placeholder);
      }
    }
  });

  it.fails("SEC-025 a percent-encoded placeholder password is refused in production", () => {
    for (const placeholder of [DEV_PLACEHOLDER, TEST_PLACEHOLDER]) {
      for (const spelling of spellings(placeholder)) {
        const source = production({ DATABASE_URL: url(spelling) });
        expect(() => parseEnv(source), spelling).toThrow(EnvValidationError);
        expect(() => readDatabaseUrl(source), spelling).toThrow(EnvValidationError);
      }
    }
  });

  it.fails(
    "SEC-025 a percent-encoded placeholder in the password query parameter is refused",
    () => {
      for (const placeholder of [DEV_PLACEHOLDER, TEST_PLACEHOLDER]) {
        for (const spelling of spellings(placeholder)) {
          for (const candidate of [
            `postgresql://marketplace@${HOST}/marketplace?password=${spelling}`,
            url(REAL, `?schema=public&password=${spelling}`),
          ]) {
            const source = production({ DATABASE_URL: candidate });
            expect(() => parseEnv(source), candidate).toThrow(EnvValidationError);
            expect(() => readDatabaseUrl(source), candidate).toThrow(EnvValidationError);
          }
        }
      }
    },
  );

  it.fails("SEC-025 a placeholder password supplied through PGPASSWORD is refused", () => {
    for (const placeholder of [DEV_PLACEHOLDER, TEST_PLACEHOLDER]) {
      const source = production({
        DATABASE_URL: `postgresql://marketplace@${HOST}:5432/marketplace`,
        PGPASSWORD: placeholder,
      });
      expect(() => parseEnv(source)).toThrow(EnvValidationError);
      expect(() => readDatabaseUrl(source)).toThrow(EnvValidationError);
    }
  });

  it("a real password is not refused for looking like the placeholder in part", () => {
    // What a fix must keep accepting: other passwords, also with escapes and an underscore.
    for (const password of [
      REAL,
      "local%5Fother",
      "p%40ss%3Aword",
      "local_dev",
      "not_a_secret_1",
    ]) {
      expect(parseEnv(production({ DATABASE_URL: url(password) })).nodeEnv).toBe("production");
    }
  });
});

// ---------------------------------------------------------------------------
// The health check (code-review finding CR-48). Owner of the code: devops.
// ---------------------------------------------------------------------------

describe("T-011 health check: what a caller can make it write", () => {
  function recording() {
    const lines: string[] = [];
    const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
    return { lines, log };
  }

  it("a failed check answers with the fixed body and logs no credential and no property of the error", async () => {
    const { lines, log } = recording();
    const failure = Object.assign(new Error(`connect failed for ${url(REAL)} password=${REAL}`), {
      code: "ECONNREFUSED",
      meta: { query: `SELECT ${REAL}` },
      clientVersion: REAL,
    });
    const check = createHealthCheck({ probe: () => Promise.reject(failure), logger: log });
    expect(await check({ requestId: "req_health_1" })).toEqual({
      status: "unavailable",
      database: "down",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(REAL);
    expect(lines[0]).not.toContain("meta");
    expect(lines[0]).not.toContain("stack");
    expect(lines[0]).toContain("ECONNREFUSED");
  });

  it("callers that arrive together share one probe", async () => {
    const { log } = recording();
    let probes = 0;
    const check = createHealthCheck({
      probe: () => {
        probes += 1;
        return new Promise((_, reject) => setTimeout(() => reject(new Error("down")), 20));
      },
      logger: log,
    });
    await Promise.all(Array.from({ length: 50 }, () => check()));
    expect(probes).toBe(1);
  });

  // SEC-026 (OPEN, Low). The endpoint is public and has no rate limit. While the database is
  // down, every request writes one error-level line: the probe is shared, the line is not, and a
  // probe that fails at once (a refused connection) is started again for the next request.
  it.fails(
    "SEC-026 an outage is logged once, not once for every caller of the public endpoint",
    async () => {
      const { lines, log } = recording();
      const check = createHealthCheck({
        probe: () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNREFUSED" })),
        logger: log,
        // The clock does not move: everything below happens within one instant of one outage.
        now: () => 1_000,
      });
      await Promise.all(Array.from({ length: 50 }, () => check()));
      for (let request = 0; request < 200; request += 1) await check();
      const errors = lines.filter(
        (line) => (JSON.parse(line) as { level: string }).level === "error",
      );
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors.length).toBeLessThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(2);
    },
  );
});
