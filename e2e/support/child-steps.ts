/**
 * Child-process steps against the e2e database, shared by global-setup.ts and by specs that seed
 * their own temporary data (e2e/pagination.spec.ts). Moved out of global-setup.ts unchanged, so a
 * spec step runs with the same scrubbed environment: no PG* variable, no DATABASE_URL_TEST, and
 * DATABASE_URL set to the e2e database.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { redactConnectionSecrets } from "../../tests/helpers/migrate-output";
import { inheritedDatabaseVariableNames } from "../../tests/helpers/test-database-url";
import { E2E_BASE_DATABASE, E2E_DATABASE_URL, REPO_ROOT, readEnvFile } from "./environment";

/** Longest time one child step may take. `prisma migrate deploy` on an empty database takes seconds. */
const STEP_TIMEOUT_MS = 120_000;

const SECRET_URLS = [E2E_BASE_DATABASE.baseUrl, E2E_DATABASE_URL];

export function childEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of inheritedDatabaseVariableNames(env)) {
    delete env[name];
  }
  // prisma7.config.ts loads `.env` without overriding a variable that is already set, so the
  // names the file holds (PG* and DATABASE_URL_TEST) are set to empty for the child, as the
  // integration setup does.
  for (const name of inheritedDatabaseVariableNames(readEnvFile())) {
    env[name] = "";
  }
  env["DATABASE_URL"] = databaseUrl;
  return env;
}

/** Runs `node <script> <args>` without a shell; failure text has the URLs' secrets removed (CR-29). */
export function run(label: string, script: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [resolve(script), ...args], {
    env,
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: STEP_TIMEOUT_MS,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  if (result.status === 0 && result.error === undefined && result.signal === null) return;
  const facts = [
    result.status === null ? "no exit status" : `exit ${result.status}`,
    ...(result.signal !== null ? [`signal ${result.signal}`] : []),
    ...(result.error !== undefined ? [`error: ${result.error.message}`] : []),
  ].join("; ");
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  throw new Error(
    redactConnectionSecrets(
      `e2e setup: ${label} failed (${facts}).${output === "" ? "" : `\n${output}`}`,
      SECRET_URLS,
    ),
  );
}

const requireFromRepo = createRequire(join(REPO_ROOT, "package.json"));

/** Absolute path of a package's command-line entry, as its own `bin` field names it (CR-148). */
export function binPath(packageName: string, binName: string): string {
  const manifestPath = requireFromRepo.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (relative === undefined) throw new Error(`e2e setup: ${packageName} has no bin ${binName}`);
  return resolve(dirname(manifestPath), relative);
}

export const PRISMA_CLI = binPath("prisma", "prisma");
export const TSX_CLI = binPath("tsx", "tsx");

/** Runs a tsx script of tests/e2e-support against the e2e database. */
export function runE2eScript(label: string, script: string, args: string[] = []): void {
  run(
    label,
    TSX_CLI,
    [resolve(REPO_ROOT, "tests/e2e-support", script), ...args],
    childEnvironment(E2E_DATABASE_URL),
  );
}
