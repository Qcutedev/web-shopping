/**
 * Prisma queries of the seller application and store module. Every query is scoped by ids the
 * service passes, which are always the session's (`actor.userId`, `actor.storeId`) or, for the
 * admin decisions, the application id of the path; nothing of a request body names a user or a
 * store (CLAUDE.md rules 2 and 6). A store is always looked up with its owner in the `WHERE`, so a
 * store id and its owner must both match.
 *
 * Transactions (CLAUDE.md rule 5): submitting an application, every store write, and both admin
 * decisions run in one interactive transaction each. Inside it every `tx` query selects scalar
 * fields only and the statements are awaited one after the other (docs/API_CONTRACTS.md item
 * 8.2-14; DATA_MODEL.md section 7.8). Status columns change only through a guarded statement whose
 * `WHERE` names the expected current value (D-024; DATA_MODEL.md section 7.6), and zero affected
 * rows is a refusal, never a silent success.
 *
 * Locks, always taken in this order when a transaction takes more than one: the application row
 * (`FOR UPDATE`), then the user row (by the guarded role update, or `FOR NO KEY UPDATE`), then
 * the store row. So a submission and an approval for the same user run one after the other.
 *
 * Nothing here logs: the rows hold names and phone numbers (SECURITY.md SR-04).
 */
import { db, type DbTransaction, Prisma } from "@/server/db";

import {
  applicationSourceStates,
  type ApplicationStatusValue,
  type StoreStatusValue,
} from "./state";
import { isStoreNameKeyViolation, RESERVED_STORE_NAMES } from "./store-name";

export const SELLER_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** How many times an approval is tried when the generated store slug collides (DATA_MODEL.md 9). */
export const APPROVAL_SLUG_ATTEMPTS = 3;

function isKnownError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/** P2002: a unique constraint refused the write. */
export function isUniqueViolation(error: unknown): boolean {
  return isKnownError(error, "P2002");
}

/** P2003: a foreign key refused the write. */
export function isForeignKeyViolation(error: unknown): boolean {
  return isKnownError(error, "P2003");
}

/**
 * Thrown inside a transaction to roll it back with a known outcome; caught by the function that
 * opened the transaction and returned as that outcome. Never leaves this file.
 */
class Rollback<K extends string> extends Error {
  constructor(readonly outcome: K) {
    super(outcome);
    this.name = "Rollback";
  }
}

// ---------------------------------------------------------------------------------------------
// Store names (SEC-058, D-041; store-name.ts, DATA_MODEL.md section 21.7)
// ---------------------------------------------------------------------------------------------

export interface StoreNameCheck {
  /** Another store (or, on a rename, this one) already has a name with the same key. */
  taken: boolean;
  /** The key equals the key of an entry of `RESERVED_STORE_NAMES`. */
  reserved: boolean;
}

/**
 * Compares `name` with the stored keys and with the reserved names, by the database's own
 * normalisation (`store_name_key`): one statement, bound parameters only. Nothing is locked; a
 * store created after this read is caught by `Store_nameKey_key` at approval.
 */
export async function checkStoreName(
  client: Pick<DbTransaction, "$queryRaw">,
  name: string,
): Promise<StoreNameCheck> {
  const reservedNames = [...RESERVED_STORE_NAMES];
  const rows = await client.$queryRaw<StoreNameCheck[]>`
    SELECT
      EXISTS (SELECT 1 FROM "Store" WHERE "nameKey" = store_name_key(${name})) AS "taken",
      store_name_key(${name}) IN (
        SELECT store_name_key(x) FROM unnest(${reservedNames}::text[]) AS x
      ) AS "reserved"`;
  const row = rows[0];
  // One row always; a missing one would be a driver fault, and refusing is the safe answer.
  return { taken: row?.taken !== false, reserved: row?.reserved !== false };
}

// ---------------------------------------------------------------------------------------------
// Applications, as the applicant sees them
// ---------------------------------------------------------------------------------------------

