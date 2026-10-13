/**
 * The seed's refusal logic (T-014; prisma/seed/guard.ts). No database: the URL cases go through
 * the real driver lookup (`describeConnectionTarget`), which opens no connection.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeConnectionTarget } from "@/server/db";

import {
  checkSeedEnvironment,
  isLoopbackHost,
  SEED_REFUSAL,
  type DescribeTarget,
} from "../../../prisma/seed/guard";

const LOCAL_URL =
  "postgresql://marketplace:local_dev_only_not_a_secret@127.0.0.1:5432/marketplace_dev?schema=public";
const REMOTE_URL = "postgresql://app:pw@db.prod.example.net:5432/marketplace?sslmode=verify-full";

const PG_VARIABLES = ["PGHOST", "PGPORT", "PGUSER", "PGDATABASE"] as const;
let saved: Partial<Record<(typeof PG_VARIABLES)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const name of PG_VARIABLES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of PG_VARIABLES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function check(env: Record<string, string | undefined>) {
  return checkSeedEnvironment(env, describeConnectionTarget);
}

describe("checkSeedEnvironment: NODE_ENV", () => {
  it.each([undefined, "", "development", "test", " Development ", "TEST"])(
    "runs against a local database with NODE_ENV=%j",
    (nodeEnv) => {
      expect(check({ NODE_ENV: nodeEnv, DATABASE_URL: LOCAL_URL })).toBeNull();
    },
  );

  it.each(["production", "PRODUCTION", " production ", "Production\n"])(
    "refuses NODE_ENV=%j even with a local database",
    (nodeEnv) => {
      expect(check({ NODE_ENV: nodeEnv, DATABASE_URL: LOCAL_URL })?.code).toBe("production");
    },
  );

  it.each(["staging", "prod", "dev"])("refuses an unknown NODE_ENV=%j", (nodeEnv) => {
    expect(check({ NODE_ENV: nodeEnv, DATABASE_URL: LOCAL_URL })?.code).toBe("unknownNodeEnv");
  });

  it("checks NODE_ENV before it looks at the URL", () => {
    let called = false;
    const describeSpy: DescribeTarget = () => {
      called = true;
      return { host: "127.0.0.1" };
    };
    const refusal = checkSeedEnvironment(
      { NODE_ENV: "production", DATABASE_URL: LOCAL_URL },
      describeSpy,
    );
    expect(refusal?.code).toBe("production");
    expect(called).toBe(false);
  });
});

describe("checkSeedEnvironment: DATABASE_URL", () => {
  it.each([undefined, "", "   "])("refuses a missing DATABASE_URL (%j)", (url) => {
    expect(check({ DATABASE_URL: url })?.code).toBe("missingUrl");
  });

  it.each([
    LOCAL_URL,
    "postgresql://u:p@localhost:5432/db",
    "postgresql://u:p@[::1]:5432/db",
    "postgresql://u:p@127.0.0.2:5433/db",
  ])("runs against %s", (url) => {
    expect(check({ DATABASE_URL: url })).toBeNull();
  });

  it.each([
    REMOTE_URL,
    "postgresql://u:p@10.0.0.5:5432/db",
    "postgresql://u:p@192.168.1.10:5432/db",
    "postgresql://u:p@db:5432/db",
    "postgresql://u:p@127.0.0.1.nip.io:5432/db",
    "postgresql://u:p@localhost.example.com:5432/db",
    "postgresql://u:p@[::ffff:7f00:1]:5432/db",
  ])("refuses a database that is not on this machine: %s", (url) => {
    expect(check({ DATABASE_URL: url })?.code).toBe("notLocal");
  });

  it("refuses a local-looking URL whose host query parameter names another server", () => {
    // The driver lets `?host=` replace the host in front of the path; URL would not.
    const url = "postgresql://u:p@127.0.0.1:5432/db?host=db.prod.example.net";
    expect(new URL(url).hostname).toBe("127.0.0.1");
    expect(check({ DATABASE_URL: url })?.code).toBe("notLocal");
  });

  it("refuses an empty host that PGHOST fills with another server", () => {
    // Without PGHOST the driver's default host is localhost, so the same URL is allowed.
    expect(check({ DATABASE_URL: "postgresql://u:p@/db" })).toBeNull();
    process.env["PGHOST"] = "db.prod.example.net";
    expect(check({ DATABASE_URL: "postgresql://u:p@/db" })?.code).toBe("notLocal");
  });

  it("refuses a Unix-socket directory", () => {
    expect(check({ DATABASE_URL: "postgresql://u:p@/db?host=/var/run/postgresql" })?.code).toBe(
      "notLocal",
    );
  });

  it("refuses a URL the driver cannot read, and keeps nothing of what was thrown", () => {
    const throwing: DescribeTarget = () => {
      throw new Error(`cannot read ${REMOTE_URL}`);
    };
    const refusal = checkSeedEnvironment({ DATABASE_URL: REMOTE_URL }, throwing);
    expect(refusal?.code).toBe("unreadableUrl");
    expect(refusal?.message).not.toContain("example.net");
  });

  it("no refusal message holds a value", () => {
    for (const message of Object.values(SEED_REFUSAL)) {
      expect(message).not.toMatch(/postgres|example|pw@|127\.0\.0\.1:/);
    }
  });
});

describe("isLoopbackHost", () => {
  it.each(["localhost", "LOCALHOST", "localhost.", "127.0.0.1", "127.255.255.254", "::1", "[::1]"])(
    "accepts %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([
    "",
    "0.0.0.0",
    "128.0.0.1",
    "127.0.0.256",
    "127.0.0",
    "127.0.0.1.example.com",
    "0177.0.0.1",
    "::",
    "::2",
    "/var/run/postgresql",
    "localhost.localdomain",
  ])("refuses %j", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
