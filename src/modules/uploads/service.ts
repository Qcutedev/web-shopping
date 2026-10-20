/**
 * Upload service (docs/API_CONTRACTS.md section 5.8; REQ-S-05, BR-14; DATA_MODEL.md sections
 * 6.7, 7.7, and 8).
 *
 *   function      access (section 1.8)   check here
 *   assertUploadAllowance  seller        SELLER with an APPROVED store; the early cap check
 *   createUpload  seller                 SELLER with an APPROVED store, from the session's actor;
 *                                        again under the store row's share lock; and the insert
 *                                        carries the condition itself
 *   openFile      public, or the owning  the key must match the pattern and belong to a
 *                 seller                 registered upload that is not an expired orphan
 *                                        (SEC-065); then `mayServe` (SEC-068): served to anyone
 *                                        only when public (an order item's picture, a picture of
 *                                        a visible product, the logo of a public store), else
 *                                        only to a SELLER session of the owning store
 *
 * The owner of an upload is the caller's store, taken from the session (`actor.storeId` with
 * `actor.userId`), never from the request (CLAUDE.md rule 6). Uploading attaches nothing.
 */
import { imageRef } from "@/modules/catalog/image";
import { requireApprovedStoreForWrite } from "@/modules/sellers";
import { type Actor, requireApprovedSeller } from "@/server/auth/actor";
import { db } from "@/server/db";
import type { Logger } from "@/server/logger";

import { fileNotFound, uploadLimitReached, uploadStoreNotApproved } from "./errors";
import {
  countUnreferencedUploads,
  findUploadByKey,
  insertUploadIfStoreApproved,
  isLogoOfPublicStore,
  lockStoreUploads,
} from "./repository";
import {
  isStorageKey,
  isUploadContentType,
  MAX_UNATTACHED_UPLOADS_PER_STORE,
  MAX_UPLOAD_FILE_BYTES,
  ORPHAN_GRACE_PERIOD_SECONDS,
  type UploadContentType,
  type UploadDto,
  type ValidatedImage,
} from "./schema";
import { generateStorageKey, type StorageProvider } from "./storage";

export const UPLOAD_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

export interface UploadDependencies {
  storage: StorageProvider;
  /** The request's logger, for the operator lines below. Never given file bytes or names. */
  log?: Pick<Logger, "warn">;
  /** Key generator; tests replace it. Default `generateStorageKey`. */
  newKey?: () => string;
}

/**
 * POST /seller/uploads, after the rate limit and before a byte of the body is read (SEC-065): a
 * store that already holds MAX_UNATTACHED_UPLOADS_PER_STORE uploads nothing references is refused
 * with 409 CONFLICT `UPLOAD_LIMIT`, so the server does not read a body it would refuse. Scoped by
 * the session's store id. Not authoritative: two requests can both pass it, and `createUpload`
 * judges the cap again under the store's upload lock.
 */
export async function assertUploadAllowance(actor: Actor): Promise<void> {
  const { storeId } = requireApprovedSeller(actor);
  if ((await countUnreferencedUploads(storeId)) >= MAX_UNATTACHED_UPLOADS_PER_STORE) {
    throw uploadLimitReached();
  }
}

/**
 * POST /seller/uploads, after the handler read and checked the file (reader.ts). In one
 * transaction (CLAUDE.md rule 5):
 *
 *   1. `requireApprovedStoreForWrite`, first: 403 FORBIDDEN for a caller who is not a `SELLER`,
 *      403 SELLER_NOT_APPROVED unless the caller's store is `APPROVED`; the store row is then
 *      share-locked, so a suspension waits until this upload commits or rolls back (step 8 of
 *      section 1.8). The `Store` row is never updated or deleted after it (CR-T040-04);
 *   2. the store's upload lock (`lockStoreUploads`, an advisory lock, no row lock), then the count
 *      of its uploads nothing references: at MAX_UNATTACHED_UPLOADS_PER_STORE or more, 409
 *      CONFLICT `UPLOAD_LIMIT` and nothing is stored (SEC-065). The lock makes parallel uploads of
 *      one store count one after the other, so the cap holds exactly;
 *   3. the bytes are stored under a new generated key. A store that was suspended before step 1,
 *      or that is at its cap, therefore never gets a byte stored;
 *   4. the guarded insert of the `Upload` row (`insertUploadIfStoreApproved`); zero rows is
 *      403 SELLER_NOT_APPROVED.
 *
 * When anything fails after the bytes were stored (the insert, the commit), they are deleted
 * again, so a refused upload leaves neither a row nor a file. If that deletion fails too, the file
 * stays without a row: it is never served (`openFile` needs the row) and one warn line names its
 * key. The role check before the transaction is the same refusal made sooner, with no database
 * work for a caller who is refused anyway.
 */
