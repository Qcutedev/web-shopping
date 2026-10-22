/**
 * Reads env files for the e2e refusal checks the way the e2e `next dev` server reads them (SEC-074).
 *
 * The server loads its files with `@next/env` (dotenv syntax). Node's `parseEnv` disagrees with
 * that parser on a byte order mark, on lone CR line ends, and on the colon form `NAME: value`, so
 * a file could set `PGOPTIONS` for the server while the check saw nothing. This scanner is
 * deliberately lenient and over-reports: it accepts every form dotenv accepts. A line that dotenv
 * would not read as an assignment may also be flagged; refusing a run for it is the safe side.
 *
 * Pure: no file access, no environment, no database. Safe to import from a unit test.
 */

import { REFUSED_ENVIRONMENT_VARIABLES } from "../../tests/helpers/test-database-url";

/** Every file `next dev` may load, whatever `NODE_ENV` is (`.env.test*` when it is `test`). */
export const NEXT_ENV_FILE_NAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
] as const;

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/;

function cleanValue(rest: string): string {
  const text = rest.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = text.indexOf(quote, 1);
    return end === -1 ? text.slice(1) : text.slice(1, end);
  }
  const hash = text.search(/(^|\s)#/);
  return (hash === -1 ? text : text.slice(0, hash)).trim();
}

/**
 * Every `NAME=value` and `NAME: value` assignment of an env file text, last one wins. Names keep
 * their letter case. A leading byte order mark is dropped; CRLF, CR, and LF all end a line.
 */
export function scanEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  for (const line of lines) {
    const match = ASSIGNMENT.exec(line);
    if (match === null) continue;
    result[match[1] as string] = cleanValue(match[2] ?? "");
  }
  return result;
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
