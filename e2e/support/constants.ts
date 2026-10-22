/**
 * Constants of the end-to-end suite that need no environment. Kept apart from environment.ts so
 * that a child process (tests/e2e-support/database.ts) can read them without DATABASE_URL_TEST.
 */
import { resolve } from "node:path";

/**
 * Repository root, from this file's location and not from the working directory (CR-147).
 * `__dirname`, not `import.meta.dirname`: package.json has no `"type": "module"`, so Playwright and
 * tsx both load these files as CommonJS, where `import.meta` is a syntax error.
 */
export const REPO_ROOT = resolve(__dirname, "../..");

export const E2E_PORT = 3100;
/**
 * The server listens on the loopback IPv4 address only (SEC-076) and the origin names that address,
 * so the e2e cookies are not sent to a `localhost` development server (SEC-075).
 */
export const E2E_HOST = "127.0.0.1";
export const E2E_ORIGIN = `http://${E2E_HOST}:${E2E_PORT}`;
export const E2E_DATABASE_NAME = "marketplace_e2e";

/** The seller account the suite signs in as. Local, throwaway, created by global-setup. */
export const SELLER = {
  name: "E2E Seller",
  email: "e2e-seller@example.test",
  password: "e2e-Seller-pass-1234",
} as const;

/** The e2e server's upload root, apart from the development one (SEC-075). Git-ignored, emptied by global-setup. */
export const E2E_UPLOAD_DIR = resolve(REPO_ROOT, "e2e/.auth/uploads");

export const SELLER_STORAGE_STATE = resolve(REPO_ROOT, "e2e/.auth/seller.json");
