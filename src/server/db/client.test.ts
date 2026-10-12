// Unit tests of the client module. No database: the client is created on first use, the pool
// connects on first query, and nothing here runs a query. Behaviour against a real database
// belongs to the integration tests (T-023).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GLOBAL_KEY = "__marketplaceDb";
// Not a credential: a syntactically valid placeholder that names no reachable server.
const PLACEHOLDER_URL = "postgresql://user:placeholder@127.0.0.1:1/none";

type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: unknown };

// A published local password of `.env.example`: public, and refused in production (SEC-009).
const LOCAL_PLACEHOLDER_PASSWORD = "local_dev_only_not_a_secret";
const LOCAL_PLACEHOLDER_URL = `postgresql://user:${LOCAL_PLACEHOLDER_PASSWORD}@127.0.0.1:1/none`;

// Counts how many driver adapters, and so how many pools, were created, and keeps what each was
// given. The real class is kept.
const created = vi.hoisted(() => ({ adapters: 0, configs: [] as unknown[] }));

vi.mock("@prisma/adapter-pg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/adapter-pg")>();
  class CountedPrismaPg extends actual.PrismaPg {
    constructor(...args: ConstructorParameters<typeof actual.PrismaPg>) {
      super(...args);
      created.adapters += 1;
      created.configs.push(args[0]);
    }
  }
  return { ...actual, PrismaPg: CountedPrismaPg };
});

function clearGlobalClient() {
  delete (globalThis as GlobalWithDb)[GLOBAL_KEY];
}

function messageOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the action to throw.");
}

