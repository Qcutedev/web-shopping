/**
 * Where the end-to-end suite runs. Pure values, read by playwright.config.ts, global-setup.ts,
 * the specs, and tests/e2e-support/database.ts.
 *
 * The database is NOT the development database and NOT an integration database: it is a separate
 * database on the local db-test container, named below. Its URL is DATABASE_URL_TEST after the
 * same checks the integration suite applies (tests/helpers/test-database-url.ts: CR-25, CR-34,
 * CR-40, strict form, server different from DATABASE_URL, no driver override in the environment
 * or in any env file the server loads), with only the database name replaced. If any check fails, loading this file
 * throws, so nothing is created anywhere else. No message here contains a URL.
 *
 * `.env` is parsed, not loaded into `process.env`: it also holds the development DATABASE_URL and
 * PG* variables, which must not reach a Playwright worker or a child process (CR-41, CR-134).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import { resolveTestDatabase, type TestDatabase } from "../../tests/helpers/test-database-url";

import { E2E_DATABASE_NAME, REPO_ROOT } from "./constants";
import {
  assertNoDriverOverrideForE2e,
  collectDevelopmentUrls,
  NEXT_ENV_FILE_NAMES,
  scanEnvText,
} from "./env-file-scan";

export {
  E2E_DATABASE_NAME,
  E2E_HOST,
  E2E_ORIGIN,
  E2E_PORT,
  E2E_UPLOAD_DIR,
  REPO_ROOT,
  SELLER,
  SELLER_STORAGE_STATE,
} from "./constants";

/** The `.env` file as data. Nothing is put into `process.env`. */
export function readEnvFile(): Record<string, string | undefined> {
  const path = resolve(REPO_ROOT, ".env");
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

/**
 * Every env file `next dev` may load, scanned with the e2e scanner (env-file-scan.ts), which reads
 * what the server's own parser reads (SEC-074). The server inherits the parent environment and
 * reads these files itself, so a driver override in any of them would reach its connection
 * (CR-146). Keyed by file name; a file that does not exist is absent.
 */
function readNextEnvFiles(): Array<[string, Record<string, string>]> {
  const files: Array<[string, Record<string, string>]> = [];
  for (const name of NEXT_ENV_FILE_NAMES) {
    const path = resolve(REPO_ROOT, name);
    if (existsSync(path)) files.push([name, scanEnvText(readFileSync(path, "utf8"))]);
  }
  return files;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * DATABASE_URL_TEST, validated. The e2e database is on this server, under another name. The
 * development DATABASE_URL is compared from the process and from every env file the server loads
 * (CR-156), so a development URL held only in `.env.local` is refused when it names this server.
 */
function resolveBase(): TestDatabase {
  const fileEnv = readEnvFile();
  const nextFiles = readNextEnvFiles();
  assertNoDriverOverrideForE2e(process.env, "the environment");
  for (const [name, content] of nextFiles) {
    assertNoDriverOverrideForE2e(content, `the ${name} file`);
  }
  const { otherUrls, otherSources } = collectDevelopmentUrls({
    processUrl: process.env["DATABASE_URL"],
    envFileUrl: fileEnv["DATABASE_URL"],
    nextFiles,
  });
  return resolveTestDatabase({
    testUrl: nonEmpty(process.env["DATABASE_URL_TEST"]) ?? nonEmpty(fileEnv["DATABASE_URL_TEST"]),
    otherUrls,
    otherSources,
    run: "e2e",
  });
}

/** The validated test database whose server hosts the e2e database. */
export const E2E_BASE_DATABASE: TestDatabase = resolveBase();

function e2eDatabaseUrl(): string {
  const url = new URL(E2E_BASE_DATABASE.baseUrl);
  url.pathname = `/${E2E_DATABASE_NAME}`;
  return url.toString();
}

export const E2E_DATABASE_URL = e2eDatabaseUrl();
