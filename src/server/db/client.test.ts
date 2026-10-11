// Unit tests of the client module. No database: the pool connects on first use, and nothing
// here runs a query. Behaviour against a real database belongs to the integration tests (T-023).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GLOBAL_KEY = "__marketplaceDb";
const PLACEHOLDER_URL = "postgresql://user:placeholder@127.0.0.1:1/none";

type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: unknown };

function clearGlobalClient() {
  delete (globalThis as GlobalWithDb)[GLOBAL_KEY];
}

describe("database client module", () => {
  beforeEach(() => {
    vi.resetModules();
    clearGlobalClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearGlobalClient();
  });

  it("returns the same client when the module is evaluated again (dev reload, second bundle)", async () => {
    vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);

    const first = await import("./client");
    vi.resetModules();
    const second = await import("./client");

    expect(second).not.toBe(first);
    expect(second.db).toBe(first.db);
  });

  it("keeps one client per process in production too", async () => {
    vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
    vi.stubEnv("NODE_ENV", "production");

    const first = await import("./client");
    vi.resetModules();
    const second = await import("./client");

    expect(second.db).toBe(first.db);
  });

  it("refuses to create a client without DATABASE_URL and names the variable", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await expect(import("./client")).rejects.toThrow(/DATABASE_URL is not set/);
    expect((globalThis as GlobalWithDb)[GLOBAL_KEY]).toBeUndefined();
  });

  it("does not export the PrismaClient class from the public surface", async () => {
    vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);

    const surface = await import("./index");

    expect(Object.keys(surface)).not.toContain("PrismaClient");
    expect(surface.db).toBeDefined();
    expect(surface.Role.CUSTOMER).toBe("CUSTOMER");
  });
});
