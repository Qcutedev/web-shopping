/**
 * What the e2e `next dev` server is started with (SEC-074, SEC-075, SEC-076). Pure values, read by
 * playwright.config.ts and by a unit test that pins each entry.
 *
 * Playwright merges `process.env` under `webServer.env`, and `@next/env` never overrides a
 * variable that is already present, so every name set here wins over `.env*` files and over the
 * parent environment.
 */
import { E2E_HOST, E2E_PORT } from "./constants";

/** `next dev` bound to the loopback address only (SEC-076); the default is every interface. */
export function e2eServerCommand(): string {
  return `pnpm exec next dev --hostname ${E2E_HOST} --port ${E2E_PORT}`;
}

export type E2eServerEnvironmentInput = {
  databaseUrl: string;
  origin: string;
  uploadDir: string;
  authSecret: string;
};

export function e2eServerEnvironment(input: E2eServerEnvironmentInput): Record<string, string> {
  return {
    DATABASE_URL: input.databaseUrl,
    APP_URL: input.origin,
    NEXT_TELEMETRY_DISABLED: "1",
    // Separate build dir: the e2e server must not share .next/ with pnpm dev (CR-136).
    NEXT_DIST_DIR: ".next-e2e",
    // SEC-075: an e2e-only upload root and a per-run session secret, never the development ones.
    UPLOAD_DIR: input.uploadDir,
    AUTH_SECRET: input.authSecret,
    // SEC-074: empty values win over any file or parent value. `pg` ignores an empty
    // NODE_PG_FORCE_NATIVE and PGOPTIONS, so neither can change the e2e connection.
    PGOPTIONS: "",
    NODE_PG_FORCE_NATIVE: "",
    // With NODE_ENV=test in the parent, `next dev` would load .env.test* and not .env.local.
    NODE_ENV: "development",
  };
}
