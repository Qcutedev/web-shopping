/**
 * Seventh round, 2026-10-12: independent re-check of the fixes of SEC-025 and SEC-026 (commit
 * b123ef9, devops) and of SEC-027 and SEC-028 and the process-wide logger level (commit b40abf0,
 * backend-api). Owner: security agent.
 *
 *   it(...)        behaviour that was checked on 2026-10-12 and holds. A failure is a regression.
 *   it.fails(...)  an OPEN finding (SEC-029, SEC-030, SEC-031). The body asserts the secure
 *                  behaviour, so the test is reported as an expected failure while the flaw
 *                  exists and turns red when the code is fixed. The owner of the code may then
 *                  change `it.fails` to `it` and nothing else; the security agent re-checks
 *                  before the finding is closed.
 *
 * Nobody but the security agent may edit an assertion, a threshold, or a timeout here, or skip
 * or delete a case.
 *
 * Every connection string below is invented, except the two placeholder passwords, which are
 * the published throwaway values of `.env.example` and `docker-compose.yml` and are not secrets.
 * This file may not import the database driver (lint, architecture rule 7). `driverPassword`
 * below is a model of what the installed driver does with a connection string. It was compared
 * with the driver itself (`pg` 8.23.1, `pg-connection-string` 2.14.1, the class
 * `ConnectionParameters`) on 400,000 generated strings on 2026-10-12, in a scratch file that
 * was deleted afterwards, and agreed on every one. It must be compared again when the driver
 * changes. Nothing here starts a server or opens a connection.
 *
 * Part of `pnpm test` (project "security"). Run alone with:
 *   pnpm exec vitest run --project security
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ENV_RULES, EnvValidationError, parseEnv, readDatabaseUrl } from "../../src/server/env";
import {
  AppError,
  ERROR_STATUS,
  forbidden,
  JSON_STRING_NOT_WELL_FORMED_FIELD_CODE,
  requestBodyAborted,
} from "../../src/server/errors";
import { createHealthCheck, HEALTH_FAILURE_LOG_INTERVAL_MS } from "../../src/server/health";
import {
  errorResponse,
  MAX_JSON_BODY_LIMIT_BYTES,
  MAX_JSON_NESTING_DEPTH,
  readJsonBody,
} from "../../src/server/http";
import {
  createLogger,
  DEFAULT_LOG_LEVEL,
  getLogLevel,
  type Logger,
  logger as processLogger,
  setLogLevel,
} from "../../src/server/logger";
import { createRateLimiter, MemoryRateLimitStore, RATE_LIMITS } from "../../src/server/rate-limit";

const DEV_PLACEHOLDER = "local_dev_only_not_a_secret";
const TEST_PLACEHOLDER = "local_test_only_not_a_secret";
const PLACEHOLDERS: readonly string[] = [DEV_PLACEHOLDER, TEST_PLACEHOLDER];
/** Stands for a real password. If it shows up in an error or a log line, a value leaked. */
const REAL = "QZXVrealpassword";
const HOST = "qzxvdb.internal";
const MARKER = "QZXVMARKER";
const REQUEST_ID = "req_security_round_7";

/** Deterministic pseudo-random numbers in [0, 1), so a failure can be repeated. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type LogLine = Record<string, unknown>;

function recording(now?: () => Date): { lines: LogLine[]; raw: string[]; log: Logger } {
  const lines: LogLine[] = [];
  const raw: string[] = [];
  const log = createLogger({
    level: "debug",
    write: (line) => {
      raw.push(line);
      lines.push(JSON.parse(line) as LogLine);
    },
    ...(now === undefined ? {} : { now }),
  });
  return { lines, raw, log };
}

// ---------------------------------------------------------------------------
// SEC-025. Owner of the code: devops.
// ---------------------------------------------------------------------------

/**
 * The password the installed driver would authenticate with, `null` when it has none, and
 * `undefined` when it refuses the string (then no connection is made). A model of
 * `pg-connection-string` `parse` and of `val("password")` in `pg/lib/connection-parameters.js`;
 * see the file comment for how it was checked against the driver.
 */
function driverPassword(text: string, pgPassword?: string): string | null | undefined {
  try {
    let value = text;
    if (value.startsWith("/")) return pgPassword || null;
    // The driver re-encodes a string with a blank or a broken escape. After that only an escape
    // of two decimal digits is still decoded: `%63` is, `%5F` is not.
    if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(value)) {
      value = encodeURI(value).replace(/%25(\d\d)/g, "%$1");
    }
    let parsed: URL;
    try {
      parsed = new URL(value, "postgres://base");
    } catch {
      parsed = new URL(value.replace("@/", "@___DUMMY___/"), "postgres://base");
    }
    let fromQuery: string | undefined;
    for (const [key, entry] of parsed.searchParams.entries()) {
      if (key === "password") fromQuery = entry;
    }
    decodeURIComponent(parsed.username);
    const password = fromQuery || decodeURIComponent(parsed.password);
    decodeURIComponent(parsed.hostname.replace(/^\[(.+)\]$/, "$1"));
    const pathname = parsed.pathname.slice(1);
    if (pathname) decodeURI(pathname);
    return password || pgPassword || null;
  } catch {
    return undefined;
  }
}

interface Candidate {
  url: string;
  pgPassword?: string;
}

function production(candidate: Candidate): Record<string, string> {
  return {
    NODE_ENV: "production",
    APP_URL: "https://shop.example",
    DATABASE_URL: candidate.url,
    TRUSTED_PROXY_HOPS: "0",
    ...(candidate.pgPassword === undefined ? {} : { PGPASSWORD: candidate.pgPassword }),
  };
}

/** The refusals of `parseEnv` and `readDatabaseUrl`, or `undefined` for one that accepted. */
function refusals(candidate: Candidate): (EnvValidationError | undefined)[] {
  return [parseEnv, readDatabaseUrl].map((validate) => {
    try {
      validate(production(candidate));
    } catch (error) {
      if (error instanceof EnvValidationError) return error;
      throw error;
    }
    return undefined;
  });
}

/**
 * Requires both validators to refuse, by a fixed rule and without a value. The rule is one of
 * the two placeholder rules, or, for a string that the platform's URL parser does not accept
 * although the driver finds a way to read it (an empty host), the rule that it is not a URL.
 */
