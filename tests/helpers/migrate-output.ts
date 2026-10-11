/**
 * What the global setup says when `prisma migrate deploy` did not succeed, with the secrets of
 * the connection URL taken out. Pure functions; no database layer and no process is started here.
 */

const MASK = "***";

/** `text` with every occurrence of `word` that is not part of a longer word replaced. */
function maskWholeWord(text: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g"), MASK);
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `text` without the secrets of the given connection URLs:
 * - the URL itself, wherever it is repeated;
 * - the password, in the percent-encoded form the URL holds and in its decoded form (a tool that
 *   parsed the URL prints the decoded one), wherever it appears, even inside a longer word;
 * - the user name, in both forms, where it stands as a word of its own. It is not masked inside
 *   a longer word: with the local defaults the user name is also the start of the database name,
 *   and a message whose database name is masked no longer says what failed.
 * A URL that cannot be parsed is still removed as a whole string.
 */
export function redactConnectionSecrets(text: string, urls: readonly string[]): string {
  const passwords = new Set<string>();
  const users = new Set<string>();
  let safe = text;
  for (const value of urls) {
    if (value === "") {
      continue;
    }
    safe = safe.split(value).join(MASK);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    for (const password of [url.password, decoded(url.password)]) {
      if (password !== "") {
        passwords.add(password);
      }
    }
    for (const user of [url.username, decoded(url.username)]) {
      if (user !== "") {
        users.add(user);
      }
    }
  }
  // Longest first, so that a secret that contains a shorter one is masked whole.
  for (const password of [...passwords].sort((a, b) => b.length - a.length)) {
    safe = safe.split(password).join(MASK);
  }
  for (const user of [...users].sort((a, b) => b.length - a.length)) {
    safe = maskWholeWord(safe, user);
  }
  return safe;
}

/** The parts of a `spawnSync` result that say how the process ended. */
export type MigrateResult = {
  status: number | null;
  signal: string | null;
  /** `result.error?.message`: the process could not be started, or it was stopped on the timeout. */
  errorMessage: string | undefined;
  stdout: string | null | undefined;
  stderr: string | null | undefined;
};

/**
 * Undefined when `prisma migrate deploy` ended with exit status 0 and no error. Otherwise the
 * message to throw: the exit status, the signal that ended the process when there was one, the
 * start or timeout error when there was one, and the output, all without the secrets of `urls`.
 */
export function describeMigrateFailure(
  result: MigrateResult,
  urls: readonly string[],
  timeoutMs: number,
): string | undefined {
  if (result.status === 0 && result.errorMessage === undefined && result.signal === null) {
    return undefined;
  }
  const facts: string[] = [];
  facts.push(result.status === null ? "no exit status" : `exit ${result.status}`);
  if (result.signal !== null) {
    facts.push(`ended by signal ${result.signal}`);
  }
  if (result.errorMessage !== undefined) {
    const timedOut = /ETIMEDOUT/.test(result.errorMessage);
    facts.push(
      timedOut
        ? `stopped after the time limit of ${timeoutMs} ms (${result.errorMessage})`
        : `error: ${result.errorMessage}`,
    );
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const message =
    `prisma migrate deploy failed on the template test database (${facts.join("; ")}).` +
    (output === "" ? "" : `\n${output}`);
  return redactConnectionSecrets(message, urls);
}
