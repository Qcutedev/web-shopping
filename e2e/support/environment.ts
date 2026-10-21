/**
 * Where the end-to-end suite runs. Pure values, read by playwright.config.ts and global-setup.ts.
 *
 * The database is NOT the development database and NOT an integration database: it is a separate
 * database on the local db-test container, named below, derived from DATABASE_URL_TEST by
 * replacing only the database name. If DATABASE_URL_TEST is missing or not a local URL, loading
 * this file throws, so nothing is created anywhere else. No message here contains the URL.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export const E2E_PORT = 3100;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_NAME = "marketplace_e2e";

function e2eDatabaseUrl(): string {
  const raw = process.env["DATABASE_URL_TEST"];
  if (!raw) {
    throw new Error(
      "End-to-end tests need DATABASE_URL_TEST (the local db-test container; see .env.example).",
    );
  }
  const url = new URL(raw);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("DATABASE_URL_TEST must point at this machine; end-to-end tests refuse it.");
  }
  url.pathname = `/${E2E_DATABASE_NAME}`;
  url.search = "";
  return url.toString();
}

export const E2E_DATABASE_URL = e2eDatabaseUrl();

/** URL of the maintenance database of the same server, used only to create the e2e database. */
export function adminDatabaseUrl(): string {
  const url = new URL(E2E_DATABASE_URL);
  url.pathname = "/postgres";
  return url.toString();
}

/** The seller account the suite signs in as. Local, throwaway, created by global-setup. */
export const SELLER = {
  name: "E2E Seller",
  email: "e2e-seller@example.test",
  password: "e2e-Seller-pass-1234",
} as const;

export const SELLER_STORAGE_STATE = "e2e/.auth/seller.json";
