/**
 * Unit tests of the admin bootstrap (T-016): input rules, exit statuses, output hygiene, and the
 * password hash format. No database: the step that writes rows is replaced. The rows themselves
 * are tested in tests/integration/auth/bootstrap-admin.test.ts.
 */
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { describe, expect, it, vi } from "vitest";

import {
  BOOTSTRAP_ENV,
  BOOTSTRAP_EXIT,
  BOOTSTRAP_RULES,
  type BootstrapAdminInput,
  type BootstrapAdminOutcome,
  BootstrapInputError,
  DEFAULT_ADMIN_NAME,
  readBootstrapInput,
  runBootstrapAdmin,
} from "./bootstrap-admin";

const PASSWORD = "Sup3r secret admin pass";
const EMAIL = "Root.Admin@Example.com";

function env(values: Record<string, string | undefined>) {
  return values;
}

function capture() {
  const lines: string[] = [];
  return {
    lines,
    output: {
      out: (line: string) => lines.push(`out:${line}`),
      err: (line: string) => lines.push(`err:${line}`),
    },
  };
}

function issuesOf(fn: () => unknown): { variable: string; rule: string }[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BootstrapInputError);
    return [...(error as BootstrapInputError).issues];
  }
  throw new Error("expected BootstrapInputError");
}

describe("readBootstrapInput", () => {
  it("accepts valid input, lower-cases and trims the email, and defaults the name", () => {
    const input = readBootstrapInput(
      env({ [BOOTSTRAP_ENV.email]: `  ${EMAIL} `, [BOOTSTRAP_ENV.password]: PASSWORD }),
    );
    expect(input).toEqual({
      email: "root.admin@example.com",
      password: PASSWORD,
      name: DEFAULT_ADMIN_NAME,
    });
  });

  it("takes the optional display name", () => {
    const input = readBootstrapInput(
      env({
        [BOOTSTRAP_ENV.email]: EMAIL,
        [BOOTSTRAP_ENV.password]: PASSWORD,
        [BOOTSTRAP_ENV.name]: " ผู้ดูแลระบบ ",
      }),
    );
    expect(input.name).toBe("ผู้ดูแลระบบ");
  });

  it("requires both the email and the password, naming each variable", () => {
    expect(issuesOf(() => readBootstrapInput(env({})))).toEqual([
      { variable: BOOTSTRAP_ENV.email, rule: BOOTSTRAP_RULES.required },
      { variable: BOOTSTRAP_ENV.password, rule: BOOTSTRAP_RULES.required },
    ]);
    expect(
      issuesOf(() =>
        readBootstrapInput(env({ [BOOTSTRAP_ENV.email]: "", [BOOTSTRAP_ENV.password]: "" })),
      ),
    ).toHaveLength(2);
  });

  it("applies the sign-up password policy: 8 to 128 characters (REQ-C-01)", () => {
    for (const password of ["1234567", "x".repeat(129)]) {
      expect(
        issuesOf(() =>
          readBootstrapInput(
            env({ [BOOTSTRAP_ENV.email]: EMAIL, [BOOTSTRAP_ENV.password]: password }),
          ),
        ),
      ).toEqual([{ variable: BOOTSTRAP_ENV.password, rule: BOOTSTRAP_RULES.password }]);
    }
    for (const password of ["12345678", "x".repeat(128)]) {
      expect(
        readBootstrapInput(
          env({ [BOOTSTRAP_ENV.email]: EMAIL, [BOOTSTRAP_ENV.password]: password }),
        ).password,
      ).toBe(password);
    }
  });

  it("refuses an invalid email and an invalid name", () => {
    expect(
      issuesOf(() =>
        readBootstrapInput(
          env({
            [BOOTSTRAP_ENV.email]: "not-an-email",
            [BOOTSTRAP_ENV.password]: PASSWORD,
            [BOOTSTRAP_ENV.name]: "bad\u0000name",
          }),
        ),
      ),
    ).toEqual([
      { variable: BOOTSTRAP_ENV.email, rule: BOOTSTRAP_RULES.email },
      { variable: BOOTSTRAP_ENV.name, rule: BOOTSTRAP_RULES.name },
    ]);
  });

  it("never puts a value into the error message", () => {
    const secret = "short1";
    try {
      readBootstrapInput(env({ [BOOTSTRAP_ENV.email]: "x@y", [BOOTSTRAP_ENV.password]: secret }));
      throw new Error("expected BootstrapInputError");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(BOOTSTRAP_ENV.password);
      expect(message).not.toContain(secret);
      expect(message).not.toContain("x@y");
    }
  });
});

