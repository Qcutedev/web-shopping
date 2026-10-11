/**
 * What the global setup reports when `prisma migrate deploy` did not succeed
 * (tests/helpers/migrate-output.ts; review finding CR-29): every way the process can end is
 * reported, and no secret of the connection URL is in the report. Pure functions; this file
 * uses no database. Every URL, user, and password below is invented.
 */
import { describe, expect, it } from "vitest";

import { describeMigrateFailure, redactConnectionSecrets } from "../../helpers/migrate-output";

// A password with characters that a URL must encode, so its two forms differ.
const PASSWORD_DECODED = "p@ss/MUST#NOT:LEAK 9";
const PASSWORD_ENCODED = "p%40ss%2FMUST%23NOT%3ALEAK%209";
const USER = "marketplace";
const BASE_URL = `postgresql://${USER}:${PASSWORD_ENCODED}@127.0.0.1:5433/marketplace_test?schema=public`;
const TEMPLATE_URL = `postgresql://${USER}:${PASSWORD_ENCODED}@127.0.0.1:5433/marketplace_test_template?schema=public`;
const URLS = [BASE_URL, TEMPLATE_URL];

describe("redactConnectionSecrets", () => {
  it("has a test password whose encoded and decoded forms differ", () => {
    expect(new URL(BASE_URL).password).toBe(PASSWORD_ENCODED);
    expect(decodeURIComponent(PASSWORD_ENCODED)).toBe(PASSWORD_DECODED);
    expect(PASSWORD_DECODED).not.toBe(PASSWORD_ENCODED);
  });

  it("masks the password in the form the URL holds", () => {
    const safe = redactConnectionSecrets(`cannot log in with ${PASSWORD_ENCODED} today`, URLS);

    expect(safe).toBe("cannot log in with *** today");
  });

  // The gap of CR-29: a tool that parsed the URL prints the decoded password, and only the
  // encoded form was masked.
  it("masks the password in its decoded form", () => {
    const safe = redactConnectionSecrets(`password "${PASSWORD_DECODED}" was refused`, URLS);

    expect(safe).toBe('password "***" was refused');
    expect(safe).not.toContain(PASSWORD_DECODED);
  });

  it("masks the password inside a longer word", () => {
    const safe = redactConnectionSecrets(`x${PASSWORD_DECODED}y and x${PASSWORD_ENCODED}y`, URLS);

    expect(safe).toBe("x***y and x***y");
  });

  it("masks the whole URL wherever it is repeated", () => {
    const safe = redactConnectionSecrets(`tried ${TEMPLATE_URL}, then ${BASE_URL}.`, URLS);

    expect(safe).toBe("tried ***, then ***.");
  });

  it("masks the user name where it stands alone, and keeps the database name readable", () => {
    const output =
      `Datasource "db": PostgreSQL database "marketplace_test_template" at "127.0.0.1:5433"\n` +
      `Error: P1000: Authentication failed for user \`${USER}\` (${USER}@127.0.0.1)`;

    const safe = redactConnectionSecrets(output, URLS);

    expect(safe).toContain('database "marketplace_test_template" at "127.0.0.1:5433"');
    expect(safe).toContain("Authentication failed for user `***` (***@127.0.0.1)");
  });

  it("masks an encoded user name in both forms", () => {
    const url = "postgresql://us%40er:pw-MUST-NOT-LEAK@127.0.0.1:5433/shop_test";

    const safe = redactConnectionSecrets("role us@er, written us%40er, and pw-MUST-NOT-LEAK", [
      url,
    ]);

    expect(safe).toBe("role ***, written ***, and ***");
  });

  it("masks the longer of two passwords first when one starts with the other", () => {
    const urls = [
      "postgresql://tester:secret@127.0.0.1:5433/shop_test",
      "postgresql://tester:secret-and-more@127.0.0.1:5433/shop_test_template",
    ];

    // Masking `secret` first would leave `***-and-more` readable.
    expect(redactConnectionSecrets("secret-and-more, secret", urls)).toBe("***, ***");
  });

  it("masks the password before the user name, so a password that starts with it leaves no rest", () => {
    const url = "postgresql://abc:abc-rest@127.0.0.1:5433/shop_test";

    expect(redactConnectionSecrets("abc-rest and abc", [url])).toBe("*** and ***");
  });

  it("leaves text without secrets as it is, and copes with a URL without credentials", () => {
    const text = "1 migration found in prisma/migrations";

    expect(redactConnectionSecrets(text, URLS)).toBe(text);
    expect(redactConnectionSecrets(text, ["postgresql://127.0.0.1:5433/shop_test", ""])).toBe(text);
  });

  it("still removes a URL that cannot be parsed", () => {
    const broken = "postgresql://tester:pw-MUST-NOT-LEAK@[not-a-host/shop_test";

    expect(redactConnectionSecrets(`failed for ${broken}`, [broken])).toBe("failed for ***");
  });
});

