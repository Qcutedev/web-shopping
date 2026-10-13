/**
 * When the seed refuses to run (T-014; DATA_MODEL.md section 18).
 *
 * The seed writes sample accounts whose password is published in DATA_MODEL.md section 18. It
 * must therefore never reach a database that real people use. Two independent checks, both
 * required:
 *
 *   1. `NODE_ENV` is unset, empty, `development`, or `test`. `production` is refused in any
 *      letter case and with surrounding blanks; any other value is refused as unknown, the same
 *      three values `src/server/env.ts` accepts.
 *   2. `DATABASE_URL` names a database on this machine: the host the database driver would
 *      connect to is `localhost` or a loopback address (127.0.0.0/8 or ::1). The host is asked of
 *      the driver itself (`describeConnectionTarget`, CR-42), not read with `URL`, because the
 *      driver lets a `host` query parameter or `PGHOST` replace what stands in front of the path.
 *      A Unix-socket directory is refused too: it cannot be told apart from a socket mounted from
 *      elsewhere, and the local containers listen on TCP.
 *
 * Pure: the environment and the driver lookup are parameters. No message holds a value of a
 * variable (SECURITY.md SR-04: a connection string may carry a password).
 */

export interface SeedConnectionTarget {
  host: string;
}

/** `describeConnectionTarget` of src/server/db, or a stand-in in a test. Throws when unreadable. */
export type DescribeTarget = (url: string) => SeedConnectionTarget;

export type SeedEnvSource = Readonly<Record<string, string | undefined>>;

export const SEED_REFUSAL = {
  production: "NODE_ENV is production. The seed never runs in production. Nothing was changed.",
  unknownNodeEnv: "NODE_ENV must be unset, development, or test for the seed. Nothing was changed.",
  missingUrl: "DATABASE_URL is required. Nothing was changed.",
  unreadableUrl:
    "DATABASE_URL cannot be read the way the database driver reads it. Nothing was changed.",
  notLocal:
    "DATABASE_URL does not name a database on this machine (host must be localhost, 127.0.0.0/8, or ::1 over TCP). The seed runs against local development and test databases only. Nothing was changed.",
} as const;

export type SeedRefusalCode = keyof typeof SEED_REFUSAL;

export interface SeedRefusal {
  code: SeedRefusalCode;
  message: string;
}

const ALLOWED_NODE_ENV = new Set(["", "development", "test"]);

const IPV4_LOOPBACK =
  /^127\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** True only for `localhost`, an IPv4 loopback address in dotted-decimal form, or `::1`. */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (value === "localhost" || value === "localhost.") return true;
  if (value === "::1" || value === "[::1]") return true;
  return IPV4_LOOPBACK.test(value);
}

function refuse(code: SeedRefusalCode): SeedRefusal {
  return { code, message: SEED_REFUSAL[code] };
}

/**
 * `null` when the seed may run against the environment's database, otherwise the first reason it
 * may not. `NODE_ENV` is checked before the URL is looked at.
 */
export function checkSeedEnvironment(
  env: SeedEnvSource,
  describe: DescribeTarget,
): SeedRefusal | null {
  const nodeEnv = (env["NODE_ENV"] ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return refuse("production");
  if (!ALLOWED_NODE_ENV.has(nodeEnv)) return refuse("unknownNodeEnv");

  const url = env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") return refuse("missingUrl");

  let target: SeedConnectionTarget;
  try {
    target = describe(url);
  } catch {
    // Whatever was thrown may quote the string; none of it is kept.
    return refuse("unreadableUrl");
  }
  if (!isLoopbackHost(target.host)) return refuse("notLocal");
  return null;
}
