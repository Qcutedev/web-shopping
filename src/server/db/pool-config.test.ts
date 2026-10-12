// Unit tests of the pool settings (review finding CR-23). No database: a `pg` pool and a `pg`
// client are constructed, which opens no connection, and what they took from the configuration
// is read back. The driver is the copy `@prisma/adapter-pg` itself loads, so a driver update
// that renames or stops reading a key fails here.
import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  POOL_CONNECTION_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  POOL_MAX_CONNECTIONS,
  QUERY_TIMEOUT_MS,
  STATEMENT_TIMEOUT_MS,
  poolConfigFor,
} from "./pool-config";

// Not a credential: a syntactically valid placeholder that names no reachable server.
const PLACEHOLDER_URL = "postgresql://user:placeholder@127.0.0.1:1/none";

interface DriverPool {
  options: Record<string, unknown>;
  end(): Promise<void>;
}
interface DriverClient {
  connectionParameters: Record<string, unknown>;
  _connectionTimeoutMillis?: unknown;
}
interface Driver {
  Pool: new (config: unknown) => DriverPool;
  Client: new (config: unknown) => DriverClient;
}

function loadDriver(): Driver {
  const fromHere = createRequire(import.meta.url);
  const fromAdapter = createRequire(fromHere.resolve("@prisma/adapter-pg"));
  return fromAdapter("pg") as Driver;
}

describe("pool configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the connection string and the five constants, nothing else", () => {
    expect(poolConfigFor(PLACEHOLDER_URL)).toEqual({
      connectionString: PLACEHOLDER_URL,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 30_000,
      query_timeout: 35_000,
    });
    expect(POOL_MAX_CONNECTIONS).toBe(10);
    expect(POOL_CONNECTION_TIMEOUT_MS).toBe(5_000);
    expect(POOL_IDLE_TIMEOUT_MS).toBe(10_000);
    expect(STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(QUERY_TIMEOUT_MS).toBe(35_000);
  });

  it("reads no environment variable", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://other:other@127.0.0.1:2/other");
    vi.stubEnv("PGCONNECT_TIMEOUT", "1");

    expect(poolConfigFor(PLACEHOLDER_URL)).toEqual({
      connectionString: PLACEHOLDER_URL,
      max: POOL_MAX_CONNECTIONS,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
    });
  });

  it("lets the server cancel a statement before the driver stops waiting for it", () => {
    expect(QUERY_TIMEOUT_MS).toBeGreaterThan(STATEMENT_TIMEOUT_MS);
  });

  it("bounds a connection attempt below the 30 seconds after which a health probe is abandoned", () => {
    expect(POOL_CONNECTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(POOL_CONNECTION_TIMEOUT_MS).toBeLessThan(30_000);
  });

  describe("as the installed driver takes it", () => {
    it("the pool takes its size and both of its timeouts", async () => {
      const { Pool } = loadDriver();
      const pool = new Pool(poolConfigFor(PLACEHOLDER_URL));
      try {
        expect(pool.options["max"]).toBe(POOL_MAX_CONNECTIONS);
        expect(pool.options["connectionTimeoutMillis"]).toBe(POOL_CONNECTION_TIMEOUT_MS);
        expect(pool.options["idleTimeoutMillis"]).toBe(POOL_IDLE_TIMEOUT_MS);
      } finally {
        // No query ran, so the pool holds no connection and closing it needs no server.
        await pool.end();
      }
    });

    it("a client takes the connection timeout and both statement limits", () => {
      const { Client } = loadDriver();

      const client = new Client(poolConfigFor(PLACEHOLDER_URL));

      expect(client._connectionTimeoutMillis).toBe(POOL_CONNECTION_TIMEOUT_MS);
      expect(client.connectionParameters["statement_timeout"]).toBe(STATEMENT_TIMEOUT_MS);
      expect(client.connectionParameters["query_timeout"]).toBe(QUERY_TIMEOUT_MS);
    });

    // The limit the file comment of pool-config.ts states. Pinned so that it is known, not
    // because it is wanted.
    it("a query parameter of the connection string replaces a statement limit", () => {
      const { Client } = loadDriver();

      const client = new Client(
        poolConfigFor(`${PLACEHOLDER_URL}?statement_timeout=1&query_timeout=2`),
      );

      expect(String(client.connectionParameters["statement_timeout"])).toBe("1");
      expect(String(client.connectionParameters["query_timeout"])).toBe("2");
    });

    it("a query parameter of the connection string does not replace the pool's own settings", async () => {
      const { Pool } = loadDriver();
      const pool = new Pool(
        poolConfigFor(`${PLACEHOLDER_URL}?max=99&connectionTimeoutMillis=1&idleTimeoutMillis=1`),
      );
      try {
        expect(pool.options["max"]).toBe(POOL_MAX_CONNECTIONS);
        expect(pool.options["connectionTimeoutMillis"]).toBe(POOL_CONNECTION_TIMEOUT_MS);
        expect(pool.options["idleTimeoutMillis"]).toBe(POOL_IDLE_TIMEOUT_MS);
      } finally {
        await pool.end();
      }
    });
  });
});