describe("runBootstrapAdmin", () => {
  const valid = env({ [BOOTSTRAP_ENV.email]: EMAIL, [BOOTSTRAP_ENV.password]: PASSWORD });

  async function run(
    source: Record<string, string | undefined>,
    result: BootstrapAdminOutcome | Error,
  ) {
    const { lines, output } = capture();
    const bootstrap = vi.fn<(input: BootstrapAdminInput) => Promise<BootstrapAdminOutcome>>(
      async () => {
        if (result instanceof Error) throw result;
        return result;
      },
    );
    const status = await runBootstrapAdmin(source, output, { bootstrap });
    return { status, lines, bootstrap };
  }

  it("exits 0 when an admin is created, and passes the normalised input", async () => {
    const { status, lines, bootstrap } = await run(valid, { kind: "CREATED", userId: "u1" });
    expect(status).toBe(BOOTSTRAP_EXIT.ok);
    expect(bootstrap).toHaveBeenCalledWith({
      email: "root.admin@example.com",
      password: PASSWORD,
      name: DEFAULT_ADMIN_NAME,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^out:Admin created \(user id u1\)/);
  });

  it("exits 0 and says so when the email already belongs to an admin", async () => {
    const { status, lines } = await run(valid, {
      kind: "ALREADY_ADMIN",
      userId: "u2",
      isActive: true,
    });
    expect(status).toBe(BOOTSTRAP_EXIT.ok);
    expect(lines[0]).toMatch(/^out:No change: the email already belongs to an admin/);
  });

  it("exits 3 when the email belongs to a customer or a seller", async () => {
    for (const role of ["CUSTOMER", "SELLER"] as const) {
      const { status, lines } = await run(valid, { kind: "REFUSED", userId: "u3", role });
      expect(status).toBe(BOOTSTRAP_EXIT.refused);
      expect(lines[0]).toMatch(new RegExp(`^err:Refused: .*existing ${role} account`));
    }
  });

  it("exits 2 on invalid input without calling the database step", async () => {
    const { status, lines, bootstrap } = await run(
      env({ [BOOTSTRAP_ENV.email]: EMAIL, [BOOTSTRAP_ENV.password]: "short" }),
      { kind: "CREATED", userId: "never" },
    );
    expect(status).toBe(BOOTSTRAP_EXIT.invalidInput);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain(BOOTSTRAP_ENV.password);
  });

  it("exits 1 on an unexpected failure and reports only the error class", async () => {
    const failure = new Error(`connection failed for ${PASSWORD} and ${EMAIL}`);
    const { status, lines } = await run(valid, failure);
    expect(status).toBe(BOOTSTRAP_EXIT.failed);
    expect(lines).toEqual(["err:Admin bootstrap failed: Error. No admin was created by this run."]);
  });

  it("never writes the password or the email, whatever the outcome", async () => {
    const outcomes: (BootstrapAdminOutcome | Error)[] = [
      { kind: "CREATED", userId: "a" },
      { kind: "ALREADY_ADMIN", userId: "b", isActive: false },
      { kind: "REFUSED", userId: "c", role: "SELLER" },
      new Error(PASSWORD),
    ];
    for (const outcome of outcomes) {
      const { lines } = await run(valid, outcome);
      const text = lines.join("\n").toLowerCase();
      expect(text).not.toContain(PASSWORD.toLowerCase());
      expect(text).not.toContain(EMAIL.toLowerCase());
    }
  });
});

describe("password hash format", () => {
  it("is the library's own scrypt format, which the library verifies at sign-in", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword({ hash, password: PASSWORD })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong password" })).toBe(false);
  });
});