function expectRefused(candidate: Candidate): void {
  const label = JSON.stringify(candidate);
  for (const error of refusals(candidate)) {
    expect(error, label).toBeInstanceOf(EnvValidationError);
    if (error === undefined) continue;
    const named = error.issues.filter(
      (issue) =>
        (issue.variable === "DATABASE_URL" && issue.rule === ENV_RULES.databaseUrlPlaceholder) ||
        (issue.variable === "DATABASE_URL" && issue.rule === ENV_RULES.databaseUrl) ||
        (issue.variable === "PGPASSWORD" && issue.rule === ENV_RULES.pgPasswordPlaceholder),
    );
    expect(named.length, label).toBeGreaterThanOrEqual(1);
    const everything = `${error.message}\n${String(error.stack)}\n${JSON.stringify(error.issues)}`;
    for (const placeholder of PLACEHOLDERS) expect(everything).not.toContain(placeholder);
    expect(everything).not.toContain(HOST);
    const said = `${error.message}
${JSON.stringify(error.issues)}`;
    expect(said).not.toContain("://m");
    expect(said).not.toContain("@");
    expect(said).not.toContain("?");
    expect(everything).not.toContain(REAL);
    if (candidate.url.length >= 8) expect(everything).not.toContain(candidate.url);
    if (candidate.pgPassword !== undefined && candidate.pgPassword.length >= 8) {
      expect(everything).not.toContain(candidate.pgPassword);
    }
  }
}

const authority = (password: string, rest = ""): string =>
  `postgresql://marketplace:${password}@${HOST}:5432/marketplace${rest}`;

const hex = (character: string): string => character.charCodeAt(0).toString(16).padStart(2, "0");

/** One hostile spelling of `placeholder`: escapes in every form, breaks, and near misses. */
function spell(placeholder: string, random: () => number): string {
  let out = "";
  for (const character of placeholder) {
    const code = hex(character);
    const roll = random();
    if (roll < 0.55) out += character;
    else if (roll < 0.7) out += `%${code.toUpperCase()}`;
    else if (roll < 0.8) out += `%${code}`;
    else if (roll < 0.84) out += `%${code.charAt(0).toUpperCase()}${code.charAt(1)}`;
    else if (roll < 0.87) out += `%25${code}`;
    else if (roll < 0.9) out += `\t${character}`;
    else if (roll < 0.92) out += `\n${character}`;
    else if (roll < 0.94) out += `\r%${code}`;
    else if (roll < 0.95) out += `%${code.charAt(0)}\t${code.charAt(1)}`;
    else if (roll < 0.96) out += `%\n${code}`;
    else if (roll < 0.97) out += `%u00${code}`;
    else if (roll < 0.98) out += `+${character}`;
    else if (roll < 0.99) out += `\\u00${code}`;
    else out += `%${character}`;
  }
  return out;
}

/** Text put elsewhere in the URL. Most of it makes the driver re-encode the whole string. */
const ELSEWHERE = ["", "", "", " ", "%", "%zz", "%5", "%G1", "%1G", "%%", "\t", "%20", "%E0%A4%A"];

function generated(placeholder: string, random: () => number): Candidate {
  const spelled = spell(placeholder, random);
  const extra = ELSEWHERE[Math.floor(random() * ELSEWHERE.length)] ?? "";
  switch (Math.floor(random() * 13)) {
    case 0:
      return { url: `postgresql://marketplace:${spelled}@${HOST}:5432/market${extra}place` };
    case 1:
      return { url: `postgresql://marketplace@${HOST}/marketplace?password=${spelled}&x=${extra}` };
    case 2:
      return { url: `postgres://marketplace:real@${HOST}/db?x=${extra}&password=${spelled}` };
    case 3:
      return { url: `postgresql://marketplace:real@${HOST}/db?p%61ssword=${spelled}${extra}` };
    case 4:
      return { url: `postgresql://marketplace:real@${HOST}/db?pass\tword=${spelled}&y=${extra}` };
    case 5:
      return { url: `postgresql://marketplace@${HOST}/db${extra}`, pgPassword: spelled };
    case 6:
      return { url: `postgresql://marketplace:@${HOST}/db?a=${extra}`, pgPassword: placeholder };
    case 7:
      return { url: ` \tpostgresql://marketplace:${spelled}@${HOST}/db${extra} ` };
    case 8:
      return { url: `postgresql://${spelled}:${spelled}@${HOST}/db?${extra}` };
    case 9:
      return { url: `postgresql://marketplace:${spelled}@/db?host=/var/run/pg&z=${extra}` };
    case 10:
      return { url: `postgresql://m:x@${HOST}/db?password=${spelled}&password=&q=${extra}` };
    case 11:
      return { url: `postgresql://m:${spelled}@${HOST}/db?password=&options=${extra}` };
    default:
      return { url: `postgresql://m:x@${HOST}/db?PASSWORD=x&password=${spelled}${extra}` };
  }
}

