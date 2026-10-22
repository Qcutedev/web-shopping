/**
 * Where the end-to-end suite runs. Pure values, read by playwright.config.ts, global-setup.ts,
 * the specs, and tests/e2e-support/database.ts.
 *
 * The database is NOT the development database and NOT an integration database: it is a separate
 * database on the local db-test container, named below. Its URL is DATABASE_URL_TEST after the
 * same checks the integration suite applies (tests/helpers/test-database-url.ts: CR-25, CR-34,
 * CR-40, strict form, server different from DATABASE_URL, no driver override in the environment
 * or in `.env`), with only the database name replaced. If any check fails, loading this file
 * throws, so nothing is created anywhere else. No message here contains a URL.
 *
 * `.env` is parsed, not loaded into `process.env`: it also holds the development DATABASE_URL and
 * PG* variables, which must not reach a Playwright worker or a child process (CR-41, CR-134).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import {
  assertNoDriverEnvironmentOverride,
  resolveTestDatabase,
  type TestDatabase,
} from "../../tests/helpers/test-database-url";

import { E2E_DATABASE_NAME } from "./constants";

export { E2E_DATABASE_NAME, E2E_ORIGIN, E2E_PORT, SELLER, SELLER_STORAGE_STATE } from "./constants";

/** The `.env` file as data. Nothing is put into `process.env`. */
export function readEnvFile(): Record<string, string | undefined> {
  const path = resolve(process.cwd(), ".env");
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** DATABASE_URL_TEST, validated. The e2e database is on this server, under another name. */
function resolveBase(): TestDatabase {
  const fileEnv = readEnvFile();
  assertNoDriverEnvironmentOverride(process.env, "the environment");
  assertNoDriverEnvironmentOverride(fileEnv, "the .env file");
  return resolveTestDatabase({
    testUrl: nonEmpty(process.env["DATABASE_URL_TEST"]) ?? nonEmpty(fileEnv["DATABASE_URL_TEST"]),
    otherUrls: [process.env["DATABASE_URL"], fileEnv["DATABASE_URL"]],
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
