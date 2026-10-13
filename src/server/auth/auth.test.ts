/**
 * createAuth and the library's own environment variables (SEC-045). No database is reached:
 * creating the instance and resolving its context only builds the configuration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../logger";

const SECRET = "Zq7canary-validated-secret-a8f3k2m9q1w7e5r0";
const APP_URL = "https://shop.example.test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function freshAuth(lines: string[]) {
  vi.stubEnv("DATABASE_URL", "postgresql://shop:Zq7dbPw@db.example.test:5432/shop");
  vi.resetModules();
  const { createAuth } = await import("./auth");
  return createAuth({
    secret: SECRET,
    baseUrl: APP_URL,
    appOrigin: APP_URL,
    secureCookies: true,
    trustedProxy: { trustedProxyHops: 0 },
    logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
  });
}

describe("createAuth signs with the validated secret only (SEC-045)", () => {
  it("uses the given secret when no library variable is set", async () => {
    const lines: string[] = [];
    const auth = await freshAuth(lines);
    expect((await auth.$context).secret).toBe(SECRET);
  });

  it("ignores BETTER_AUTH_SECRETS, however weak or malformed, and logs nothing of it", async () => {
    for (const value of ["1:x", "2:Zq7canary-rotated,1:old", "Zq7canary-rotated-without-version"]) {
      vi.stubEnv("BETTER_AUTH_SECRETS", value);
      const lines: string[] = [];
      const auth = await freshAuth(lines);
      const context = await auth.$context;
      expect(context.secret, value).toBe(SECRET);
      expect(lines.join("\n")).not.toContain("Zq7canary-rotated");
    }
  });

  it("ignores BETTER_AUTH_SECRET and AUTH_SECRET in the process environment", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "y".repeat(40));
    vi.stubEnv("AUTH_SECRET", "z".repeat(40));
    const auth = await freshAuth([]);
    expect((await auth.$context).secret).toBe(SECRET);
  });
});
