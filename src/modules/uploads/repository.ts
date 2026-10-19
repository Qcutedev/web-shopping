/**
 * Prisma queries of the upload module (DATA_MODEL.md sections 6.7, 7.7, and 8). Every write is
 * scoped by the store id and owner the service passes, which are always the session's
 * (CLAUDE.md rules 2 and 6); nothing of a request names a store.
 *
 * `Upload` rows are never updated. Requests only insert and read them; the one delete is the
 * orphan cleanup (`deleteExpiredOrphans`, section 5.8 "Lifetime", SEC-065), which no request
 * reaches. Nothing here logs.
 *
 * "Referenced" has one meaning everywhere in this file: a `ProductImage` row, a `Store.logoUploadId`,
 * or an `OrderItem.productImageUploadId` names the upload (DATA_MODEL.md section 8). The three
 * `NOT EXISTS` conditions are written out in each statement that needs them, so each statement
 * stays one tagged-template query with bound values only (TM-14).
 */
import { randomUUID } from "node:crypto";

import { db, type DbTransaction } from "@/server/db";

import type { UploadContentType } from "./schema";

export interface NewUpload {
  storageKey: string;
  storeId: string;
  /** The store's owner, from the session; the insert requires the store to be theirs. */
  userId: string;
  contentType: UploadContentType;
  sizeBytes: number;
}

/**
 * The guarded insert of DATA_MODEL.md section 7.7: the row is written only while the store
 * belongs to `userId` and is `APPROVED`, judged by the statement itself (`INSERT ... SELECT ...
 * WHERE`), so zero rows means the store is not approved and nothing was written. One
 * parameterised statement; no `Store` row is updated, so it is safe after the `FOR SHARE` lock of
 * `requireApprovedStoreForWrite` (CR-T040-04). The id is a random UUID: ids are opaque
 * (docs/API_CONTRACTS.md section 1.4) and never leave the server for an upload.
 *
 * The table's check constraints (`Upload_contentType_check`, `Upload_sizeBytes_check`) and the
 * unique key index are the backstop for what the service already checked.
 */
export async function insertUploadIfStoreApproved(
  tx: DbTransaction,
  input: NewUpload,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Upload" ("id", "storageKey", "storeId", "contentType", "sizeBytes")
    SELECT ${randomUUID()}, ${input.storageKey}, s."id", ${input.contentType}, ${input.sizeBytes}
    FROM "Store" s
    WHERE s."id" = ${input.storeId} AND s."ownerId" = ${input.userId} AND s."status" = 'APPROVED'
    RETURNING "id"`;
  return rows.length === 1;
}

/**
 * Serialises the uploads of one store until the transaction ends (SEC-065): a transaction-level
 * advisory lock on a key derived from the store id. Two uploads of the same store therefore count
 * and insert one after the other, so the cap cannot be passed by sending uploads in parallel.
 * Uploads of other stores are not held up (a hash collision only makes two stores wait for each
 * other). It takes no row lock, so it neither conflicts with the `FOR SHARE` lock of
 * `requireApprovedStoreForWrite` nor with a suspension waiting for that lock.
 */
export async function lockStoreUploads(tx: DbTransaction, storeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`uploads:${storeId}`}, 0))`;
}

/**
 * How many uploads of the store nothing references, whatever their age. With `tx`, inside the
 * upload transaction after `lockStoreUploads`; without it, the early check before the body is
 * read (not authoritative, the transaction judges again).
 */
