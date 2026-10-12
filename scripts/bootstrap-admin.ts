/**
 * Creates an admin account (T-016; REQ-A-11, BR-26). Usage and behaviour: docs/DEPLOYMENT.md,
 * "First administrator". All logic is in src/modules/auth/bootstrap-admin.ts.
 *
 *   $env:ADMIN_BOOTSTRAP_EMAIL = "admin@example.com"
 *   $env:ADMIN_BOOTSTRAP_PASSWORD = "<a password of 8 to 128 characters>"
 *   pnpm admin:bootstrap
 *   Remove-Item Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_PASSWORD
 *
 * Input is read from the environment only. There is no command-line argument for it, so the
 * password never appears in shell history or in the process list. There is no default.
 *
 * A local `.env` is loaded the way prisma7.config.ts loads it (for DATABASE_URL in development):
 * it never overrides a variable that is already set. Do not put the bootstrap variables in it.
 */
import { existsSync } from "node:fs";

import { BOOTSTRAP_EXIT, runBootstrapAdmin } from "../src/modules/auth/bootstrap-admin";
import { db } from "../src/server/db";

/** The class name of a thrown value; never its message, which may quote a line of `.env`. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Loads `.env` when present. False, with a message naming no value, when it cannot be read. */
function loadLocalEnv(): boolean {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
    return true;
  } catch (error) {
    process.stderr.write(
      `Admin bootstrap could not read .env (${errorName(error)}). Fix or remove the file, then run it again. Nothing changed.\n`,
    );
    return false;
  }
}

async function main(): Promise<number> {
  if (!loadLocalEnv()) return BOOTSTRAP_EXIT.failed;
  const source = { ...process.env };
  // Not needed after this point; keep the password out of anything that reads the environment.
  delete process.env["ADMIN_BOOTSTRAP_PASSWORD"];
  try {
    return await runBootstrapAdmin(source, {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    });
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error: unknown) => {
    // runBootstrapAdmin reports its own failures; what reaches here is outside it, for example
    // closing the database connection.
    process.stderr.write(`Admin bootstrap failed unexpectedly (${errorName(error)}).\n`);
    process.exitCode = BOOTSTRAP_EXIT.failed;
  },
);