describe("SEC-025 re-check: the password the driver will use is what is judged", () => {
  it("every form that reaches the driver as a placeholder is refused, by name and rule only", () => {
    const forms: Candidate[] = [];
    for (const placeholder of PLACEHOLDERS) {
      const all = Array.from(placeholder, (character) => `%${hex(character)}`).join("");
      const upper = Array.from(placeholder, (character) => `%${hex(character).toUpperCase()}`);
      const half = Array.from(placeholder, (character, index) =>
        index % 2 === 0 ? character : `%${hex(character)}`,
      ).join("");
      const tail = placeholder.slice(5);
      forms.push(
        // In front of the host: whole, upper-case and mixed-case hexadecimal, in part.
        { url: authority(all) },
        { url: authority(upper.join("")) },
        { url: authority(placeholder.replaceAll("_", "%5f")) },
        { url: authority(placeholder.replace("_", "%5F").replace("o", "%6f")) },
        { url: authority(half) },
        // A tab or a line break that the URL parser drops, also inside an escape's neighbourhood.
        { url: authority(`local\t${tail}`) },
        { url: authority(`local\n${tail}`) },
        { url: authority(`local\r\n${tail}`) },
        { url: authority(`loca\tl${tail.replace("_", "%5F")}`) },
        { url: `\n${authority(placeholder.replace("_", "%5F"))}\t` },
        // An empty host, which the driver reads by putting a host in: refused as "not a URL".
        { url: `postgresql://marketplace:${half}@/marketplace?host=/var/run/postgresql` },
        // The `password` query parameter, which the driver prefers to the one before the host.
        { url: authority(REAL, `?password=${all}`) },
        { url: authority(REAL, `?schema=public&password=${half}`) },
        { url: authority(REAL, `?password=${REAL}&password=${half}`) },
        { url: authority(REAL, `?p%61ssword=${placeholder.replace("_", "%5F")}`) },
        { url: authority(REAL, `?pass\tword=local\n${tail}`) },
        { url: authority(REAL, `?%70%61%73%73%77%6f%72%64=${all}`) },
        { url: `postgresql://marketplace@${HOST}/marketplace?password=${half}` },
        // A broken escape elsewhere: the driver re-encodes the string and still decodes an
        // escape of two decimal digits. (c is %63, a is %61, e is %65, t is %74.)
        { url: authority(placeholder.replace("c", "%63"), "?x=%zz") },
        { url: authority(placeholder.replaceAll("e", "%65").replace("a", "%61"), "?x=%") },
        { url: authority(placeholder.replace("t", "%74"), "?application_name=my app") },
        { url: authority(REAL, `?x=%5&password=${placeholder.replace("c", "%63")}`) },
        // No password in the URL: the driver takes PGPASSWORD as written.
        { url: `postgresql://marketplace@${HOST}:5432/marketplace`, pgPassword: placeholder },
        { url: `postgresql://marketplace:@${HOST}:5432/marketplace`, pgPassword: placeholder },
        { url: `postgresql://${HOST}/marketplace?user=marketplace`, pgPassword: placeholder },
        { url: authority("", "?password="), pgPassword: placeholder },
      );
      for (const form of forms) {
        expect(PLACEHOLDERS, JSON.stringify(form)).toContain(
          driverPassword(form.url, form.pgPassword),
        );
      }
    }
    expect(forms).toHaveLength(52);
    for (const form of forms) expectRefused(form);
  });

  it(
    "30,000 generated spellings: none that the driver reads as a placeholder is accepted",
    { timeout: 60_000 },
    () => {
      const random = seeded(20_261_012);
      let reached = 0;
      const accepted: string[] = [];
      for (let round = 0; round < 30_000; round += 1) {
        const candidate = generated(PLACEHOLDERS[round % 2] ?? DEV_PLACEHOLDER, random);
        const password = driverPassword(candidate.url, candidate.pgPassword);
        if (typeof password !== "string" || !PLACEHOLDERS.includes(password)) continue;
        reached += 1;
        if (refusals(candidate).some((error) => error === undefined)) {
          accepted.push(JSON.stringify(candidate));
        } else if (reached % 50 === 0) {
          expectRefused(candidate);
        }
      }
      // The run is not empty: thousands of the spellings do reach the driver as a placeholder.
      expect(reached).toBeGreaterThan(2_000);
      expect(accepted).toEqual([]);
    },
  );

  it("the deviation from the written remediation: a broken escape is decoded around, not refused", () => {
    // What devops reported: with a broken escape in the string the driver still decodes
    // well-formed escapes, so refusing on the broken one is not needed and decoding all of
    // them is. Confirmed against the driver, with one correction: after its re-encoding the
    // driver decodes only escapes of two decimal digits.
    const stillDecoded = authority(DEV_PLACEHOLDER.replace("c", "%63"), "?x=%zz");
    expect(driverPassword(stillDecoded)).toBe(DEV_PLACEHOLDER);
    expectRefused({ url: stillDecoded });
    // `%5F` beside a broken escape stays the five characters `%5F` for the driver, so this is
    // not the placeholder. The check refuses it all the same: the safe direction, and no
    // password that is not built from a placeholder is caught by it.
    const notDecoded = authority(DEV_PLACEHOLDER.replace("_", "%5F"), "?x=%zz");
    expect(driverPassword(notDecoded)).toBe(DEV_PLACEHOLDER.replace("_", "%5F"));
    expectRefused({ url: notDecoded });
    // The same direction: a placeholder encoded twice in the `password` query parameter is the
    // text `local%5Fdev...` for the driver, and is refused, because the parameter is decoded
    // once by the URL parser and once more by the check.
    const twice = authority(REAL, `?password=${DEV_PLACEHOLDER.replace("_", "%255F")}`);
    expect(driverPassword(twice)).toBe(DEV_PLACEHOLDER.replace("_", "%5F"));
    expectRefused({ url: twice });
    // Nothing is thrown but the refusal, whatever is broken: no URIError escapes the check.
    for (const broken of ["%", "%%", "%z", "%5", "%E0%A4%A", "%C0%AF", "%FF"]) {
      const candidate = { url: authority(`${DEV_PLACEHOLDER}${broken}`, `?x=${broken}`) };
      expectRefused(candidate);
      expect(parseEnv(production({ url: authority(`${REAL}${broken}`, `?x=${broken}`) }))).toEqual(
        expect.objectContaining({ nodeEnv: "production" }),
      );
    }
  });

  it("a password that is not a placeholder for the driver is not refused for resembling one", () => {
    const tail = DEV_PLACEHOLDER.slice(5);
    const real: Candidate[] = [
      // Encoded twice: the driver decodes once and gets `local%5Fdev...`.
      { url: authority(DEV_PLACEHOLDER.replace("_", "%255F")) },
      // Forms that are escapes elsewhere and plain text in a URL.
      { url: authority(`local+${tail.slice(1)}`) },
      { url: authority(`local\\u005f${tail.slice(1)}`) },
      { url: authority(`local%u005F${tail.slice(1)}`) },
      // Near misses: another letter case, one character short, another separator, a part.
      { url: authority(`L${DEV_PLACEHOLDER.slice(1)}`) },
      { url: authority(DEV_PLACEHOLDER.toUpperCase()) },
      { url: authority(DEV_PLACEHOLDER.slice(0, -1)) },
      { url: authority(DEV_PLACEHOLDER.slice(1)) },
      { url: authority(DEV_PLACEHOLDER.replace("_", "-")) },
      { url: authority(DEV_PLACEHOLDER.replace("_", "＿")) },
      { url: authority("local_dev_only") },
      { url: authority("not_a_secret") },
      { url: authority("local_prod_only_not_a_secret") },
      { url: authority("p%40ss%3Aword%2F%25") },
      // PGPASSWORD holding something else, with and without a password in the URL.
      { url: `postgresql://marketplace@${HOST}/marketplace`, pgPassword: REAL },
      { url: `postgresql://marketplace@${HOST}/marketplace`, pgPassword: "local_dev_only" },
      { url: authority(REAL), pgPassword: DEV_PLACEHOLDER.replace("_", "%5F") },
    ];
    for (const candidate of real) {
      const label = JSON.stringify(candidate);
      expect(PLACEHOLDERS, label).not.toContain(
        driverPassword(candidate.url, candidate.pgPassword),
      );
      expect(refusals(candidate), label).toEqual([undefined, undefined]);
    }
  });

  it("outside production none of it is refused, so the refusals above come from the rule", () => {
    for (const nodeEnv of ["development", "test"]) {
      const databaseUrl = authority(DEV_PLACEHOLDER.replace("_", "%5F"));
      const source = {
        ...production({ url: databaseUrl }),
        NODE_ENV: nodeEnv,
        PGPASSWORD: TEST_PLACEHOLDER,
      };
      expect(parseEnv(source).nodeEnv).toBe(nodeEnv);
      expect(readDatabaseUrl(source)).toBe(databaseUrl);
    }
  });
});

// ---------------------------------------------------------------------------
// SEC-026. Owner of the code: devops.
// ---------------------------------------------------------------------------

type ProbeMode = "ok" | "fail" | "hang";