export async function createUpload(
  actor: Actor,
  image: ValidatedImage,
  deps: UploadDependencies,
): Promise<UploadDto> {
  requireApprovedSeller(actor);
  const sizeBytes = image.bytes.byteLength;
  if (
    !isUploadContentType(image.contentType) ||
    sizeBytes < 1 ||
    sizeBytes > MAX_UPLOAD_FILE_BYTES
  ) {
    // reader.ts guarantees both; anything else is a programming error, never stored.
    throw new TypeError("createUpload: the image was not checked by the upload reader.");
  }
  const contentType: UploadContentType = image.contentType;
  const storageKey = (deps.newKey ?? generateStorageKey)();
  let stored = false;
  try {
    await db.$transaction(async (tx) => {
      const { storeId } = await requireApprovedStoreForWrite(tx, actor);
      await lockStoreUploads(tx, storeId);
      if ((await countUnreferencedUploads(storeId, tx)) >= MAX_UNATTACHED_UPLOADS_PER_STORE) {
        throw uploadLimitReached();
      }
      await deps.storage.put(storageKey, image.bytes);
      stored = true;
      const inserted = await insertUploadIfStoreApproved(tx, {
        storageKey,
        storeId,
        userId: actor.userId,
        contentType,
        sizeBytes,
      });
      if (!inserted) throw uploadStoreNotApproved();
    }, UPLOAD_TRANSACTION_OPTIONS);
  } catch (error) {
    if (stored) await deleteQuietly(deps, storageKey);
    throw error;
  }
  return { ...imageRef(storageKey), contentType, sizeBytes };
}

async function deleteQuietly(deps: UploadDependencies, storageKey: string): Promise<void> {
  try {
    await deps.storage.delete(storageKey);
  } catch {
    deps.log?.warn("Stored bytes of a refused upload could not be deleted", { storageKey });
  }
}

export interface OpenedFile {
  body: ReadableStream<Uint8Array>;
  /** The upload's recorded type, never one derived from the request. */
  contentType: UploadContentType;
  sizeBytes: number;
}

/** What decides who may read a registered upload that is not an expired orphan. */
export interface FileAccess {
  /** The owning store. */
  storeId: string;
  /** An order item's picture, a picture of a visible product, or the logo of a public store. */
  isPublic: boolean;
}

/**
 * SEC-068 item 1 (section 5.8 "Serving"): a public file is served to anyone, with or without a
 * session. Any other registered upload (an unattached one inside the grace period, a picture of a
 * draft, of a product awaiting approval, rejected, or taken down, or hidden by its store, owner,
 * or category, the logo of a suspended store) is served only to a `SELLER` whose session's store
 * owns it, whatever that store's status (BR-14: a suspended seller still reads). Everyone else,
 * an admin included, is answered as for an unknown key.
 */
export function mayServe(file: FileAccess, actor: Actor | null): boolean {
  if (file.isPublic) return true;
  return actor !== null && actor.role === "SELLER" && actor.storeId === file.storeId;
}

/** Resolves the caller's actor from the request's session; asked only for a file not public. */
export type ActorResolver = () => Promise<Actor | null>;

const anonymous: ActorResolver = () => Promise.resolve(null);

/**
 * GET /api/files/{key}: the stored bytes of a registered upload. 404 NOT_FOUND, identical in
 * every case, for a key that does not match the pattern (checked first; nothing is read), a key
 * with no `Upload` row, an expired orphan (nothing references it and it is older than
 * ORPHAN_GRACE_PERIOD_SECONDS; SEC-065, nothing is read and nothing is logged), a file the caller
 * may not read (`mayServe`, SEC-068; nothing is read and nothing is logged), and a row whose bytes
 * are missing or have another length than recorded. The last two are operator matters and write
 * one warn line with the key.
 *
 * `resolveActor` is called only when the file is not public, so a public file costs no session
 * lookup; the route passes the session guard. Without it the caller is anonymous.
 */
export async function openFile(
  key: string,
  deps: UploadDependencies,
  resolveActor: ActorResolver = anonymous,
): Promise<OpenedFile> {
  if (!isStorageKey(key)) throw fileNotFound();
  const row = await findUploadByKey(key, ORPHAN_GRACE_PERIOD_SECONDS);
  if (row === null || row.expiredOrphan) throw fileNotFound();
  const isPublic = row.publicPicture || (row.isLogo && (await isLogoOfPublicStore(row.id)));
  const access: FileAccess = { storeId: row.storeId, isPublic };
  if (!isPublic && !mayServe(access, await resolveActor())) throw fileNotFound();
  if (!isUploadContentType(row.contentType)) {
    deps.log?.warn("A registered upload has a type that is not allowed", { storageKey: key });
    throw fileNotFound();
  }
  const object = await deps.storage.get(key);
  if (object === null) {
    deps.log?.warn("A registered upload has no stored bytes", { storageKey: key });
    throw fileNotFound();
  }
  if (object.sizeBytes !== row.sizeBytes) {
    void object.body.cancel().catch(() => undefined);
    deps.log?.warn("A registered upload's stored length differs from its row", {
      storageKey: key,
    });
    throw fileNotFound();
  }
  return { body: object.body, contentType: row.contentType, sizeBytes: row.sizeBytes };
}