export const APPLICATION_SELECT = {
  id: true,
  userId: true,
  storeName: true,
  description: true,
  contactPhone: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
} as const satisfies Prisma.SellerApplicationSelect;

export type ApplicationRow = Prisma.SellerApplicationGetPayload<{
  select: typeof APPLICATION_SELECT;
}>;

/** The ordering that makes "latest" unique: newest first, then `id` (section 1.7). */
export const LATEST_APPLICATION_ORDER = [
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.SellerApplicationOrderByWithRelationInput[];

/** The user's latest application, or null. One statement. */
export async function findLatestApplication(userId: string): Promise<ApplicationRow | null> {
  return db.sellerApplication.findFirst({
    where: { userId },
    select: APPLICATION_SELECT,
    orderBy: [...LATEST_APPLICATION_ORDER],
  });
}

export interface ApplicationInput {
  storeName: string;
  description: string;
  contactPhone: string;
}

export type SubmitOutcome =
  | { kind: "created"; row: ApplicationRow }
  | { kind: "user-gone" }
  | { kind: "not-customer" }
  | { kind: "open-application"; cause?: unknown }
  | { kind: "store-name-reserved" }
  | { kind: "store-name-taken" };

/**
 * Inserts a `PENDING` application for the user, in one transaction (DATA_MODEL.md section 4.1,
 * "(new row) to PENDING"):
 *
 *   1. lock the user row (`FOR NO KEY UPDATE`) and read its role; an inactive or missing user is
 *      `user-gone`. The approval's role update takes a conflicting lock, so a submission and an
 *      approval of the same user never interleave;
 *   2. the role must still be `CUSTOMER` and the user must own no store (BR-06), else
 *      `not-customer`;
 *   3. no other `PENDING` application, else `open-application`;
 *   4. the store name (SEC-058, D-041): a reserved name is `store-name-reserved`, a name whose key
 *      an existing store has is `store-name-taken` (`checkStoreName`). Pending applications are not
 *      compared with each other; the second of two approvals of one name fails on the index;
 *   5. insert. The partial unique index `SellerApplication_userId_pending_key` is the backstop:
 *      its violation also answers `open-application`.
 */
export async function insertApplication(
  userId: string,
  input: ApplicationInput,
): Promise<SubmitOutcome> {
  try {
    return await db.$transaction(async (tx) => {
      const users = await tx.$queryRaw<{ role: string }[]>`
        SELECT "role"::text AS "role" FROM "User"
        WHERE "id" = ${userId} AND "isActive" = true
        FOR NO KEY UPDATE`;
      const user = users[0];
      if (user === undefined) return { kind: "user-gone" } as const;
      if (user.role !== "CUSTOMER") return { kind: "not-customer" } as const;
      const store = await tx.store.findUnique({ where: { ownerId: userId }, select: { id: true } });
      if (store !== null) return { kind: "not-customer" } as const;
      const open = await tx.sellerApplication.findFirst({
        where: { userId, status: "PENDING" },
        select: { id: true },
      });
      if (open !== null) return { kind: "open-application" } as const;
      const name = await checkStoreName(tx, input.storeName);
      if (name.reserved) return { kind: "store-name-reserved" } as const;
      if (name.taken) return { kind: "store-name-taken" } as const;
      const row = await tx.sellerApplication.create({
        data: { userId, ...input },
        select: APPLICATION_SELECT,
      });
      return { kind: "created", row } as const;
    }, SELLER_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: "open-application", cause: error };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// The seller's own store
// ---------------------------------------------------------------------------------------------

export const STORE_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUploadId: true,
  contactPhone: true,
  status: true,
  statusReason: true,
  isSample: true,
} as const satisfies Prisma.StoreSelect;

export type StoreScalarRow = Prisma.StoreGetPayload<{ select: typeof STORE_SELECT }>;

export interface StoreRow extends StoreScalarRow {
  /** The storage key of the logo, or null. */
  logoKey: string | null;
}

async function withLogoKey(
  client: Pick<DbTransaction, "upload">,
  row: StoreScalarRow,
): Promise<StoreRow> {
  if (row.logoUploadId === null) return { ...row, logoKey: null };
  const upload = await client.upload.findUnique({
    where: { id: row.logoUploadId },
    select: { storageKey: true },
  });
  return { ...row, logoKey: upload?.storageKey ?? null };
}

/** The store `storeId` when `userId` owns it, else null. Two statements, no transaction. */
export async function findOwnStore(storeId: string, userId: string): Promise<StoreRow | null> {
  const row = await db.store.findFirst({
    where: { id: storeId, ownerId: userId },
    select: STORE_SELECT,
  });
  return row === null ? null : withLogoKey(db, row);
}

export interface StoreUpdate {
  name?: string;
  description?: string | null;
  contactPhone?: string;
  /** A storage key of the store's own upload, or null to remove the logo. */
  logoKey?: string | null;
}

export type StoreUpdateOutcome =
  | { kind: "updated"; row: StoreRow }
  | { kind: "not-found" }
  | { kind: "not-approved" }
  | { kind: "upload-not-found" }
  | { kind: "store-name-reserved" }
  | { kind: "store-name-taken" };

export const AUDIT_ACTION_STORE_RENAMED = "SELLER_STORE_RENAMED";
export const AUDIT_TARGET_STORE = "Store";

/**
 * Locks the seller's own store row and reads its status and name. A rename changes the generated
 * `nameKey`, which has a unique index, so PostgreSQL takes the row's `FOR UPDATE` lock for that
 * update; a request that sends `name` takes `FOR UPDATE` from the start rather than upgrading from
 * `FOR NO KEY UPDATE` while other transactions may hold `FOR KEY SHARE` on the row. Any other
 * change keeps `FOR NO KEY UPDATE`. Neither is `FOR SHARE` followed by an update (T-040 review,
 * observation 1).
 */
async function lockOwnStore(
  tx: DbTransaction,
  storeId: string,
  userId: string,
  forRename: boolean,
): Promise<{ status: string; name: string } | null> {
  const rows = forRename
    ? await tx.$queryRaw<{ status: string; name: string }[]>`
        SELECT "status"::text AS "status", "name" FROM "Store"
        WHERE "id" = ${storeId} AND "ownerId" = ${userId}
        FOR UPDATE`
    : await tx.$queryRaw<{ status: string; name: string }[]>`
        SELECT "status"::text AS "status", "name" FROM "Store"
        WHERE "id" = ${storeId} AND "ownerId" = ${userId}
        FOR NO KEY UPDATE`;
  return rows[0] ?? null;
}

/**
 * Changes the seller's own store in one transaction (REQ-S-02; DATA_MODEL.md sections 6.3, 7.7,
 * 8, and 21.7):
 *
 *   1. lock the store row with its owner in the `WHERE` (`lockOwnStore`): none is `not-found`; a
 *      status other than `APPROVED` is `not-approved` (BR-14: the store status is judged before
 *      the upload is looked up, section 1.8 steps 8 and 9);
 *   2. a `name` that differs from the current one is a rename (SEC-058, D-041): a reserved name is
 *      `store-name-reserved`. A name whose key another store has is refused by the unique index
 *      `Store_nameKey_key` in step 4; that error leaves the callback (the transaction is dead) and
 *      is `store-name-taken`;
 *   3. a `logoKey` is resolved by `storageKey` **and** `storeId`, so an unknown key and another
 *      store's key are both `upload-not-found`;
 *   4. the guarded update carries `status = 'APPROVED'` itself (section 7.7); zero rows is
 *      `not-approved`. A foreign-key failure on the logo (the upload was removed in between) is
 *      `upload-not-found`. The slug never changes;
 *   5. a rename writes one `AuditLog` row: the seller as actor, action `SELLER_STORE_RENAMED`,
 *      target the store, `metadata` `{ before: { name }, after: { name } }` (D-041 point 2). A
 *      name sent unchanged, character for character, is no rename and writes no row;
 *   6. the store is read back.
 */
export async function updateOwnStore(
  storeId: string,
  userId: string,
  update: StoreUpdate,
): Promise<StoreUpdateOutcome> {
  try {
    return await db.$transaction(async (tx) => {
      const current = await lockOwnStore(tx, storeId, userId, update.name !== undefined);
      if (current === null) return { kind: "not-found" } as const;
      if (current.status !== "APPROVED") return { kind: "not-approved" } as const;

      const renamedTo =
        update.name !== undefined && update.name !== current.name ? update.name : null;
      if (renamedTo !== null && (await checkStoreName(tx, renamedTo)).reserved) {
        return { kind: "store-name-reserved" } as const;
      }

      const data: Prisma.StoreUncheckedUpdateManyInput = {};
      // Written also when unchanged, so `data` is never empty and the guarded update always runs.
      if (update.name !== undefined) data.name = update.name;
      if (update.description !== undefined) data.description = update.description;
      if (update.contactPhone !== undefined) data.contactPhone = update.contactPhone;
      if (update.logoKey === null) data.logoUploadId = null;
      if (typeof update.logoKey === "string") {
        const upload = await tx.upload.findFirst({
          where: { storageKey: update.logoKey, storeId },
          select: { id: true },
        });
        if (upload === null) return { kind: "upload-not-found" } as const;
        data.logoUploadId = upload.id;
      }

      const { count } = await tx.store.updateMany({
        where: { id: storeId, ownerId: userId, status: "APPROVED" },
        data,
      });
      if (count === 0) return { kind: "not-approved" } as const;
      if (renamedTo !== null) {
        await tx.auditLog.create({
          data: {
            actorId: userId,
            action: AUDIT_ACTION_STORE_RENAMED,
            targetType: AUDIT_TARGET_STORE,
            targetId: storeId,
            metadata: { before: { name: current.name }, after: { name: renamedTo } },
          },
          select: { id: true },
        });
      }
      const row = await tx.store.findFirstOrThrow({
        where: { id: storeId, ownerId: userId },
        select: STORE_SELECT,
      });
      return { kind: "updated", row: await withLogoKey(tx, row) } as const;
    }, SELLER_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isStoreNameKeyViolation(error)) return { kind: "store-name-taken" };
    if (isForeignKeyViolation(error)) return { kind: "upload-not-found" };
    throw error;
  }
}

/**
 * For every seller write of later tasks (T-041 uploads, T-042 products and stock): inside the
 * caller's transaction, takes a share lock on the store row when it belongs to `userId` and is
 * `APPROVED`, and reports whether it did. While the lock is held a suspension (an update of the
 * row) waits until the caller's transaction ends, so the store cannot become `SUSPENDED` between
 * this check and the caller's write (DATA_MODEL.md section 7.7, step 8 of section 1.8). False
 * means the write must be refused with `403 SELLER_NOT_APPROVED`.
 */
export async function lockStoreIfApproved(
  tx: DbTransaction,
  storeId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Store"
    WHERE "id" = ${storeId} AND "ownerId" = ${userId} AND "status" = 'APPROVED'
    FOR SHARE`;
  return rows.length === 1;
}

// ---------------------------------------------------------------------------------------------
// Admin decisions (REQ-A-03; exposed by T-050)
// ---------------------------------------------------------------------------------------------

export const AUDIT_ACTION_APPLICATION_APPROVED = "SELLER_APPLICATION_APPROVED";
export const AUDIT_ACTION_APPLICATION_REJECTED = "SELLER_APPLICATION_REJECTED";
export const AUDIT_TARGET_SELLER_APPLICATION = "SellerApplication";

interface LockedApplication {
  id: string;
  userId: string;
  status: ApplicationStatusValue;
  storeName: string;
  description: string;
  contactPhone: string;
}

async function lockApplication(
  tx: DbTransaction,
  applicationId: string,
): Promise<LockedApplication | null> {
  const rows = await tx.$queryRaw<LockedApplication[]>`
    SELECT "id", "userId", "status"::text AS "status", "storeName", "description", "contactPhone"
    FROM "SellerApplication"
    WHERE "id" = ${applicationId}
    FOR UPDATE`;
  return rows[0] ?? null;
}

export interface DecisionRow {
  application: {
    id: string;
    userId: string;
    status: ApplicationStatusValue;
    reviewNote: string | null;
    reviewedAt: Date;
  };
  store: { id: string; name: string; slug: string; status: StoreStatusValue } | null;
}

export type DecisionOutcome =
  | { kind: "decided"; row: DecisionRow }
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | { kind: "applicant-not-customer" }
  | { kind: "applicant-inactive" }
  | { kind: "store-name-reserved" }
  | { kind: "store-name-taken" };

/**
 * Locks the applicant's user row (`FOR NO KEY UPDATE`, the lock submission takes) and reads its
 * `isActive`. A deactivation is an update of the same row, so it either committed before this read
 * or waits until the approval ends. Null when the user row is missing.
 */
async function lockApplicant(
  tx: DbTransaction,
  userId: string,
): Promise<{ isActive: boolean } | null> {
  const rows = await tx.$queryRaw<{ isActive: boolean }[]>`
    SELECT "isActive" FROM "User"
    WHERE "id" = ${userId}
    FOR NO KEY UPDATE`;
  return rows[0] ?? null;
}

/** Moves the locked application to `to` by the guarded statement; false when no row moved. */
async function moveApplication(
  tx: DbTransaction,
  applicationId: string,
  to: "APPROVED" | "REJECTED",
  adminId: string,
  reviewNote: string | null,
  reviewedAt: Date,
): Promise<boolean> {
  const { count } = await tx.sellerApplication.updateMany({
    where: { id: applicationId, status: { in: applicationSourceStates(to) } },
    data: { status: to, reviewedById: adminId, reviewNote, reviewedAt },
  });
  return count === 1;
}

/**
 * `PENDING` to `APPROVED` in one transaction (DATA_MODEL.md section 4.1):
 *
 *   1. lock the application (`FOR UPDATE`): none is `not-found`, not `PENDING` is `not-pending`;
 *   2. lock the applicant's user row (`FOR NO KEY UPDATE`): `isActive = false` is
 *      `applicant-inactive` and nothing is written, so the application stays `PENDING` and can be
 *      rejected (D-040 point 1; a store of a deactivated owner is hidden anyway, BR-27). A missing
 *      user row (the foreign key does not allow it) is `applicant-not-customer`;
 *   3. the application's store name must not be reserved (SEC-058, D-041 point 3), else
 *      `store-name-reserved` and nothing is written; the application stays `PENDING`;
 *   4. the guarded application update (`status = 'PENDING'`);
 *   5. the guarded role update `CUSTOMER` to `SELLER` (`WHERE role = 'CUSTOMER'` and
 *      `isActive = true`; section 7.6); zero rows rolls everything back as
 *      `applicant-not-customer`;
 *   6. the store is created with status `APPROVED`, the application's name, description, and
 *      contact phone, and a generated slug (`Store_ownerId_key` is the backstop against a second
 *      store). A name whose key another store has (approved since the application was submitted)
 *      is refused by `Store_nameKey_key`; the error leaves the callback, everything is rolled back,
 *      and the outcome is `store-name-taken` with the application still `PENDING` (D-041 point 1);
 *   7. one `AuditLog` row (REQ-A-10), in the same transaction.
 *
 * Any other unique violation (a slug collision, which is all but impossible with 40 random bits)
 * rolls the transaction back and the whole approval is tried again with a new slug, at most
 * APPROVAL_SLUG_ATTEMPTS times; after that the error is passed on (500, nothing stored).
 */
export async function approveApplicationRow(
  applicationId: string,
  adminId: string,
  newSlug: (storeName: string) => string,
): Promise<DecisionOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const application = await lockApplication(tx, applicationId);
        if (application === null) return { kind: "not-found" } as const;
        if (application.status !== "PENDING") return { kind: "not-pending" } as const;
        const applicant = await lockApplicant(tx, application.userId);
        if (applicant === null) return { kind: "applicant-not-customer" } as const;
        if (!applicant.isActive) return { kind: "applicant-inactive" } as const;
        if ((await checkStoreName(tx, application.storeName)).reserved) {
          return { kind: "store-name-reserved" } as const;
        }
        const reviewedAt = new Date();
        if (!(await moveApplication(tx, applicationId, "APPROVED", adminId, null, reviewedAt))) {
          return { kind: "not-pending" } as const;
        }
        const promoted = await tx.user.updateMany({
          where: { id: application.userId, role: "CUSTOMER", isActive: true },
          data: { role: "SELLER" },
        });
        if (promoted.count !== 1) throw new Rollback("applicant-not-customer");
        const store = await tx.store.create({
          data: {
            ownerId: application.userId,
            name: application.storeName,
            slug: newSlug(application.storeName),
            description: application.description,
            contactPhone: application.contactPhone,
            status: "APPROVED",
          },
          select: { id: true, name: true, slug: true, status: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: AUDIT_ACTION_APPLICATION_APPROVED,
            targetType: AUDIT_TARGET_SELLER_APPLICATION,
            targetId: applicationId,
            metadata: {
              applicantId: application.userId,
              before: { status: "PENDING", role: "CUSTOMER" },
              after: { status: "APPROVED", role: "SELLER", storeId: store.id },
            },
          },
          select: { id: true },
        });
        return {
          kind: "decided",
          row: {
            application: {
              id: applicationId,
              userId: application.userId,
              status: "APPROVED",
              reviewNote: null,
              reviewedAt,
            },
            store,
          },
        } as const;
      }, SELLER_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof Rollback) return { kind: "applicant-not-customer" };
      if (isStoreNameKeyViolation(error)) return { kind: "store-name-taken" };
      if (isUniqueViolation(error) && attempt < APPROVAL_SLUG_ATTEMPTS) continue;
      throw error;
    }
  }
}

/**
 * `PENDING` to `REJECTED` with the reason, in one transaction: lock, guarded update (the role
 * stays `CUSTOMER`, no store is created), one `AuditLog` row with the reason.
 */
export async function rejectApplicationRow(
  applicationId: string,
  adminId: string,
  reason: string,
): Promise<DecisionOutcome> {
  return db.$transaction(async (tx) => {
    const application = await lockApplication(tx, applicationId);
    if (application === null) return { kind: "not-found" } as const;
    if (application.status !== "PENDING") return { kind: "not-pending" } as const;
    const reviewedAt = new Date();
    if (!(await moveApplication(tx, applicationId, "REJECTED", adminId, reason, reviewedAt))) {
      return { kind: "not-pending" } as const;
    }
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: AUDIT_ACTION_APPLICATION_REJECTED,
        targetType: AUDIT_TARGET_SELLER_APPLICATION,
        targetId: applicationId,
        metadata: {
          applicantId: application.userId,
          reason,
          before: { status: "PENDING" },
          after: { status: "REJECTED" },
        },
      },
      select: { id: true },
    });
    return {
      kind: "decided",
      row: {
        application: {
          id: applicationId,
          userId: application.userId,
          status: "REJECTED",
          reviewNote: reason,
          reviewedAt,
        },
        store: null,
      },
    } as const;
  }, SELLER_TRANSACTION_OPTIONS);
}
