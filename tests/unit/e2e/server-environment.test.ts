/**
 * SEC-074, SEC-075, SEC-076: the e2e server is started bound to loopback, with its own database,
 * upload root, and session secret, and with the driver overrides emptied. Each entry is pinned.
 */
import { describe, expect, it } from "vitest";

import {
  E2E_HOST,
  E2E_ORIGIN,
  E2E_PORT,
  E2E_UPLOAD_DIR,
  REPO_ROOT,
} from "../../../e2e/support/constants";
import { e2eServerCommand, e2eServerEnvironment } from "../../../e2e/support/server-environment";

const INPUT = {
  databaseUrl: "postgresql://u:p@127.0.0.1:5433/marketplace_e2e?schema=public",
  origin: E2E_ORIGIN,
  uploadDir: E2E_UPLOAD_DIR,
  authSecret: "a".repeat(32),
};

describe("e2e server start-up (SEC-074 to SEC-076)", () => {
  it("binds the loopback IPv4 address only, on the e2e port", () => {
    expect(E2E_HOST).toBe("127.0.0.1");
    expect(e2eServerCommand()).toContain(`--hostname 127.0.0.1 --port ${E2E_PORT}`);
    expect(e2eServerCommand()).not.toContain("0.0.0.0");
  });

  it("names the loopback address in the origin, so cookies are not shared with localhost", () => {
    expect(E2E_ORIGIN).toBe(`http://127.0.0.1:${E2E_PORT}`);
  });

  it("empties PGOPTIONS and NODE_PG_FORCE_NATIVE and fixes NODE_ENV", () => {
    const env = e2eServerEnvironment(INPUT);
    expect(env["PGOPTIONS"]).toBe("");
    expect(env["NODE_PG_FORCE_NATIVE"]).toBe("");
    expect(env["NODE_ENV"]).toBe("development");
  });

  it("passes the e2e database, origin, upload root, and secret", () => {
    const env = e2eServerEnvironment(INPUT);
    expect(env["DATABASE_URL"]).toBe(INPUT.databaseUrl);
    expect(env["APP_URL"]).toBe(E2E_ORIGIN);
    expect(env["UPLOAD_DIR"]).toBe(E2E_UPLOAD_DIR);
    expect(env["AUTH_SECRET"]).toBe(INPUT.authSecret);
    expect(env["NEXT_DIST_DIR"]).toBe(".next-e2e");
  });

  it("keeps the e2e upload root inside the git-ignored e2e/.auth directory, not the dev root", () => {
    expect(E2E_UPLOAD_DIR.replaceAll("\\", "/")).toBe(
      `${REPO_ROOT.replaceAll("\\", "/")}/e2e/.auth/uploads`,
    );
  });

  it("gives SIGN_UP_RATE_LIMIT to the e2e server only, never to the runner process (CR-S116-03)", async () => {
    const before = process.env["SIGN_UP_RATE_LIMIT"];
    const { default: config } = await import("../../../playwright.config");
    expect(config.webServer).toMatchObject({
      env: { SIGN_UP_RATE_LIMIT: "1000", NODE_ENV: "development" },
    });
    expect(process.env["SIGN_UP_RATE_LIMIT"]).toBe(before);
  });
});
