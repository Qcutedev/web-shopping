/**
 * Tells unique-index violations of the model API apart by index name, so each one keeps its own
 * handling (CR-T040-02): a slug collision is retried, an owner-key violation is a refusal, a
 * name-key violation is `STORE_NAME_TAKEN`.
 *
 * Prisma 7.10 with `@prisma/adapter-pg` reports a unique violation of a model-API write as `P2002`
 * with `meta.driverAdapterError.cause.constraint.index` and `cause.originalCode` `23505`
 * (DATA_MODEL.md section 21.5). Only those two labels of `meta` are read: the `DETAIL` beside them
 * holds the conflicting value (a store name, an owner id) and is never read or logged (SR-04).
 */
import { Prisma } from "@/server/db";

/** The unique index on `Store.slug` (migration `20261011121529_init_schema_v1`). */
export const STORE_SLUG_INDEX = "Store_slug_key";

/** The unique index on `Store.ownerId`: one store per user (BR-06). */
export const STORE_OWNER_INDEX = "Store_ownerId_key";

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION_SQLSTATE = "23505";

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
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
  const cause = field(field(error.meta, "driverAdapterError"), "cause");
  return (
    field(field(cause, "constraint"), "index") === index &&
    field(cause, "originalCode") === UNIQUE_VIOLATION_SQLSTATE
  );
}
