/**
 * Reads the facts of a rejected database write from the error the database layer throws:
 * the PostgreSQL error code and the name of the violated constraint.
 *
 * Shapes observed with Prisma 7.10.0 and `@prisma/adapter-pg` (DATA_MODEL.md section 21.5):
 * - every violation is a `PrismaClientKnownRequestError` whose
 *   `meta.driverAdapterError.cause` holds `originalCode`, the PostgreSQL code;
 * - for a unique index (23505), a missing foreign-key parent (23503), and a restricted delete
 *   (23001) the name is `cause.constraint.index`;
 * - for a check constraint (23514) there is no field for the name: it is only inside the text
 *   `cause.originalMessage` (`... violates check constraint "<name>"`).
 * The Prisma code depends on how the statement was sent (P2002, P2003, P2039 through the model
 * API; P2010 through raw SQL), which is why the tests match on the PostgreSQL code and the name.
 *
 * Nothing here returns, prints, or stores the message, `detail`, or `meta` of an error: for a
 * check violation they hold the whole failing row (SECURITY.md SR-04). Only the two codes and
 * the constraint name leave this module.
 *
 * This module does not import the database layer, so it stays a set of pure functions.
 */

export type DatabaseViolation = {
  /** PostgreSQL error code, for example "23514". */
  code: string;
  /** Name of the violated constraint or index; undefined when the database names none. */
  constraint: string | undefined;
  /** Prisma error code, for example "P2039". */
  prismaCode: string;
};

export const PG_CHECK_VIOLATION = "23514";
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_RESTRICT_VIOLATION = "23001";

const CHECK_NAME = /violates check constraint "([^"]+)"/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The violation an error describes, or undefined when it is not a database violation. */
export function readDatabaseViolation(error: unknown): DatabaseViolation | undefined {
  if (!isRecord(error) || typeof error["code"] !== "string") {
    return undefined;
  }
  const meta = error["meta"];
  const adapterError = isRecord(meta) ? meta["driverAdapterError"] : undefined;
  const cause = isRecord(adapterError) ? adapterError["cause"] : undefined;
  if (!isRecord(cause) || typeof cause["originalCode"] !== "string") {
    return undefined;
  }

  let constraint: string | undefined;
  const named = cause["constraint"];
  if (isRecord(named) && typeof named["index"] === "string") {
    constraint = named["index"];
  } else if (typeof cause["originalMessage"] === "string") {
    constraint = CHECK_NAME.exec(cause["originalMessage"])?.[1];
  }
  return { code: cause["originalCode"], constraint, prismaCode: error["code"] };
}

/**
 * Runs a write that the database must reject and returns the violation.
 * Throws when the write was accepted, and when it failed for a reason that is not a database
 * violation; neither message contains a value of the failed statement.
 */
export async function captureViolation(write: () => Promise<unknown>): Promise<DatabaseViolation> {
  try {
    await write();
  } catch (error) {
    const violation = readDatabaseViolation(error);
    if (violation === undefined) {
      const name = isRecord(error) && typeof error["name"] === "string" ? error["name"] : "unknown";
      const code = isRecord(error) && typeof error["code"] === "string" ? error["code"] : "none";
      throw new Error(
        `The write failed, but not with a database violation (error ${name}, code ${code}).`,
      );
    }
    return violation;
  }
  throw new Error("The database accepted a write that it was expected to reject.");
}
