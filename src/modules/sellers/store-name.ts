/**
 * Store name rules of SEC-058 as the owner ruled them in D-041 (docs/DECISIONS.md):
 *
 *   - point 1, unique names: two stores may not have names with the same key. The key is
 *     `Store.nameKey`, a generated column computed by the database function `store_name_key`
 *     (NFKC, full case folding, default-ignorables removed, white space collapsed and trimmed;
 *     DATA_MODEL.md section 21.7) with the unique index `Store_nameKey_key`. There is deliberately
 *     no copy of the normalisation in TypeScript: every comparison goes through the function.
 *   - point 3, reserved names: a name whose key equals the key of an entry of
 *     `RESERVED_STORE_NAMES` is refused. Exact key match only: a name that merely contains a
 *     reserved word ("Official Shop", "ร้านแอดมินขายดี") is not refused; D-041 asks for names that
 *     claim to be the marketplace, and a substring rule would refuse ordinary names.
 *
 * Nothing here logs. `error.meta` of a violation holds the name in its `DETAIL` and is never read
 * beyond the constraint name and the PostgreSQL code (DATA_MODEL.md section 21.5; SR-04).
 */
import { th } from "@/i18n/th";
import { Prisma } from "@/server/db";

/**
 * Names a store may not take, compared by key (so `ADMIN`, `Ａｄｍｉｎ`, and ` admin ` are all
 * `admin`). The marketplace's own name is read from its single definition (REQ-N-12), so this list
 * follows a change of that name. The owner may extend the list (D-041 point 3); an entry needs no
 * particular case or spacing.
 */
export const RESERVED_STORE_NAMES: readonly string[] = Object.freeze([
  th.site.name,
  "admin",
  "administrator",
  "official",
  "support",
  "ผู้ดูแลระบบ",
  "แอดมิน",
  "ทางการ",
  "ร้านค้าทางการ",
]);

/** The unique index on the generated `Store.nameKey` (migration `20261015090000_store_name_key`). */
export const STORE_NAME_KEY_INDEX = "Store_nameKey_key";

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION_SQLSTATE = "23505";

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * True when `error` is the unique index `Store_nameKey_key` refusing a write through the model API
 * (`P2002`, `meta.driverAdapterError.cause.constraint.index` and `cause.originalCode` `23505`;
 * DATA_MODEL.md section 21.5). Any other unique violation (slug, owner, logo) is false, so it keeps
 * its own handling. Reads only those two labels of `meta`.
 */
export function isStoreNameKeyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const cause = field(field(error.meta, "driverAdapterError"), "cause");
  return (
    field(field(cause, "constraint"), "index") === STORE_NAME_KEY_INDEX &&
    field(cause, "originalCode") === UNIQUE_VIOLATION_SQLSTATE
  );
}
