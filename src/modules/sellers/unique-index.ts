/**
 * The Store indexes whose unique violations the seller module tells apart (CR-T040-02): a slug
 * collision is retried, an owner-key violation is a refusal, a name-key violation is
 * `STORE_NAME_TAKEN`.
 *
 * Recognising the violation is the shared helper of the database layer (CR-T040-05;
 * `src/server/db/unique-violation.ts`, DATA_MODEL.md section 21.5); this file only names the
 * indexes and re-exports it for the module's existing callers.
 */
export { isUniqueIndexViolation } from "@/server/db";

/** The unique index on `Store.slug` (migration `20261011121529_init_schema_v1`). */
export const STORE_SLUG_INDEX = "Store_slug_key";

/** The unique index on `Store.ownerId`: one store per user (BR-06). */
export const STORE_OWNER_INDEX = "Store_ownerId_key";