describe("database client module", () => {
  beforeEach(() => {
    vi.resetModules();
    clearGlobalClient();
    created.adapters = 0;
    created.configs = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearGlobalClient();
  });

  describe("import", () => {
    it("does not throw and creates no client when DATABASE_URL is absent", async () => {
      vi.stubEnv("DATABASE_URL", undefined);
      expect(process.env["DATABASE_URL"]).toBeUndefined();

      const layer = await import("./client");

      expect(layer.db).toBeDefined();
      expect(created.adapters).toBe(0);
    });

    it("does not throw and creates no client when DATABASE_URL is empty", async () => {
      vi.stubEnv("DATABASE_URL", "");

      await expect(import("./client")).resolves.toBeDefined();
      expect(created.adapters).toBe(0);
    });

    it("creates no client when DATABASE_URL is set", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);

      await import("./client");

      expect(created.adapters).toBe(0);
    });

    it("loads the public surface without DATABASE_URL", async () => {
      vi.stubEnv("DATABASE_URL", undefined);

      const surface = await import("./index");

      expect(surface.Role.CUSTOMER).toBe("CUSTOMER");
      expect(surface.Prisma.PrismaClientKnownRequestError).toBeTypeOf("function");
      expect(created.adapters).toBe(0);
    });
  });

  describe("first use without DATABASE_URL", () => {
    it.each([
      ["absent", undefined],
      ["empty", ""],
    ])("throws an error that names the variable when it is %s", async (_label, value) => {
      vi.stubEnv("DATABASE_URL", value);
      const { db } = await import("./client");

      expect(() => db.user).toThrow(/DATABASE_URL is required/);
      expect(() => db.$transaction).toThrow(/DATABASE_URL is required/);
      expect(() => "user" in db).toThrow(/DATABASE_URL is required/);
      expect(created.adapters).toBe(0);
    });

    it("puts no URL and no other variable's value in the message", async () => {
      vi.stubEnv("DATABASE_URL", "");
      // A fallback to another variable would be a defect; its value must not leak either.
      vi.stubEnv("DATABASE_URL_TEST", PLACEHOLDER_URL);
      const { db } = await import("./client");

      const message = messageOf(() => db.user);

      expect(message).toContain("DATABASE_URL is required");
      expect(message).not.toMatch(/:\/\//);
      expect(message).not.toContain("placeholder");
    });

    it("does not fall back to another variable", async () => {
      vi.stubEnv("DATABASE_URL", undefined);
      vi.stubEnv("DATABASE_URL_TEST", PLACEHOLDER_URL);
      const { db } = await import("./client");

      expect(() => db.user).toThrow(/DATABASE_URL is required/);
      expect(created.adapters).toBe(0);
    });

    it("reads the variable at first use, not at import, and does not remember the failure", async () => {
      vi.stubEnv("DATABASE_URL", undefined);
      const { db } = await import("./client");
      expect(() => db.user).toThrow(/DATABASE_URL is required/);

      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);

      expect(db.user).toBeDefined();
      expect(created.adapters).toBe(1);
    });
  });

  // CR-23 and SEC-029: the URL comes from `readDatabaseUrl()` of src/server/env.ts, so its
  // refusals hold where the client is created, whether or not the start-up hook ran.
  describe("first use with a DATABASE_URL the validated configuration refuses", () => {
    it("refuses a value that is not a PostgreSQL URL and does not repeat it", async () => {
      vi.stubEnv("DATABASE_URL", "mysql://user:placeholder@127.0.0.1:1/none");
      const { db } = await import("./client");

      const message = messageOf(() => db.user);

      expect(message).toContain("DATABASE_URL must be a postgresql:// or postgres:// URL");
      expect(message).not.toContain("mysql");
      expect(message).not.toContain("placeholder");
      expect(created.adapters).toBe(0);
    });

    it("refuses a published local password in production and does not repeat it", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DATABASE_URL", LOCAL_PLACEHOLDER_URL);
      const { db } = await import("./client");

      const message = messageOf(() => db.$transaction);

      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain(LOCAL_PLACEHOLDER_PASSWORD);
      expect(message).not.toMatch(/:\/\//);
      expect(created.adapters).toBe(0);
    });

    it("refuses a published local password in PGPASSWORD in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
      vi.stubEnv("PGPASSWORD", LOCAL_PLACEHOLDER_PASSWORD);
      const { db } = await import("./client");

      const message = messageOf(() => db.user);

      expect(message).toContain("PGPASSWORD");
      expect(message).not.toContain(LOCAL_PLACEHOLDER_PASSWORD);
      expect(created.adapters).toBe(0);
    });

    it("accepts the same local password outside production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DATABASE_URL", LOCAL_PLACEHOLDER_URL);
      const { db } = await import("./client");

      expect(db.user).toBeDefined();
      expect(created.adapters).toBe(1);
    });
  });

  describe("creation", () => {
    it("hands the adapter the pool configuration of pool-config.ts", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
      const { db } = await import("./client");
      const { poolConfigFor } = await import("./pool-config");

      expect(db.user).toBeDefined();

      expect(created.configs).toEqual([poolConfigFor(PLACEHOLDER_URL)]);
    });

    it("happens once, however often and in whatever way the client is used", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
      const { db } = await import("./client");

      expect(db.user).toBeDefined();
      expect(db.product).toBeDefined();
      expect(db.$transaction).toBeTypeOf("function");
      expect(db.$queryRawUnsafe).toBeTypeOf("function");
      expect("user" in db).toBe(true);

      expect(created.adapters).toBe(1);
    });

    it("happens once under concurrent first use", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
      const { db } = await import("./client");

      const delegates = await Promise.all(
        Array.from({ length: 20 }, async () => {
          await Promise.resolve();
          return db.user;
        }),
      );

      expect(created.adapters).toBe(1);
      expect(new Set(delegates).size).toBe(1);
    });

    it("happens once when the module is evaluated again (dev reload, second bundle)", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);

      const first = await import("./client");
      expect(first.db.user).toBeDefined();
      vi.resetModules();
      const second = await import("./client");
      expect(second.db.user).toBeDefined();

      expect(second).not.toBe(first);
      expect(second.db).toBe(first.db);
      expect(created.adapters).toBe(1);
    });

    it("keeps one client per process in production too", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
      vi.stubEnv("NODE_ENV", "production");

      const first = await import("./client");
      vi.resetModules();
      const second = await import("./client");
      expect(first.db.user).toBe(second.db.user);

      expect(second.db).toBe(first.db);
      expect(created.adapters).toBe(1);
    });

    it("keeps the exported client on globalThis under the key the test harness sets aside", async () => {
      vi.stubEnv("DATABASE_URL", undefined);

      const { db } = await import("./client");

      expect((globalThis as GlobalWithDb)[GLOBAL_KEY]).toBe(db);
    });

    it("gives tests that key through testing.ts and keeps it off the public surface", async () => {
      vi.stubEnv("DATABASE_URL", undefined);

      const { db } = await import("./client");
      const { TEST_ONLY_DB_GLOBAL_KEY } = await import("./testing");
      const surface = await import("./index");

      expect(TEST_ONLY_DB_GLOBAL_KEY).toBe(GLOBAL_KEY);
      expect((globalThis as Record<string, unknown>)[TEST_ONLY_DB_GLOBAL_KEY]).toBe(db);
      expect(Object.keys(surface)).not.toContain("DB_GLOBAL_KEY");
      expect(Object.keys(surface)).not.toContain("TEST_ONLY_DB_GLOBAL_KEY");
      expect(Object.values(surface)).not.toContain(GLOBAL_KEY);
    });
  });

  describe("$disconnect", () => {
    it("resolves and creates no client when none was created", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
      const { db } = await import("./client");

      await expect(db.$disconnect()).resolves.toBeUndefined();

      expect(created.adapters).toBe(0);
    });

    it("resolves without DATABASE_URL when no client was created", async () => {
      vi.stubEnv("DATABASE_URL", undefined);
      const { db } = await import("./client");

      await expect(db.$disconnect()).resolves.toBeUndefined();
    });

    it("reaches the real client once one exists", async () => {
      vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);
      const { db } = await import("./client");
      expect(db.user).toBeDefined();

      // No query ran, so the pool holds no connection and closing it needs no server.
      await expect(db.$disconnect()).resolves.toBeUndefined();
      expect(created.adapters).toBe(1);
    });
  });

  describe("what does not create a client", () => {
    it("awaiting the client, or returning it from an async function", async () => {
      vi.stubEnv("DATABASE_URL", undefined);
      const { db } = await import("./client");

      const same = await (async () => db)();

      expect(same).toBe(db);
      expect(created.adapters).toBe(0);
    });

    it("instanceof against the error classes and identity checks", async () => {
      vi.stubEnv("DATABASE_URL", undefined);
      const { db, Prisma } = await import("./index");

      expect(db instanceof Prisma.PrismaClientKnownRequestError).toBe(false);
      expect(Object.is(db, db)).toBe(true);
      expect(created.adapters).toBe(0);
    });
  });

  it("does not export the PrismaClient class from the public surface", async () => {
    vi.stubEnv("DATABASE_URL", PLACEHOLDER_URL);

    const surface = await import("./index");

    expect(Object.keys(surface)).not.toContain("PrismaClient");
    expect(surface.db).toBeDefined();
    expect(surface.Role.CUSTOMER).toBe("CUSTOMER");
  });
});
