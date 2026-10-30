-- SEC-101: lower the database cap on Upload."sizeBytes" from 5 MiB (5,242,880) to 4 MiB
-- (4,194,304), equal to MAX_UPLOAD_FILE_BYTES in src/modules/uploads/schema.ts (D-051).
-- Specification: docs/DATA_MODEL.md sections 6.7, 13, 17, and 21.10.
--
-- Hand-written in full (RAW SQL): Prisma cannot express a check constraint. The schema file does
-- not change. There is no down migration; the manual undo is in DATA_MODEL.md section 17.
--
-- Narrowing: rows above 4 MiB would violate the new check. The application has refused such files
-- since D-051, but a row written before that could exist. The guard below stops the migration with
-- a clear message instead of changing or deleting any row; such rows need an owner decision first.

DO $$
DECLARE
  oversized integer;
BEGIN
  SELECT count(*) INTO oversized FROM "Upload" WHERE "sizeBytes" > 4194304;
  IF oversized > 0 THEN
    RAISE EXCEPTION 'upload_size_cap_4mib: % Upload row(s) exceed 4194304 bytes; resolve them before this migration (DATA_MODEL.md section 21.10)', oversized;
  END IF;
END
$$;

-- One statement, so the old check is never dropped without the new one in place. Adding the check
-- validates every existing row under an ACCESS EXCLUSIVE lock on "Upload"; the table is small.
ALTER TABLE "Upload"
  DROP CONSTRAINT "Upload_sizeBytes_check",
  ADD CONSTRAINT "Upload_sizeBytes_check" CHECK ("sizeBytes" BETWEEN 1 AND 4194304);