describe("describeMigrateFailure", () => {
  const TIMEOUT_MS = 120_000;
  const ok = { status: 0, signal: null, errorMessage: undefined, stdout: "done", stderr: "" };

  it("reports nothing when the process ended with exit status 0", () => {
    expect(describeMigrateFailure(ok, URLS, TIMEOUT_MS)).toBeUndefined();
  });

  it("reports the exit status and the output, without the password in either form", () => {
    const message = describeMigrateFailure(
      {
        ...ok,
        status: 1,
        stdout: `Datasource "db" at "127.0.0.1:5433"`,
        stderr: `Error: P1000 for ${USER} with ${PASSWORD_DECODED} (${BASE_URL})`,
      },
      URLS,
      TIMEOUT_MS,
    );

    expect(message).toContain(
      "prisma migrate deploy failed on the template test database (exit 1).",
    );
    expect(message).toContain('Datasource "db" at "127.0.0.1:5433"');
    expect(message).toContain("Error: P1000 for *** with *** (***)");
    expect(message).not.toContain(PASSWORD_DECODED);
    expect(message).not.toContain(PASSWORD_ENCODED);
    expect(message).not.toContain("postgresql://");
  });

  // The three results the earlier code reported as "exit null", or not at all.
  it("reports the time limit when the process was stopped on it", () => {
    const message = describeMigrateFailure(
      {
        status: null,
        signal: "SIGKILL",
        errorMessage: "spawnSync node ETIMEDOUT",
        stdout: "",
        stderr: "",
      },
      URLS,
      TIMEOUT_MS,
    );

    expect(message).toBe(
      "prisma migrate deploy failed on the template test database (no exit status; ended by signal SIGKILL; stopped after the time limit of 120000 ms (spawnSync node ETIMEDOUT)).",
    );
  });

  it("reports the signal when the process was ended by one", () => {
    const message = describeMigrateFailure(
      { status: null, signal: "SIGTERM", errorMessage: undefined, stdout: "partial", stderr: "" },
      URLS,
      TIMEOUT_MS,
    );

    expect(message).toBe(
      "prisma migrate deploy failed on the template test database (no exit status; ended by signal SIGTERM).\npartial",
    );
  });

  it("reports the error when the process could not be started", () => {
    const message = describeMigrateFailure(
      {
        status: null,
        signal: null,
        errorMessage: "spawnSync node ENOENT",
        stdout: null,
        stderr: null,
      },
      URLS,
      TIMEOUT_MS,
    );

    expect(message).toBe(
      "prisma migrate deploy failed on the template test database (no exit status; error: spawnSync node ENOENT).",
    );
  });

  it("reports an error even when the exit status is 0", () => {
    const message = describeMigrateFailure(
      { ...ok, errorMessage: "spawnSync node ENOBUFS" },
      URLS,
      TIMEOUT_MS,
    );

    expect(message).toContain("(exit 0; error: spawnSync node ENOBUFS)");
  });

  it("takes the secrets out of the error message too", () => {
    const message = describeMigrateFailure(
      {
        status: null,
        signal: null,
        errorMessage: `spawn failed with DATABASE_URL=${TEMPLATE_URL} and ${PASSWORD_DECODED}`,
        stdout: "",
        stderr: "",
      },
      URLS,
      TIMEOUT_MS,
    );

    expect(message).toContain("error: spawn failed with DATABASE_URL=*** and ***");
    expect(message).not.toContain(PASSWORD_DECODED);
    expect(message).not.toContain(PASSWORD_ENCODED);
  });
});