export async function countUnreferencedUploads(
  storeId: string,
  tx?: DbTransaction,
): Promise<number> {
  const client = tx ?? db;
  const rows = await client.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS "count"
    FROM "Upload" u
    WHERE u."storeId" = ${storeId}
      AND NOT EXISTS (SELECT 1 FROM "ProductImage" p WHERE p."uploadId" = u."id")
      AND NOT EXISTS (SELECT 1 FROM "Store" s WHERE s."logoUploadId" = u."id")
      AND NOT EXISTS (SELECT 1 FROM "OrderItem" o WHERE o."productImageUploadId" = u."id")`;
  return rows[0]?.count ?? 0;
}

export interface RegisteredFile {
  contentType: string;
  sizeBytes: number;
  /**
   * True when nothing references the upload and it is older than the grace period, by the
   * database clock: an orphan, never served again (section 5.8 "Lifetime").
   */
  expiredOrphan: boolean;
}

/**
 * The recorded type and size of the upload with this key, and whether it is an expired orphan,
 * or null. One statement. The age is checked first, so an upload inside the grace period costs no
 * reference lookup; a referenced one stops at the first reference found.
 */
export async function findUploadByKey(
  storageKey: string,
  graceSeconds: number,
): Promise<RegisteredFile | null> {
  const rows = await db.$queryRaw<RegisteredFile[]>`
    SELECT u."contentType", u."sizeBytes",
      (u."createdAt" < now() - make_interval(secs => ${graceSeconds}::int)
        AND NOT EXISTS (SELECT 1 FROM "ProductImage" p WHERE p."uploadId" = u."id")
        AND NOT EXISTS (SELECT 1 FROM "Store" s WHERE s."logoUploadId" = u."id")
        AND NOT EXISTS (SELECT 1 FROM "OrderItem" o WHERE o."productImageUploadId" = u."id")
      ) AS "expiredOrphan"
    FROM "Upload" u
    WHERE u."storageKey" = ${storageKey}`;
  return rows[0] ?? null;
}

export const ORPHAN_DELETE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;

/**
 * Deletes at most `limit` expired orphans in one transaction and returns their storage keys, so
 * the caller deletes the bytes after the commit (rows first, DATA_MODEL.md section 8).
 *
 * Safe against a concurrent attach (a product picture, a logo, an order item), in two statements
 * under READ COMMITTED:
 *
 *   1. The candidates are locked `FOR UPDATE ... SKIP LOCKED`. An attach that is writing a
 *      reference right now holds the `FOR KEY SHARE` lock its foreign key check takes on the
 *      upload row, so that row is skipped; an attach that starts after this lock waits for it.
 *   2. The delete repeats every condition with a new snapshot, so an attach that committed
 *      between the first statement's snapshot and its lock is seen and the row is kept.
 *
 * An attach that waited on the lock of step 1 fails its foreign key once the row is gone, which is
 * the outcome DATA_MODEL.md section 8 describes. The `Restrict` foreign keys stay the backstop: an
 * order's picture can never be deleted.
 */
export async function deleteExpiredOrphans(graceSeconds: number, limit: number): Promise<string[]> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT u."id"
      FROM "Upload" u
      WHERE u."createdAt" < now() - make_interval(secs => ${graceSeconds}::int)
        AND NOT EXISTS (SELECT 1 FROM "ProductImage" p WHERE p."uploadId" = u."id")
        AND NOT EXISTS (SELECT 1 FROM "Store" s WHERE s."logoUploadId" = u."id")
        AND NOT EXISTS (SELECT 1 FROM "OrderItem" o WHERE o."productImageUploadId" = u."id")
      ORDER BY u."createdAt"
      LIMIT ${limit}::int
      FOR UPDATE OF u SKIP LOCKED`;
    if (locked.length === 0) return [];
    const ids = locked.map((row) => row.id);
    const deleted = await tx.$queryRaw<{ storageKey: string }[]>`
      DELETE FROM "Upload" u
      WHERE u."id" = ANY(${ids}::text[])
        AND u."createdAt" < now() - make_interval(secs => ${graceSeconds}::int)
        AND NOT EXISTS (SELECT 1 FROM "ProductImage" p WHERE p."uploadId" = u."id")
        AND NOT EXISTS (SELECT 1 FROM "Store" s WHERE s."logoUploadId" = u."id")
        AND NOT EXISTS (SELECT 1 FROM "OrderItem" o WHERE o."productImageUploadId" = u."id")
      RETURNING u."storageKey"`;
    return deleted.map((row) => row.storageKey);
  }, ORPHAN_DELETE_TRANSACTION_OPTIONS);
}