function healthHarness(options: { timeoutMs?: number; abandonAfterMs?: number } = {}) {
  const state: { clock: number; mode: ProbeMode; failure: unknown; probes: number } = {
    clock: 0,
    mode: "fail",
    failure: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    probes: 0,
  };
  const { lines, raw, log } = recording(() => new Date(state.clock));
  const check = createHealthCheck({
    probe: () => {
      state.probes += 1;
      if (state.mode === "ok") return Promise.resolve();
      if (state.mode === "fail") return Promise.reject(state.failure);
      return new Promise<never>(() => undefined);
    },
    logger: log,
    now: () => state.clock,
    ...options,
  });
  return { state, lines, raw, check };
}

const levelOf = (line: LogLine): string => String(line.level);
const timeOf = (line: LogLine): number => Date.parse(String(line.timestamp));

describe("SEC-026 re-check: the log reports the outage, not the caller", () => {
  const DOWN = { status: "unavailable", database: "down" };
  const UP = { status: "ok", database: "up" };

  it("5,000 checks against a database that flaps: one error line per interval at most, and no failed check uncounted", async () => {
    const { state, lines, check } = healthHarness();
    const random = seeded(26);
    let failed = 0;
    const issued = new Set<string>();
    for (let step = 0; step < 5_000; step += 1) {
      state.clock += 137;
      state.mode = random() < 0.7 ? "fail" : "ok";
      const requestId = `req_flap_${step}`;
      issued.add(requestId);
      const report = await check({ requestId });
      expect(report).toEqual(state.mode === "fail" ? DOWN : UP);
      if (state.mode === "fail") failed += 1;
    }
    // One more failure after a quiet interval, so that everything counted so far is reported.
    state.clock += HEALTH_FAILURE_LOG_INTERVAL_MS;
    state.mode = "fail";
    expect(await check({ requestId: "req_flap_last" })).toEqual(DOWN);
    failed += 1;
    issued.add("req_flap_last");

    const errors = lines.filter((line) => levelOf(line) === "error");
    const infos = lines.filter((line) => levelOf(line) === "info");
    expect(errors.length + infos.length).toBe(lines.length);
    // About eleven and a half minutes of outage: 24 intervals.
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBeLessThanOrEqual(25);
    for (let index = 1; index < errors.length; index += 1) {
      const gap = timeOf(errors[index] ?? {}) - timeOf(errors[index - 1] ?? {});
      expect(gap).toBeGreaterThanOrEqual(HEALTH_FAILURE_LOG_INTERVAL_MS);
    }
    // A recovery line only after a failure line, and one per failure line at most.
    let announced = false;
    for (const line of lines) {
      if (levelOf(line) === "error") announced = true;
      else {
        expect(announced).toBe(true);
        announced = false;
      }
    }
    // Every failed check is in exactly one count.
    const counted = lines.reduce((sum, line) => sum + Number(line.failedChecks), 0);
    expect(counted).toBe(failed);
    // A line holds the fixed fields and a request id the server issued; nothing else.
    const allowed = new Set([
      "component",
      "reason",
      "errorName",
      "errorCode",
      "errorMessage",
      "failedChecks",
      "level",
      "timestamp",
      "message",
      "requestId",
    ]);
    for (const line of lines) {
      for (const key of Object.keys(line)) expect(allowed.has(key), key).toBe(true);
      expect(issued.has(String(line.requestId))).toBe(true);
    }
  });

  it("the single limit for all reasons: a change of reason inside the interval waits for the next line", async () => {
    // Accepted deviation. What is lost is stated here so that a change of it is noticed: the
    // reason and the error of a failure that falls inside the interval are not written; the
    // check is counted, and the next line carries the reason that holds then.
    const { state, lines, check } = healthHarness({ timeoutMs: 5, abandonAfterMs: 500 });
    state.mode = "hang";
    expect(await check({ requestId: "req_slow" })).toEqual(DOWN);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reason: "timeout", failedChecks: 1, requestId: "req_slow" });

    state.mode = "fail";
    state.clock = 1_000;
    expect(await check({ requestId: "req_refused_1" })).toEqual(DOWN);
    state.clock = HEALTH_FAILURE_LOG_INTERVAL_MS - 1;
    expect(await check({ requestId: "req_refused_2" })).toEqual(DOWN);
    expect(lines).toHaveLength(1);

    state.clock = HEALTH_FAILURE_LOG_INTERVAL_MS;
    expect(await check({ requestId: "req_refused_3" })).toEqual(DOWN);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      level: "error",
      reason: "error",
      errorCode: "ECONNREFUSED",
      failedChecks: 3,
      // The first of the checks the line reports; the other two ids are in no line.
      requestId: "req_refused_1",
    });
    const text = JSON.stringify(lines);
    expect(text).not.toContain("req_refused_2");
    expect(text).not.toContain("req_refused_3");
  });

  it("300 callers of one hanging probe: one line, one probe, and every caller is counted later", async () => {
    const { state, lines, check } = healthHarness({ timeoutMs: 10 });
    state.mode = "hang";
    const reports = await Promise.all(
      Array.from({ length: 300 }, (_, index) => check({ requestId: `req_hang_${index}` })),
    );
    expect(reports.every((report) => report.status === "unavailable")).toBe(true);
    expect(state.probes).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reason: "timeout", failedChecks: 1 });
    // The probe is abandoned after its own interval; the next failure line counts the other 299.
    state.clock = HEALTH_FAILURE_LOG_INTERVAL_MS;
    state.mode = "fail";
    expect(await check()).toEqual(DOWN);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ reason: "error", failedChecks: 300 });
  });

  it("the answer does not depend on the log: a logger that throws changes nothing a caller sees", async () => {
    const broken = (): never => {
      throw new Error(MARKER);
    };
    const hostile: Logger = {
      debug: broken,
      info: broken,
      warn: broken,
      error: broken,
      child: broken,
    };
    let mode: ProbeMode = "fail";
    const check = createHealthCheck({
      probe: () => {
        if (mode === "ok") return Promise.resolve();
        if (mode === "fail") return Promise.reject(new Error(MARKER));
        return new Promise<never>(() => undefined);
      },
      logger: hostile,
      timeoutMs: 5,
      abandonAfterMs: 0,
    });
    expect(await check({ requestId: "req_a" })).toEqual(DOWN);
    mode = "ok";
    expect(await check({ requestId: "req_b" })).toEqual(UP);
    mode = "hang";
    expect(await check({ requestId: "req_c" })).toEqual(DOWN);
    // The two public bodies are the whole answer, and they are the same frozen objects.
    mode = "fail";
    const first = await check();
    const second = await check();
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.keys(first)).toEqual(["status", "database"]);
  });

  it("a caller cannot write a line while the database answers, and none without a failure", async () => {
    const { state, lines, check } = healthHarness();
    state.mode = "ok";
    await Promise.all(Array.from({ length: 500 }, () => check({ requestId: MARKER })));
    for (let request = 0; request < 500; request += 1) await check({ requestId: MARKER });
    expect(lines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SEC-027. Owner of the code: backend-api.
// ---------------------------------------------------------------------------

const NAME_FORM = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const CODE_FORM = /^[A-Za-z0-9_.-]{1,64}$/;

/** The one line `errorResponse` writes for a body whose source failed with `source`. */
function abortedLine(source: unknown): { line: LogLine; raw: string; status: number } {
  const { lines, raw, log } = recording();
  const response = errorResponse(requestBodyAborted(source), {
    requestId: REQUEST_ID,
    logger: log,
  });
  expect(lines).toHaveLength(1);
  return { line: lines[0] ?? {}, raw: raw.join("\n"), status: response.status };
}

describe("SEC-027 re-check: a label is written only in the form of a class name or an error code", () => {
  it("20,000 generated labels: whatever is written is the label itself and has the form", () => {
    const alphabet = [
      ..."abcXYZ019_$.-",
      ..." \t\n\r@:/\\\"'<>{}[]()=+,;%&?#|~`^*!",
      "ก",
      "ส",
      "é",
      " ",
      "‮",
      "\u0000",
      "\ud83d",
      "\ude00",
    ];
    const random = seeded(27);
    let written = 0;
    for (let round = 0; round < 20_000; round += 1) {
      const length = Math.floor(random() * 70);
      let label = "";
      // Mostly characters of the form, so that both outcomes are frequent.
      for (let index = 0; index < length; index += 1) {
        const pool = random() < 0.9 ? 13 : alphabet.length;
        label += alphabet[Math.floor(random() * pool)] ?? "";
      }
      const { line } = abortedLine({ name: label, code: label });
      if ("sourceError" in line) {
        written += 1;
        expect(line.sourceError).toBe(label);
        expect(label).toMatch(NAME_FORM);
      } else expect(label).not.toMatch(NAME_FORM);
      if ("sourceCode" in line) {
        written += 1;
        expect(line.sourceCode).toBe(label);
        expect(label).toMatch(CODE_FORM);
      } else expect(label).not.toMatch(CODE_FORM);
    }
    expect(written).toBeGreaterThan(1_000);
  });

  it("prose, an address, a phone number with blanks, and pieces of a body never reach the line", () => {
    const hostile = [
      `${MARKER} 99/1 Sukhumvit Road`,
      `call 081 234 5678 ${MARKER}`,
      `${MARKER}@example.com`,
      `{"password":"${MARKER}"}`,
      `TypeError\n{"level":"error","message":"${MARKER}"}`,
      `TypeError\n`,
      `\nTypeError`,
      ` ${MARKER}`,
      `${MARKER} `,
      `TypeError ${MARKER}`,
      `${MARKER}\u0000`,
      `TypeกError${MARKER}`,
      `password=${MARKER}`,
      `https://user:${MARKER}@host/`,
      "",
      `${MARKER}${"x".repeat(55)}`, // 65 characters: one too long
      `${MARKER}${"x".repeat(5_000)}`,
    ];
    for (const text of hostile) {
      const { line, raw, status } = abortedLine({ name: text, code: text });
      expect(raw, JSON.stringify(text)).not.toContain(MARKER);
      expect(raw.split("\n")).toHaveLength(1);
      expect("sourceError" in line).toBe(false);
      expect("sourceCode" in line).toBe(false);
      expect(line.level).toBe("warn");
      expect(status).toBeLessThan(500);
    }
    // The longest label that is kept is 64 characters, and it is kept whole, not cut.
    const longest = "E".repeat(64);
    expect(abortedLine({ name: longest, code: longest }).line).toMatchObject({
      sourceError: longest,
      sourceCode: longest,
    });
    // What an operator needs is still written.
    expect(
      abortedLine(Object.assign(new TypeError(MARKER), { code: "UND_ERR_SOCKET" })).line,
    ).toMatchObject({ sourceError: "TypeError", sourceCode: "UND_ERR_SOCKET" });
    expect(abortedLine({ name: "AbortError", code: -4077 }).line).toMatchObject({
      sourceError: "AbortError",
      sourceCode: "-4077",
    });
  });

  it("no code of the source's error is run to make a label, and a property is read once", () => {
    let conversions = 0;
    const talkative = {
      toString: () => {
        conversions += 1;
        return MARKER;
      },
      valueOf: () => {
        conversions += 1;
        return MARKER;
      },
      [Symbol.toPrimitive]: () => {
        conversions += 1;
        return MARKER;
      },
      toJSON: () => {
        conversions += 1;
        return MARKER;
      },
    };
    const values: unknown[] = [
      talkative,
      new String("TypeError"),
      ["TypeError"],
      () => "TypeError",
      Symbol("TypeError"),
      BigInt(10),
      true,
      null,
      undefined,
    ];
    for (const value of values) {
      const { line, raw } = abortedLine({ name: value, code: value });
      expect("sourceError" in line).toBe(false);
      expect("sourceCode" in line).toBe(false);
      expect(raw).not.toContain(MARKER);
    }
    expect(conversions).toBe(0);

    const reads = { name: 0, code: 0 };
    const counting = {
      get name() {
        reads.name += 1;
        return reads.name === 1 ? "TypeError" : `${MARKER} second read`;
      },
      get code() {
        reads.code += 1;
        return reads.code === 1 ? "ECONNRESET" : `${MARKER} second read`;
      },
    };
    expect(abortedLine(counting).line).toMatchObject({
      sourceError: "TypeError",
      sourceCode: "ECONNRESET",
    });
    expect(reads).toEqual({ name: 1, code: 1 });

    const throwing = {
      get name(): string {
        throw new Error(MARKER);
      },
      get code(): string {
        throw new Error(MARKER);
      },
    };
    const trapped = new Proxy(
      {},
      {
        get: () => {
          throw new Error(MARKER);
        },
        has: () => {
          throw new Error(MARKER);
        },
        getPrototypeOf: () => {
          throw new Error(MARKER);
        },
      },
    );
    for (const source of [throwing, trapped]) {
      const { line, raw } = abortedLine(source);
      expect(raw).not.toContain(MARKER);
      expect("sourceError" in line).toBe(false);
      expect("sourceCode" in line).toBe(false);
    }
  });

  it("a number is never a name, and a code that is a number is written only as plain digits", () => {
    const cases: [number, string | undefined][] = [
      [-4077, "-4077"],
      [0, "0"],
      [-0, "0"],
      [104, "104"],
      [0.5, "0.5"],
      [2 ** 53, "9007199254740992"],
      [1e21, undefined], // "1e+21": the plus sign is not of the form
      [1e-7, "1e-7"],
      [Number.NaN, undefined],
      [Number.POSITIVE_INFINITY, undefined],
      [Number.NEGATIVE_INFINITY, undefined],
    ];
    for (const [code, expected] of cases) {
      const { line } = abortedLine({ name: code, code });
      expect("sourceError" in line, String(code)).toBe(false);
      expect(line.sourceCode, String(code)).toBe(expected);
    }
  });

  it("neither label, and nothing else of the source, is in the response", async () => {
    const source = Object.assign(new Error(MARKER), { name: "QZXVName", code: "QZXV_CODE" });
    const response = errorResponse(requestBodyAborted(source), { requestId: REQUEST_ID });
    const text = await response.text();
    expect(text).not.toContain("QZXV");
    expect([...response.headers.values()].join("\n")).not.toContain("QZXV");
  });
});

// ---------------------------------------------------------------------------
// SEC-028. Owner of the code: backend-api.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };
const CEILING = { maxBytes: MAX_JSON_BODY_LIMIT_BYTES };

function post(body: string): Request {
  return new Request("https://shop.example/api/v1/cart", {
    method: "POST",
    headers: JSON_HEADERS,
    body,
  });
}

async function refusalOf(body: string): Promise<AppError> {
  try {
    await readJsonBody(post(body), CEILING);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("readJsonBody accepted the body");
}

/** `inner` wrapped in arrays and objects until it stands `depth` levels deep. */
function nested(inner: string, depth: number): string {
  let text = inner;
  for (let level = 0; level < depth; level += 1) {
    text = level % 2 === 0 ? `[${text}]` : `{"k":${text}}`;
  }
  return text;
}

describe("SEC-028 re-check: a string that is not well-formed Unicode is refused wherever it stands", () => {
  const HIGH = "\\ud83d";
  const LOW = "\\ude00";
  const NOT_WELL_FORMED = {
    code: "VALIDATION_ERROR",
    message: "The request is invalid.",
    details: {
      fields: [
        {
          path: "",
          code: JSON_STRING_NOT_WELL_FORMED_FIELD_CODE,
          message: "The request body contains a string that is not well-formed Unicode.",
        },
      ],
    },
  };

  it("a half of a pair in a value, in a key, at the root, in an array, and at every depth", async () => {
    const filler = `"${"a".repeat(1_000)}",`.repeat(1_000);
    const manyKeys = Array.from({ length: 50_000 }, (_, index) => `"k${index}":${index}`).join(",");
    const bodies = [
      `"${HIGH}"`,
      `"${LOW}"`,
      `"${MARKER}${HIGH}${MARKER}"`,
      `"${LOW}${HIGH}"`,
      `"${HIGH}${HIGH}${LOW}"`,
      `"${HIGH}${LOW}${LOW}"`,
      `"${HIGH}A${LOW}"`,
      `"${HIGH}\\u0041"`,
      `"\\uD83D"`,
      `"\\udfff"`,
      `"\\ud800"`,
      `"😀${HIGH}"`,
      `["${HIGH}"]`,
      `[1,true,null,"ok",{"a":[["${LOW}"]]}]`,
      `{"${HIGH}":1}`,
      `{"${MARKER}${LOW}":{"a":1}}`,
      `{"a":{"b":{"${HIGH}":"${MARKER}"}}}`,
      `{"__proto__":"${HIGH}"}`,
      `{"__proto__":{"${LOW}":1}}`,
      `{"constructor":{"prototype":{"x":"${HIGH}"}}}`,
      `{"a":"ok","a":"${HIGH}"}`,
      `{"":"${HIGH}"}`,
      nested(`"${HIGH}"`, MAX_JSON_NESTING_DEPTH),
      nested(`{"${LOW}":0}`, MAX_JSON_NESTING_DEPTH - 1),
      nested(`[0,"${HIGH}"]`, MAX_JSON_NESTING_DEPTH - 1),
      // Late in a large document: after a megabyte of ordinary strings, and as the last key.
      `[${filler}"${HIGH}"]`,
      `{${manyKeys},"${LOW}":0}`,
      `{${manyKeys},"last":"${HIGH}"}`,
    ];
    for (const body of bodies) {
      const label = body.length > 120 ? `${body.slice(0, 60)} ... ${body.slice(-40)}` : body;
      const error = await refusalOf(body);
      expect(error.status, label).toBe(400);
      expect(error.toPublic(), label).toEqual(NOT_WELL_FORMED);
      expect(error.cause, label).toBeUndefined();
      // Nothing of the body is kept on the error, in the response, or in a log line.
      const { raw, log } = recording();
      const response = errorResponse(error, { requestId: REQUEST_ID, logger: log });
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(raw).toEqual([]);
      for (const piece of [MARKER, "ud83d", "ude00", "\ud83d", "\ude00", "�", "k49999"]) {
        expect(text, label).not.toContain(piece);
        expect(String(error.stack), label).not.toContain(piece);
      }
      expect(JSON.parse(text)).toEqual({ error: { ...NOT_WELL_FORMED, requestId: REQUEST_ID } });
    }
  });

  it("well-formed text is handed out unchanged, written raw or as escapes", async () => {
    const accepted: [string, unknown][] = [
      [`"${HIGH}${LOW}"`, "\u{1f600}"],
      [`"\\uD83D\\uDE00"`, "\u{1f600}"],
      [`"\u{1f600}"`, "\u{1f600}"],
      [`{"${HIGH}${LOW}":"${HIGH}${LOW}${HIGH}${LOW}"}`, { "\u{1f600}": "\u{1f600}\u{1f600}" }],
      [`"\\udbff\\udfff"`, "\u{10ffff}"],
      [`"\\ud7ff\\ue000\\uffff\\ufffd"`, "퟿￿�"],
      [`"\\\\ud83d"`, "\\ud83d"],
      // The half is in a value that the parser itself discards: what is handed out is clean.
      [`{"a":"${HIGH}","a":"ok"}`, { a: "ok" }],
      [nested(`"${HIGH}${LOW}"`, MAX_JSON_NESTING_DEPTH), undefined],
    ];
    for (const [body, expected] of accepted) {
      const value = await readJsonBody(post(body), CEILING);
      if (expected !== undefined) expect(value, body).toEqual(expected);
      expect(JSON.stringify(value).isWellFormed(), body).toBe(true);
    }
  });

  it("the walk does not pollute a prototype and runs no code of the value", async () => {
    const before = Object.getOwnPropertyNames(Object.prototype).length;
    await refusalOf(`{"__proto__":{"polluted":"${HIGH}"},"constructor":{"prototype":{"p":1}}}`);
    const value = (await readJsonBody(
      post(`{"__proto__":{"polluted":"yes"},"toString":"x","isWellFormed":"y","length":-1}`),
      CEILING,
    )) as Record<string, unknown>;
    expect(Object.getOwnPropertyNames(Object.prototype)).toHaveLength(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(value)).toEqual(["__proto__", "toString", "isWellFormed", "length"]);
  });

  // The cost of the walk. A document is at most MAX_JSON_NESTING_DEPTH deep when the walk sees
  // it, so a recursive walk could not overflow the stack and no test through `readJsonBody`
  // can tell it from an iterative one; that the walk keeps its own list was read in the code.
  // What a test can show is that the cost grows with the size of the document and not with its
  // square: the largest documents of each shape, with nothing to find or with the half at the
  // very end, inside a bound that an ordinary run stays under by a factor of twenty or more.
  // Shown on 2026-10-12: with one linear search of the pending list added for every child, the
  // comb-shaped cases take minutes and fail this bound.
  it(
    "the largest accepted documents of every shape are walked in time in proportion to their size",
    { timeout: 120_000 },
    async () => {
      const BOUND_MS = 4_000;
      const room = MAX_JSON_BODY_LIMIT_BYTES - 64;
      const repeat = (unit: string, last: string): string => {
        const count = Math.floor(room / unit.length) - 1;
        return `${unit.repeat(count)}${last}`;
      };
      const keys = (suffix: string): string => {
        const parts: string[] = [];
        let size = 0;
        for (let index = 0; size < room - 32; index += 1) {
          const part = `"${index.toString(36)}":${suffix},`;
          parts.push(part);
          size += part.length;
        }
        return parts.join("");
      };
      const shapes: [string, string, boolean][] = [
        ["flat array of numbers", `[${repeat("0,", "0")}]`, false],
        ["flat array of empty strings", `[${repeat('"",', '""')}]`, false],
        ["comb of empty arrays", `[${repeat("[],", "[]")}]`, false],
        ["comb of empty objects", `[${repeat("{},", "{}")}]`, false],
        ["comb of one-string arrays", `[${repeat('["a"],', '["a"]')}]`, false],
        ["object of many keys", `{${keys("0")}"z":0}`, false],
        ["object of many keys, each an array", `{${keys("[]")}"z":0}`, false],
        ["one string of escaped pairs", `"${repeat(`${HIGH}${LOW}`, "")}"`, false],
        ["many strings of escaped pairs", `[${repeat(`"${HIGH}${LOW}",`, '""')}]`, false],
        [
          "a comb at the deepest level",
          nested(`[${"[],".repeat(Math.floor((room - 200) / 3))}0]`, MAX_JSON_NESTING_DEPTH - 2),
          false,
        ],
        ["comb of empty arrays, the half at the end", `[${repeat("[],", `"${HIGH}"`)}]`, true],
        ["comb of objects, the half first", `["${HIGH}",${repeat("{},", "{}")}]`, true],
        ["object of many keys, the half in the last key", `{${keys("[]")}"${LOW}":0}`, true],
        ["flat array of strings, the half at the end", `[${repeat('"",', `"${LOW}"`)}]`, true],
      ];
      for (const [name, body, refused] of shapes) {
        expect(body.length, name).toBeLessThanOrEqual(MAX_JSON_BODY_LIMIT_BYTES);
        expect(body.length, name).toBeGreaterThan(MAX_JSON_BODY_LIMIT_BYTES - 4_096);
        const request = post(body);
        const started = performance.now();
        let outcome: unknown;
        try {
          await readJsonBody(request, CEILING);
          outcome = "accepted";
        } catch (error) {
          outcome = error;
        }
        const elapsed = performance.now() - started;
        if (refused) expect((outcome as AppError).toPublic(), name).toEqual(NOT_WELL_FORMED);
        else expect(outcome, name).toBe("accepted");
        expect(elapsed, name).toBeLessThan(BOUND_MS);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// The level of the process-wide logger (commit b40abf0). Owner of the code: backend-api.
// ---------------------------------------------------------------------------

const LEVEL_SLOT = Symbol.for("marketplace.logger.processLevel");
type GlobalWithSlot = typeof globalThis & { [LEVEL_SLOT]?: unknown };
const globalWithSlot = globalThis as GlobalWithSlot;

/** Runs `action` and returns the lines the process-wide logger wrote to standard output. */
async function captureStdout(action: () => unknown): Promise<string[]> {
  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as never);
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
  return written
    .join("")
    .split("\n")
    .filter((line) => line.length > 0);
}

describe("the process-wide log level: what can set it and what it hides", () => {
  afterEach(() => {
    delete globalWithSlot[LEVEL_SLOT];
    setLogLevel(DEFAULT_LOG_LEVEL);
    vi.restoreAllMocks();
  });

  it("an absent slot, or anything in it that is not a level, is the default level", async () => {
    delete globalWithSlot[LEVEL_SLOT];
    expect(getLogLevel()).toBe(DEFAULT_LOG_LEVEL);
    expect(DEFAULT_LOG_LEVEL).toBe("info");
    const invalid: unknown[] = [
      0,
      3,
      null,
      true,
      {},
      [],
      ["error"],
      "",
      "ERROR",
      "Error",
      " error",
      "error ",
      "trace",
      "fatal",
      "silent",
      "off",
      "none",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      new String("error"),
      { toString: () => "error" },
      Symbol("error"),
      () => "error",
    ];
    for (const value of invalid) {
      globalWithSlot[LEVEL_SLOT] = value;
      expect(getLogLevel(), String(typeof value)).toBe("info");
      const lines = await captureStdout(() => {
        processLogger.debug("debug line");
        processLogger.info("info line");
        processLogger.child({ component: "x" }).warn("warn line");
      });
      expect(lines.map((line) => (JSON.parse(line) as LogLine).level)).toEqual(["info", "warn"]);
    }
  });

  it("a slot that throws when read is the default level, and the line is still written", async () => {
    Object.defineProperty(globalThis, LEVEL_SLOT, {
      configurable: true,
      get: () => {
        throw new Error(MARKER);
      },
    });
    try {
      expect(getLogLevel()).toBe("info");
      const lines = await captureStdout(() => processLogger.warn("still written"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain(MARKER);
    } finally {
      delete globalWithSlot[LEVEL_SLOT];
    }
  });

  it("setLogLevel accepts the four levels only, names nothing of a refused value, and keeps the level", () => {
    setLogLevel("warn");
    for (const value of ["ERROR", `${MARKER}`, "", "__proto__", 3, null, undefined, {}]) {
      let thrown: unknown;
      try {
        setLogLevel(value as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(String((thrown as Error).message)).not.toContain(MARKER);
      expect(getLogLevel()).toBe("warn");
    }
    expect(globalWithSlot[LEVEL_SLOT]).toBe("warn");
  });

  it("nothing a request body can hold reaches the slot: a parsed document has no symbol key", async () => {
    setLogLevel("info");
    const names = ["marketplace.logger.processLevel", "Symbol(marketplace.logger.processLevel)"];
    const body = JSON.stringify({
      [names[0] ?? ""]: "error",
      [names[1] ?? ""]: "error",
      level: "error",
      LOG_LEVEL: "error",
    }).replace("{", `{"__proto__":{"${names[0]}":"error"},`);
    const value = await readJsonBody(post(body));
    expect(Object.getOwnPropertySymbols(value as object)).toEqual([]);
    expect(getLogLevel()).toBe("info");
    expect(globalWithSlot[LEVEL_SLOT]).toBe("info");
  });

  it("a second copy of the logger module reads and sets the same level", async () => {
    vi.resetModules();
    const copy = await import("../../src/server/logger");
    expect(copy.logger).not.toBe(processLogger);
    copy.setLogLevel("error");
    expect(getLogLevel()).toBe("error");
    setLogLevel("debug");
    expect(copy.getLogLevel()).toBe("debug");
    const lines = await captureStdout(() => copy.logger.debug("from the copy"));
    expect(lines).toHaveLength(1);
  });

  it("what the level `error` hides and what it keeps", async () => {
    // Recorded, not judged here: SR-05 item 10 allows the broken-body line "at most", and the
    // recovery line is a convenience. The outage line is at `error` and is always written.
    setLogLevel("error");
    let mode: ProbeMode = "fail";
    const check = createHealthCheck({
      probe: () => (mode === "ok" ? Promise.resolve() : Promise.reject(new Error("down"))),
    });
    const lines = await captureStdout(async () => {
      errorResponse(requestBodyAborted(new TypeError("terminated")), {
        requestId: REQUEST_ID,
        logger: processLogger,
      });
      await check({ requestId: REQUEST_ID });
      mode = "ok";
      await check({ requestId: REQUEST_ID });
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ level: "error", component: "health" });
  });

  // SEC-031 (OPEN, Low). SR-02 item 4 requires the saturation warning so that operators can
  // alert on it, and SR-04 lists the security events. All of them are written at `warn` or
  // below, so `LOG_LEVEL=error`, a value the configuration accepts in production, removes them.
  // The rule added to SR-04 on 2026-10-12: a line that a security rule requires is written at
  // every configured level.
  it.fails(
    "SEC-031 the saturation warning of SR-02 is written at every configured level",
    async () => {
      setLogLevel("error");
      const limiter = createRateLimiter({ store: new MemoryRateLimitStore({ maxKeys: 1 }) });
      const lines = await captureStdout(async () => {
        await limiter.consume("203.0.113.1", RATE_LIMITS.SIGN_IN_ADDRESS);
        const refused = await limiter.consume("203.0.113.2", RATE_LIMITS.SIGN_IN_ADDRESS);
        expect(refused.saturated).toBe(true);
      });
      expect(lines.join("\n")).toContain("Rate limit store saturated");
    },
  );
});

// ---------------------------------------------------------------------------
// One process, more than one copy of a module (measured by devops with Next.js 16.4.0: the
// start-up hook and the route handlers are compiled separately). `vi.resetModules()` gives this
// test a second copy in the same way.
// ---------------------------------------------------------------------------

describe("module state when a process holds two copies of a module", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // SEC-030 (OPEN, Medium before T-015; nothing consumes a limit today). The limiter keeps its
  // counters in a store that belongs to the module copy, so each copy counts for itself and a
  // limit is multiplied by the number of copies that consume it.
  it.fails(
    "SEC-030 a limit used up through one copy of the limiter is used up for every copy",
    async () => {
      vi.resetModules();
      const first = await import("../../src/server/rate-limit");
      vi.resetModules();
      const second = await import("../../src/server/rate-limit");
      expect(first.rateLimiter).not.toBe(second.rateLimiter);
      const subject = "203.0.113.30";
      const rule = first.RATE_LIMITS.SIGN_IN_ADDRESS;
      for (let attempt = 0; attempt < rule.limit; attempt += 1) {
        expect((await first.rateLimiter.consume(subject, rule)).allowed).toBe(true);
      }
      expect((await first.rateLimiter.consume(subject, rule)).allowed).toBe(false);
      // The sixth and later attempts are refused whichever copy is asked.
      const elsewhere = await second.rateLimiter.consume(
        subject,
        second.RATE_LIMITS.SIGN_IN_ADDRESS,
      );
      expect(elsewhere.allowed).toBe(false);
    },
  );

  it("an AppError made by another copy is never mapped to more than a generic 500", async () => {
    // `instanceof AppError` is false across copies, so the refusal of one copy is a server
    // fault for the other. That fails closed: a 500 with nothing of the error in it. It is
    // recorded because it is also an error-level line and a lost status (a 429 without
    // `Retry-After`) for whatever is shared between copies later.
    vi.resetModules();
    const copy = await import("../../src/server/errors");
    const foreign = copy.forbidden({ cause: new Error(MARKER) });
    expect(foreign).not.toBeInstanceOf(AppError);
    const response = errorResponse(foreign, { requestId: REQUEST_ID });
    const text = await response.text();
    expect([ERROR_STATUS.FORBIDDEN, ERROR_STATUS.INTERNAL_ERROR]).toContain(response.status);
    expect(text).not.toContain(MARKER);
    // The same error in its own copy is the 403 it was made as.
    expect(errorResponse(forbidden(), { requestId: REQUEST_ID }).status).toBe(403);
  });

  // SEC-029 (OPEN, Low). The refusals of SEC-009 and SEC-025 run in the start-up hook only. The
  // framework does not call the hook when the variable NEXT_PHASE holds
  // `phase-production-build` (and the hook returns early on the same test), so that one
  // variable in a server's environment switches every start-up check off, and the database
  // client then takes DATABASE_URL as written. The client must judge the URL itself
  // (`readDatabaseUrl`, code-review finding CR-23).
  it.fails(
    "SEC-029 the database client refuses a placeholder password in production by itself",
    async () => {
      const GLOBAL_KEY = "__marketplaceDb";
      const globalWithDb = globalThis as typeof globalThis & { [GLOBAL_KEY]?: unknown };
      const kept = globalWithDb[GLOBAL_KEY];
      delete globalWithDb[GLOBAL_KEY];
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DATABASE_URL", authority(DEV_PLACEHOLDER));
      try {
        const { db } = await import("../../src/server/db");
        let thrown: unknown;
        try {
          // The first use creates the client. No query is sent and no connection is opened.
          void db.$transaction;
        } catch (error) {
          thrown = error;
        }
        await db.$disconnect();
        expect(thrown).toBeInstanceOf(Error);
        expect(String((thrown as Error).message)).toContain("DATABASE_URL");
        expect(String((thrown as Error).message)).not.toContain(DEV_PLACEHOLDER);
      } finally {
        if (kept === undefined) delete globalWithDb[GLOBAL_KEY];
        else globalWithDb[GLOBAL_KEY] = kept;
      }
    },
  );
});
