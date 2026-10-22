/**
 * Reads env files for the e2e refusal checks with the parser the e2e `next dev` server uses
 * (SEC-074, SEC-079).
 *
 * The server loads its files with `@next/env` (dotenv syntax). Node's `parseEnv` and any line
 * scanner disagree with it on a byte order mark, lone CR line ends, the colon form, U+2028 and
 * U+2029 as line ends, and an assignment whose name, `=` or `:`, and value sit on different lines.
 * This module therefore does not parse by itself: it hands the text to the `@next/env` that `next`
 * resolves to and reads back what that parser set. It cannot disagree with the server, because it
 * is the server's parser. If the parser cannot be loaded or fails, the function throws and the run
 * is refused (fail closed).
 *
 * No file access, no database. `process.env` is cleared for the duration of one synchronous call
 * and restored in a `finally`, and each call loads its own copy of `@next/env`, so no state is
 * shared with other callers. Safe to import from a unit test.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { REFUSED_ENVIRONMENT_VARIABLES } from "../../tests/helpers/test-database-url";
import { REPO_ROOT } from "./constants";

/** Every file `next dev` may load, whatever `NODE_ENV` is (`.env.test*` when it is `test`). */
export const NEXT_ENV_FILE_NAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
] as const;

type NextEnvModule = {
  processEnv: (
    loadedEnvFiles: Array<{ path: string; contents: string; env: Record<string, string> }>,
    dir: string,
    log: { info: () => void; error: (...args: unknown[]) => void },
    forceReload: boolean,
  ) => Array<Record<string, string | undefined> | undefined>;
};

/** A fresh copy of the `@next/env` that the repository's `next` uses. */
function loadNextEnv(): NextEnvModule {
  const requireFromRepo = createRequire(join(REPO_ROOT, "package.json"));
  const nextDir = dirname(requireFromRepo.resolve("next/package.json"));
  const requireFromNext = createRequire(join(nextDir, "package.json"));
  const entry = requireFromNext.resolve("@next/env");
  delete requireFromNext.cache[entry];
  return requireFromNext(entry) as NextEnvModule;
}

/**
 * Every assignment the e2e server's `@next/env` reads from an env file text, last one wins. Names
 * keep their letter case. Throws if the parser cannot run.
 */
export function scanEnvText(text: string): Record<string, string> {
  const saved = { ...process.env };
  const log = {
    info() {},
    error(...args: unknown[]) {
      throw new Error(`@next/env could not read the env file text: ${String(args[0])}`);
    },
  };
  const parseWith = (environment: Record<string, string | undefined>): Record<string, string> => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [name, value] of Object.entries(environment)) {
      if (value !== undefined) process.env[name] = value;
    }
    const [, parsed] = loadNextEnv().processEnv(
      [{ path: ".env", contents: text, env: {} }],
      REPO_ROOT,
      log,
      true,
    );
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed ?? {})) {
      if (value !== undefined) out[name] = value;
    }
    return out;
  };
  const isDriverName = (name: string): boolean =>
    REFUSED_ENVIRONMENT_VARIABLES.some((entry) => entry === name.toUpperCase());
  try {
    // Pass 1: empty environment, so a name the real environment already holds is still read from
    // the file (the parser skips such names).
    const result = parseWith({});
    // Pass 2 (SEC-080): the server expands `$NAME` and `${NAME}` against the real environment.
    // Parse again with the real environment, minus the driver names, and take the driver values
    // from this pass, so a driver value that only references another variable is read as the
    // server reads it.
    const withoutDrivers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(saved)) {
      if (!isDriverName(name)) withoutDrivers[name] = value;
    }
    const expanded = parseWith(withoutDrivers);
    for (const [name, value] of Object.entries(expanded)) {
      if (isDriverName(name)) result[name] = value;
    }
    return result;
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/**
 * Refuses an e2e run when `environment` sets a variable of `REFUSED_ENVIRONMENT_VARIABLES` to a
 * non-empty value (CR-155: the e2e run has its own message; the integration one says "integration
 * run"). `source` names where it came from, for example "the .env.local file". The message names
 * the variable and never its value.
 */
export function assertNoDriverOverrideForE2e(
  environment: Readonly<Record<string, string | undefined>>,
  source: string,
): void {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || value === "") continue;
    const refused = REFUSED_ENVIRONMENT_VARIABLES.find((entry) => entry === name.toUpperCase());
    if (refused !== undefined) {
      throw new Error(
        `End-to-end run refused: ${refused} is set in ${source}; the e2e server's database driver would apply it on top of the e2e database URL. Unset it for the e2e run. Nothing was started.`,
      );
    }
  }
}

/**
 * Every development `DATABASE_URL` in play for the e2e run, with where it was read from, in the
 * form `resolveTestDatabase` takes (`otherUrls`, `otherSources`; CR-156, CR-158, CR-159). Empty
 * values are dropped. Pure, so a test can show that a URL held only in `.env.local` is compared.
 */
export function collectDevelopmentUrls(input: {
  processUrl: string | undefined;
  envFileUrl: string | undefined;
  nextFiles: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;
}): { otherUrls: string[]; otherSources: string[] } {
  const entries: Array<[string | undefined, string]> = [
    [input.processUrl, "the environment"],
    [input.envFileUrl, "the .env file"],
    ...input.nextFiles.map(([name, content]): [string | undefined, string] => [
      content["DATABASE_URL"],
      `the ${name} file`,
    ]),
  ];
  const otherUrls: string[] = [];
  const otherSources: string[] = [];
  for (const [value, source] of entries) {
    if (value === undefined || value === "") continue;
    otherUrls.push(value);
    otherSources.push(source);
  }
  return { otherUrls, otherSources };
}
