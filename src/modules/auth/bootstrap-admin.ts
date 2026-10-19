/**
 * Admin bootstrap (T-016; REQ-A-11, BR-26; DATA_MODEL.md section 4.1).
 *
 * The only way an `ADMIN` account comes to exist in the MVP. `scripts/bootstrap-admin.ts` calls
 * `runBootstrapAdmin` and does nothing else; everything that can be tested is here.
 *
 * Input comes from the environment only, never from the command line, so the password does not
 * land in shell history or in the process list:
 *
 *   ADMIN_BOOTSTRAP_EMAIL     required; the same email rules as sign-up
 *   ADMIN_BOOTSTRAP_PASSWORD  required; the REQ-C-01 policy of sign-up: 8 to 128 characters
 *   ADMIN_BOOTSTRAP_NAME      optional display name; the same rules as the sign-up name;
 *                             default "Admin"
 *
 * What a run does with the email (BR-26, D-028):
 *
 *   - no account has it: one `User` (role `ADMIN`) and one credential `Account` are inserted in
 *     one transaction; exit 0;
 *   - an `ADMIN` account has it: nothing changes, the password given is not compared or stored;
 *     exit 0;
 *   - a `CUSTOMER` or `SELLER` account has it: refused, nothing changes; exit 3. An existing
 *     account is never promoted.
 *
 * The email is compared without regard to letter case, and stored lower-cased, as the auth
 * library does at sign-up and sign-in (question T8 of TEST_STRATEGY.md).
 *
 * Rows have the auth library's formats, so the admin signs in through `POST /api/v1/auth/sign-in`
 * like anyone else: the id is the library's 32-character random string, and the password hash is
 * the library's own `hashPassword` (scrypt), which is what the instance in src/server/auth/auth.ts
 * uses because it configures no custom hasher. A unit test checks the hash with the library's
 * `verifyPassword`, and an integration test signs in as the bootstrapped admin.
 *
 * This module does not import src/server/auth (D-022). It imports the library's crypto helpers
 * directly, and the database layer (allowed for src/modules by rule 7).
 *
 * Nothing written to the output holds the password or its hash. Errors are reported by class name
 * and Prisma error code only (SR-04).
 */
import { generateRandomString, hashPassword } from "better-auth/crypto";

import { db, isUniqueViolation, Prisma, Role } from "@/server/db";

import { signUpBodySchema } from "./schema";

export const BOOTSTRAP_ENV = {
  email: "ADMIN_BOOTSTRAP_EMAIL",
  password: "ADMIN_BOOTSTRAP_PASSWORD",
  name: "ADMIN_BOOTSTRAP_NAME",
} as const;

export const DEFAULT_ADMIN_NAME = "Admin";

/** The provider id the library gives an email-and-password account. */
export const CREDENTIAL_PROVIDER_ID = "credential";

/** Exit statuses of the script. */
export const BOOTSTRAP_EXIT = {
  /** An admin was created, or the email already belongs to an admin (no change). */
  ok: 0,
  /** Unexpected failure (database unreachable, ...). Nothing is known to have changed. */
  failed: 1,
  /** An input variable is missing or breaks a rule. Nothing changed. */
  invalidInput: 2,
  /** The email belongs to a customer or a seller. Nothing changed. */
  refused: 3,
} as const;

/** Rule texts. None of them contains a value. */
export const BOOTSTRAP_RULES = {
  required: "is required",
  email: "must be a valid email address of at most 254 characters",
  password: "must be 8 to 128 characters long (the sign-up password policy, REQ-C-01)",
  name: "must be 1 to 100 characters with no control or bidirectional formatting characters",
} as const;

export interface BootstrapIssue {
  variable: string;
  rule: string;
}

export class BootstrapInputError extends Error {
  readonly issues: readonly BootstrapIssue[];

  constructor(issues: readonly BootstrapIssue[]) {
    super(
      [
        "Invalid admin bootstrap input. Nothing was changed.",
        ...issues.map((issue) => `- ${issue.variable} ${issue.rule}`),
      ].join("\n"),
    );
    this.name = "BootstrapInputError";
    this.issues = issues;
  }
}

export interface BootstrapAdminInput {
  /** Trimmed and lower-cased. */
  email: string;
  password: string;
  name: string;
}

export type BootstrapEnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Reads and validates the input variables. Throws `BootstrapInputError` naming each faulty
 * variable and its rule, never its value.
 */
