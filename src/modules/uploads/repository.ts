/**
 * Prisma queries of the upload module (DATA_MODEL.md sections 6.7, 7.7, and 8). Every write is
 * scoped by the store id and owner the service passes, which are always the session's
 * (CLAUDE.md rules 2 and 6); nothing of a request names a store.
 *
 * `Upload` rows are immutable: this file inserts and reads them and never updates or deletes one
 * (the orphan cleanup of section 5.8 is a later job, not a request). Nothing here logs.
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

export interface RegisteredFile {
  contentType: string;
  sizeBytes: number;
}

/** The recorded type and size of the upload with this key, or null. One statement. */
export async function findUploadByKey(storageKey: string): Promise<RegisteredFile | null> {
  return db.upload.findUnique({
    where: { storageKey },
    select: { contentType: true, sizeBytes: true },
  });
}
