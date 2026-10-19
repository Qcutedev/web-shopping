/**
 * The one place that recognises a unique-constraint violation (CR-T040-05; DATA_MODEL.md section
 * 21.5, "One helper that reads the code and the name from the error belongs in `src/server/db`").
 *
 * Observed with Prisma 7.10 and `@prisma/adapter-pg` (section 21.5): a unique violation of a
 * model-API write is `P2002`, of a `$queryRaw` or `$executeRaw` statement `P2010`; in both the
 * index name is `meta.driverAdapterError.cause.constraint.index` and `cause.originalCode` is the
 * SQLSTATE `23505`. Only those two labels of `meta` are read. The `DETAIL` beside them holds the
 * conflicting value (an email, a store name, a SKU, a slug) and is never read, returned, or logged
 * here (SECURITY.md SR-04).
 *
 * Callers: `src/modules/sellers` (the store slug, owner, and name-key indexes; the open
 * application), `src/modules/auth/bootstrap-admin.ts` (the email), `src/modules/inventory` (the
 * product slug and the live-SKU index).
 */
import { Prisma } from "../../../prisma/generated/prisma/client";

/** PostgreSQL's `unique_violation`. */
export const UNIQUE_VIOLATION_SQLSTATE = "23505";

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

function knownCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

/** The index named by a driver-adapter cause whose SQLSTATE is `23505`, else null. */
function violatedIndex(error: Prisma.PrismaClientKnownRequestError): string | null {
  const cause = field(field(error.meta, "driverAdapterError"), "cause");
  if (field(cause, "originalCode") !== UNIQUE_VIOLATION_SQLSTATE) return null;
  const index = field(field(cause, "constraint"), "index");
  return typeof index === "string" ? index : null;
}

/**
 * True for any unique violation of a model-API write (`P2002`), whichever constraint refused it.
 * For a caller that has exactly one unique constraint the write can hit (the email of a new user,
 * the one-open-application index). A caller whose write can hit more than one names the index
 * with `isUniqueIndexViolation`.
 */
export function isUniqueViolation(error: unknown): boolean {
  return knownCode(error) === "P2002";
}

/**
 * True when `error` is the unique index named `index` refusing a model-API write (`P2002` with
 * that index and SQLSTATE `23505`). Any other error, another index, a raw statement's error
 * (`P2010`), or a `P2002` without the adapter's cause is false.
 */
export function isUniqueIndexViolation(error: unknown, index: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  return violatedIndex(error) === index;
}

/**
 * The same for a `$queryRaw` or `$executeRaw` statement (`P2010` with that index and SQLSTATE
 * `23505`). A model-API error (`P2002`) is false here.
 */
export function isRawUniqueIndexViolation(error: unknown, index: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2010") {
    return false;
  }
  return violatedIndex(error) === index;
}