export function readBootstrapInput(source: BootstrapEnvSource): BootstrapAdminInput {
  const issues: BootstrapIssue[] = [];
  const shape = signUpBodySchema.shape;

  const rawEmail = source[BOOTSTRAP_ENV.email];
  let email = "";
  if (rawEmail === undefined || rawEmail === "") {
    issues.push({ variable: BOOTSTRAP_ENV.email, rule: BOOTSTRAP_RULES.required });
  } else {
    const parsed = shape.email.safeParse(rawEmail);
    if (parsed.success) email = parsed.data.toLowerCase();
    else issues.push({ variable: BOOTSTRAP_ENV.email, rule: BOOTSTRAP_RULES.email });
  }

  const rawPassword = source[BOOTSTRAP_ENV.password];
  let password = "";
  if (rawPassword === undefined || rawPassword === "") {
    issues.push({ variable: BOOTSTRAP_ENV.password, rule: BOOTSTRAP_RULES.required });
  } else {
    const parsed = shape.password.safeParse(rawPassword);
    if (parsed.success) password = parsed.data;
    else issues.push({ variable: BOOTSTRAP_ENV.password, rule: BOOTSTRAP_RULES.password });
  }

  const rawName = source[BOOTSTRAP_ENV.name];
  let name = DEFAULT_ADMIN_NAME;
  if (rawName !== undefined && rawName !== "") {
    const parsed = shape.name.safeParse(rawName);
    if (parsed.success) name = parsed.data;
    else issues.push({ variable: BOOTSTRAP_ENV.name, rule: BOOTSTRAP_RULES.name });
  }

  if (issues.length > 0) throw new BootstrapInputError(issues);
  return { email, password, name };
}

export type BootstrapAdminOutcome =
  | { kind: "CREATED"; userId: string }
  | { kind: "ALREADY_ADMIN"; userId: string; isActive: boolean }
  | { kind: "REFUSED"; userId: string; role: "CUSTOMER" | "SELLER" };

interface ExistingAccount {
  id: string;
  role: Role;
  isActive: boolean;
}

async function findByEmail(email: string): Promise<ExistingAccount | null> {
  return db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, role: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

function classify(existing: ExistingAccount): BootstrapAdminOutcome {
  if (existing.role === Role.ADMIN) {
    return { kind: "ALREADY_ADMIN", userId: existing.id, isActive: existing.isActive };
  }
  return { kind: "REFUSED", userId: existing.id, role: existing.role };
}

/** The library's id format (`generateId` of better-auth: 32 characters of a-z, A-Z, 0-9). */
function libraryId(): string {
  return generateRandomString(32, "a-z", "A-Z", "0-9");
}

/**
 * Applies BR-26 for one validated input. Inserts only; never updates or deletes a row.
 *
 * Race with a sign-up for the same address: both store the email lower-cased, so the unique
 * constraint on `User.email` stops the second insert. The transaction then rolls back (no user
 * without an account is left behind), and the account that won is classified as above.
 */
export async function bootstrapAdmin(input: BootstrapAdminInput): Promise<BootstrapAdminOutcome> {
  const existing = await findByEmail(input.email);
  if (existing !== null) return classify(existing);

  const hash = await hashPassword(input.password);
  const userId = libraryId();
  try {
    await db.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          name: input.name,
          email: input.email,
          emailVerified: false,
          role: Role.ADMIN,
          isActive: true,
        },
        select: { id: true },
      });
      await tx.account.create({
        data: {
          id: libraryId(),
          accountId: userId,
          providerId: CREDENTIAL_PROVIDER_ID,
          userId,
          password: hash,
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findByEmail(input.email);
    if (winner === null) throw error;
    return classify(winner);
  }
  return { kind: "CREATED", userId };
}

export interface BootstrapOutput {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface BootstrapDependencies {
  bootstrap?: (input: BootstrapAdminInput) => Promise<BootstrapAdminOutcome>;
}

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? ` (code ${error.code})` : "";
  return `${name}${code}`;
}

/**
 * The whole script: reads the input, applies BR-26, writes one result line, and returns the exit
 * status (BOOTSTRAP_EXIT). Never throws. The output never holds the password; it names the
 * account by its id, not by its email (SR-04 treats an email as personal data).
 */
export async function runBootstrapAdmin(
  source: BootstrapEnvSource,
  output: BootstrapOutput,
  dependencies: BootstrapDependencies = {},
): Promise<number> {
  let input: BootstrapAdminInput;
  try {
    input = readBootstrapInput(source);
  } catch (error) {
    if (error instanceof BootstrapInputError) {
      output.err(error.message);
      return BOOTSTRAP_EXIT.invalidInput;
    }
    output.err(
      `Admin bootstrap failed: ${describeError(error)}. Nothing is known to have changed.`,
    );
    return BOOTSTRAP_EXIT.failed;
  }

  const bootstrap = dependencies.bootstrap ?? bootstrapAdmin;
  let outcome: BootstrapAdminOutcome;
  try {
    outcome = await bootstrap(input);
  } catch (error) {
    output.err(
      `Admin bootstrap failed: ${describeError(error)}. No admin was created by this run.`,
    );
    return BOOTSTRAP_EXIT.failed;
  }

  switch (outcome.kind) {
    case "CREATED":
      output.out(
        `Admin created (user id ${outcome.userId}). Remove ${BOOTSTRAP_ENV.email} and ${BOOTSTRAP_ENV.password} from the environment.`,
      );
      return BOOTSTRAP_EXIT.ok;
    case "ALREADY_ADMIN":
      output.out(
        `No change: the email already belongs to an admin (user id ${outcome.userId}${outcome.isActive ? "" : ", deactivated"}). The password given was not used.`,
      );
      return BOOTSTRAP_EXIT.ok;
    case "REFUSED":
      output.err(
        `Refused: the email belongs to an existing ${outcome.role} account (user id ${outcome.userId}). An existing account is never made an admin (BR-26). Nothing was changed.`,
      );
      return BOOTSTRAP_EXIT.refused;
  }
}
