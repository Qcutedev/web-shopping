-- Unique store names after normalisation (SEC-058 remediation (a), D-041 point 1).
-- Specification: docs/DATA_MODEL.md sections 6.3 and 21.7.
--
-- Hand-written in full (RAW SQL): Prisma cannot express a SQL function or a generated column.
-- The schema file declares "nameKey" with @default(dbgenerated("store_name_key(name)")) and
-- @@unique([nameKey], map: "Store_nameKey_key") only so that `migrate dev` sees no drift and the
-- client can read and filter on the column; Prisma never writes it.
--
-- The key is computed by the database, never by the application, so every write path (the
-- approval insert, the seller's rename, the seed, a test factory, raw SQL) gets the same key and
-- none can leave it stale.

-- RAW SQL: the normalisation. Steps, in order:
--   1. NFKC (compatibility forms: full-width letters, ligatures, the Kelvin sign, NBSP);
--   2. full Unicode case folding: casefold() under the builtin collation "pg_unicode_fast"
--      (PostgreSQL 18; CaseFolding.txt status C and F, so "ß" and "ẞ" fold to "ss" and final
--      sigma to "σ"). The builtin provider does not depend on the operating system's locale;
--   3. remove every Default_Ignorable_Code_Point (soft hyphen, zero-width characters, bidi
--      controls, variation selectors, tags, Hangul fillers), as Unicode's NFKC_Casefold does;
--   4. NFKC again (folding and removal can leave a string that is not normalised);
--   5. every run of White_Space characters becomes one U+0020;
--   6. U+0020 is trimmed from both ends.
-- The SQL-standard body (RETURN) is parsed when the function is created, so the generated column
-- does not depend on search_path. `normalize` is written without a schema because its NFKC form
-- is SQL-standard syntax.
CREATE FUNCTION "store_name_key"("name" text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN pg_catalog.btrim(
  pg_catalog.regexp_replace(
    normalize(
      pg_catalog.regexp_replace(
        pg_catalog.casefold(normalize("name", NFKC) COLLATE pg_catalog."pg_unicode_fast"),
        '[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFF8\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]',
        '',
        'g'
      ),
      NFKC
    ),
    '[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+',
    ' ',
    'g'
  ),
  ' '
);

-- RAW SQL: the column. Computed for every existing row by this statement (the backfill).
ALTER TABLE "Store" ADD COLUMN "nameKey" TEXT NOT NULL GENERATED ALWAYS AS ("store_name_key"("name")) STORED;

-- RAW SQL: collisions among existing rows. Within each group of stores with one key, the oldest
-- store (createdAt, then id) keeps its name; every other store gets " (<slug>)" appended to its
-- name. Slugs are unique, so the new keys differ from each other. If an appended name still equals
-- another store's name, the unique index below fails and the migration stops; resolve by hand.
-- No AuditLog row is written: the table needs a user as the actor and a migration has none.
DO $$
DECLARE
  renamed integer;
BEGIN
  WITH ranked AS (
    SELECT "id", row_number() OVER (PARTITION BY "nameKey" ORDER BY "createdAt", "id") AS rn
    FROM "Store"
  )
  UPDATE "Store" AS s
  SET "name" = s."name" || ' (' || s."slug" || ')', "updatedAt" = now()
  FROM ranked
  WHERE s."id" = ranked."id" AND ranked.rn > 1;
  GET DIAGNOSTICS renamed = ROW_COUNT;
  RAISE NOTICE 'store_name_key: % store(s) renamed to resolve duplicate names', renamed;
END
$$;

-- CreateIndex (the name Prisma derives from @@unique([nameKey], map: "Store_nameKey_key"))
CREATE UNIQUE INDEX "Store_nameKey_key" ON "Store"("nameKey");
