/**
 * Prisma queries of the admin module (docs/API_CONTRACTS.md section 5.9; DATA_MODEL.md sections
 * 4.1, 4.2, 4.4, 4.5, 6.16, 6.17, 7.3 to 7.8).
 *
 * Scope. An admin may see every row, so no query here is scoped by an owner. Every id comes from
 * the path, validated for its form only; an unknown id is a null result, answered 404 by the
 * service. Nothing of a request names the acting admin: `adminId` is always the session's.
 *
 * Transactions (CLAUDE.md rule 5). Every write runs in one interactive transaction that also
 * writes its `AuditLog` row (REQ-A-10; DATA_MODEL.md 6.17: append-only, same transaction). A
 * refused write writes no audit row: the refusal returns before the audit insert, or rolls the
 * whole transaction back. Inside a transaction every `tx` statement selects scalar fields only and
 * statements are awaited one after the other (DATA_MODEL.md 7.8). Every status column changes only
 * through a guarded statement whose `WHERE` names the expected current value (DATA_MODEL.md 7.6),
 * and zero affected rows is a refusal, never a silent success.
 *
 * The acting admin (SEC-088, D-024). The actor is read once per request, so every write
 * transaction first checks that `adminId` is still an active `ADMIN` (`assertActingAdmin`, the row
 * locked `FOR SHARE`; acting-admin.ts) and refuses with 401 UNAUTHENTICATED otherwise. A deactivation
 * of an admin target checks it against the active admin rows it locks `FOR UPDATE` instead.
 *
 * Locks (DATA_MODEL.md 7.5). Each transaction first locks the acting admin's `User` row as above,
 * then only the rows of its own table group:
 *
 *   - a user's active flag: the active admin rows (`FOR UPDATE`, id order) when the target is an
 *     admin ("not the last admin"), else the target row (`FOR NO KEY UPDATE`); then its sessions;
 *   - a store's status: the `Store` row, `FOR NO KEY UPDATE`, so a seller write holding the row's
 *     `FOR SHARE` (requireApprovedStoreForWrite) finishes first and a suspension then waits;
 *   - a moderation decision: the `Product` row, `FOR NO KEY UPDATE` (a seller edit holds
 *     `FOR UPDATE`, so the two queue);
 *   - a category: the `Category` row, `FOR NO KEY UPDATE` for a change, `FOR UPDATE` for a delete
 *     (a seller's product write holds `FOR SHARE` on it, so either waits for the other);
 *   - a fulfilment move: the `SellerOrder` row (`FOR UPDATE OF so`), then its `OrderItem` rows (the
 *     claim of 7.3), then the `Product` rows in `COLLATE "C"` order: the order of 7.5, skipping
 *     `Cart` and `Order`. The `Order` row is read, not locked: its payment status can still move
 *     from `PENDING` while an admin cancels, and the payment failure then finds the part cancelled
 *     and its items already claimed (BR-20, D-028);
 *   - the settings: the single row, `FOR UPDATE`;
 *   - a review's visibility (SEC-092): the `Review` row, `FOR NO KEY UPDATE`.
 *
 * No transaction here locks a row of both the seller chain (`Store`, `Category`) and the cart and
 * order chain (`Cart`, `Order`, `SellerOrder`), as DATA_MODEL.md 7.5 requires.
 *
 * Reads take no lock and write nothing. A list reads its count and its page in one read-only
 * `REPEATABLE READ` snapshot, so `total` always agrees with the page; so do the summary and the
 * report. The order list and the order detail are the exception: their rows carry nested
 * relations, which must not be loaded inside an interactive transaction (DATA_MODEL.md 7.8), so
 * they run outside one, as the customer's order history does.
 *
 * Raw statements are tagged templates with bound parameters only; no SQL text is built from a
 * value. Nothing here logs: the rows hold names, emails, phones, and addresses (SECURITY.md SR-04).
 */
import {
  claimAndRestoreStock,
  fulfilmentSourceStates,
  type FulfilmentStatusValue,
  markShipmentDelivered,
  type OrderRow,
  type PaymentStatusValue,
} from "@/modules/orders";
import { generateSlug, STORE_TRANSITIONS, type StoreStatusValue } from "@/modules/sellers";
import type { Role } from "@/server/auth/actor";
import { db, type DbTransaction, isUniqueIndexViolation, Prisma } from "@/server/db";

import { actingAdminRefused, assertActingAdmin } from "./acting-admin";
import type { AdminTargetStatus } from "./schema";
import {
  activationMove,
  type ModerationDecision,
  moderationRule,
  type ReviewVisibilityAction,
  reviewVisibilityMove,
  reviewVisibilityOf,
} from "./state";

/** Interactive transaction limits of an admin write. */
export const ADMIN_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

const READ_TRANSACTION_OPTIONS = {
  ...ADMIN_TRANSACTION_OPTIONS,
  // The value of Prisma.TransactionIsolationLevel.RepeatableRead, as a literal so that loading
  // this file reads nothing of the client.
  isolationLevel: "RepeatableRead",
} as const satisfies { isolationLevel: Prisma.TransactionIsolationLevel };

/** How many times a category create is tried when the generated slug collides. */
export const CATEGORY_SLUG_ATTEMPTS = 3;
export const CATEGORY_SLUG_INDEX = "Category_slug_key";

/** The single settings row (DATA_MODEL.md 6.16). */
export const SETTINGS_ROW_ID = 1;

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface PageRows<T> {
  rows: T[];
  total: number;
}

/** `%`, `_`, and `\` are ordinary characters of a search text (as in the catalog). */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function containsText(text: string): { contains: string; mode: "insensitive" } {
  return { contains: escapeLikePattern(text), mode: "insensitive" };
}

function skipOf(page: PageRequest): number {
  return (page.page - 1) * page.pageSize;
}

/** Runs `read` in one read-only `REPEATABLE READ` snapshot. */
async function snapshot<T>(read: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(tx);
  }, READ_TRANSACTION_OPTIONS);
}

/** The foreign key of `Product.categoryId` (Restrict), named by the first migration. */
export const PRODUCT_CATEGORY_FOREIGN_KEY = "Product_categoryId_fkey";

/**
 * PostgreSQL's `restrict_violation` (`23001`, a delete of a referenced row under `ON DELETE
 * RESTRICT`) and `foreign_key_violation` (`23503`, the same under `NO ACTION`).
 */
const REFERENCE_VIOLATION_SQLSTATES: readonly unknown[] = ["23001", "23503"];

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * True only when `Product_categoryId_fkey` refused a model-API write: `P2003`, SQLSTATE `23001`
 * or `23503` in `meta.driverAdapterError.cause.originalCode`, and that constraint in
 * `cause.constraint.index`. Observed with Prisma 7.10 and `@prisma/adapter-pg` against
 * PostgreSQL: deleting a referenced category is `P2003` with `23001` (`RestrictViolation`).
 * Any other foreign key, such as `AuditLog_actorId_fkey`, is false, so its error goes on as a
 * 500 (CR-T050-06). The message beside them is never read.
 */
export function isProductCategoryForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2003") {
    return false;
  }
  const cause = field(field(error.meta, "driverAdapterError"), "cause");
  if (!REFERENCE_VIOLATION_SQLSTATES.includes(field(cause, "originalCode"))) return false;
  return field(field(cause, "constraint"), "index") === PRODUCT_CATEGORY_FOREIGN_KEY;
}

// ---------------------------------------------------------------------------------------------
// Audit log (REQ-A-10; DATA_MODEL.md 6.17)
// ---------------------------------------------------------------------------------------------

/** Every action this module writes (`AuditLog.action`). */
export const AUDIT_ACTIONS = {
  userDeactivated: "USER_DEACTIVATED",
  userReactivated: "USER_REACTIVATED",
  storeSuspended: "STORE_SUSPENDED",
  storeReinstated: "STORE_REINSTATED",
  productApproved: "PRODUCT_APPROVED",
  productRejected: "PRODUCT_REJECTED",
  productTakenDown: "PRODUCT_TAKEN_DOWN",
  categoryCreated: "CATEGORY_CREATED",
  categoryUpdated: "CATEGORY_UPDATED",
  categoryDeleted: "CATEGORY_DELETED",
  sellerOrderCancelled: "SELLER_ORDER_CANCELLED",
  sellerOrderDelivered: "SELLER_ORDER_DELIVERED",
  settingsUpdated: "SETTINGS_UPDATED",
  reviewHidden: "REVIEW_HIDDEN",
  reviewUnhidden: "REVIEW_UNHIDDEN",
} as const;

/** Every target type this module writes (`AuditLog.targetType`). */
export const AUDIT_TARGETS = {
  user: "User",
  store: "Store",
  product: "Product",
  category: "Category",
  sellerOrder: "SellerOrder",
  settings: "MarketplaceSettings",
  review: "Review",
} as const;

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  /**
   * The reason and a before and after summary. Never a session token, a password hash, an IP
   * address, or browser details (DATA_MODEL.md 6.17).
   */
  metadata: Prisma.InputJsonObject;
}

/** Appends one audit row inside the caller's transaction. The only write path of `AuditLog`. */
export async function writeAudit(tx: DbTransaction, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({ data: entry, select: { id: true } });
}

const AUDIT_SELECT = {
  id: true,
  actorId: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  createdAt: true,
} as const satisfies Prisma.AuditLogSelect;

export type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

export interface AuditFilter {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

/** One page of audit entries, newest first, then `id`. Read-only. */
export async function listAuditLogs(
  filter: AuditFilter,
  page: PageRequest,
): Promise<PageRows<AuditRow>> {
  const where: Prisma.AuditLogWhereInput = {
    ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
    ...(filter.action === undefined ? {} : { action: filter.action }),
    ...(filter.targetType === undefined ? {} : { targetType: filter.targetType }),
    ...(filter.targetId === undefined ? {} : { targetId: filter.targetId }),
    ...(filter.from === undefined && filter.to === undefined
      ? {}
      : {
          createdAt: {
            ...(filter.from === undefined ? {} : { gte: filter.from }),
            ...(filter.to === undefined ? {} : { lt: filter.to }),
          },
        }),
  };
  return snapshot(async (tx) => {
    const total = await tx.auditLog.count({ where });
    if (skipOf(page) >= total) return { rows: [], total };
    const rows = await tx.auditLog.findMany({
      where,
      select: AUDIT_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skipOf(page),
      take: page.pageSize,
    });
    return { rows, total };
  });
}

// ---------------------------------------------------------------------------------------------
// Users (REQ-A-02; DATA_MODEL.md 4.5)
// ---------------------------------------------------------------------------------------------

const USER_SCALAR_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

type UserScalarRow = Prisma.UserGetPayload<{ select: typeof USER_SCALAR_SELECT }>;

export interface UserRow extends UserScalarRow {
  store: { id: string; name: string; slug: string; status: StoreStatusValue } | null;
}

type StoreReadClient = Pick<DbTransaction, "store">;

async function withStores(client: StoreReadClient, rows: UserScalarRow[]): Promise<UserRow[]> {
  if (rows.length === 0) return [];
  const stores = await client.store.findMany({
    where: { ownerId: { in: rows.map((row) => row.id) } },
    select: { id: true, ownerId: true, name: true, slug: true, status: true },
  });
  const byOwner = new Map(stores.map(({ ownerId, ...store }) => [ownerId, store]));
  return rows.map((row) => ({ ...row, store: byOwner.get(row.id) ?? null }));
}

export interface UserFilter {
  q?: string;
  role?: Role;
  isActive?: boolean;
}

/** One page of users, newest first, then `id`. */
export async function listUsers(filter: UserFilter, page: PageRequest): Promise<PageRows<UserRow>> {
  const and: Prisma.UserWhereInput[] = [];
  if (filter.q !== undefined) {
    and.push({ OR: [{ name: containsText(filter.q) }, { email: containsText(filter.q) }] });
  }
  if (filter.role !== undefined) and.push({ role: filter.role });
  if (filter.isActive !== undefined) and.push({ isActive: filter.isActive });
  const where: Prisma.UserWhereInput = { AND: and };
  return snapshot(async (tx) => {
    const total = await tx.user.count({ where });
    if (skipOf(page) >= total) return { rows: [], total };
    const rows = await tx.user.findMany({
      where,
      select: USER_SCALAR_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skipOf(page),
      take: page.pageSize,
    });
    return { rows: await withStores(tx, rows), total };
  });
}

async function readUser(tx: DbTransaction, userId: string): Promise<UserRow> {
  const row = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: USER_SCALAR_SELECT,
  });
  const [withStore] = await withStores(tx, [row]);
  if (withStore === undefined) throw new Error("admin: a user read back is missing.");
  return withStore;
}

export type ActivationOutcome =
  | { kind: "done"; row: UserRow }
  | { kind: "not-found" }
  | { kind: "self" }
  | { kind: "invalid-state" }
  | { kind: "last-admin" };

interface LockedUser {
  role: Role;
  isActive: boolean;
}

/**
 * Deactivates a user in one transaction (REQ-A-02; DATA_MODEL.md 4.5), in this order, the first
 * failing step answering:
 *
 *   1. read the target (no lock yet). When it is unknown or not an admin, the acting admin's row
 *      is checked (`assertActingAdmin`, 401 UNAUTHENTICATED); then none is `not-found`;
 *   2. when the target is an admin, every active admin row `FOR UPDATE` in byte order of the id
 *      (the "not the last admin" count of 7.5), so two admins deactivating each other queue; the
 *      acting admin not among them is 401 UNAUTHENTICATED (SEC-088: it was deactivated after its
 *      request passed the guard);
 *   3. the target is the acting admin: `self` (SELF_DEACTIVATION);
 *   4. lock the target row: `FOR UPDATE` for an admin, else `FOR NO KEY UPDATE`. The role is read
 *      again under the lock. Already inactive: `invalid-state`;
 *   5. an admin target that is the only active admin left: `last-admin` (LAST_ADMIN);
 *   6. the guarded update `isActive = true` to `false`, every session of the user deleted, and one
 *      audit row (`USER_DEACTIVATED`).
 *
 * No order, seller order, product, store, or stock value is changed (BR-27): the store and its
 * products are hidden by the visibility rule, which reads the owner's flag.
 */
export async function deactivateUser(userId: string, adminId: string): Promise<ActivationOutcome> {
  const move = activationMove("deactivate");
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    // An admin target is checked against the admin rows locked below instead: a FOR SHARE on the
    // acting admin's row before that FOR UPDATE would deadlock two admins removing each other.
    if (target === null || target.role !== "ADMIN") await assertActingAdmin(tx, adminId);
    if (target === null) return { kind: "not-found" } as const;

    let activeAdminCount = 0;
    if (target.role === "ADMIN") {
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User"
         WHERE "role" = 'ADMIN' AND "isActive" = true
         ORDER BY "id" COLLATE "C" ASC
           FOR UPDATE`;
      if (!admins.some((admin) => admin.id === adminId)) throw actingAdminRefused();
      activeAdminCount = admins.length;
    }
    if (userId === adminId) return { kind: "self" } as const;
    const lockedRows =
      target.role === "ADMIN"
        ? await tx.$queryRaw<LockedUser[]>`
            SELECT "role"::text AS "role", "isActive" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
        : await tx.$queryRaw<LockedUser[]>`
            SELECT "role"::text AS "role", "isActive" FROM "User" WHERE "id" = ${userId}
               FOR NO KEY UPDATE`;
    const locked = lockedRows[0];
    if (locked === undefined) return { kind: "not-found" } as const;
    if (locked.isActive !== move.from) return { kind: "invalid-state" } as const;
    if (locked.role === "ADMIN" && activeAdminCount <= 1) return { kind: "last-admin" } as const;

    const { count } = await tx.user.updateMany({
      where: { id: userId, isActive: move.from },
      data: { isActive: move.to },
    });
    if (count !== 1) return { kind: "invalid-state" } as const;
    // The same statement as deleteSessionsOfUser in src/server/auth/session.ts, which modules may
    // not import (D-022): every session row of the user goes, with its address and browser details.
    const sessions = await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, {
      actorId: adminId,
      action: AUDIT_ACTIONS.userDeactivated,
      targetType: AUDIT_TARGETS.user,
      targetId: userId,
      metadata: {
        role: locked.role,
        before: { isActive: move.from },
        after: { isActive: move.to },
        sessionsRevoked: sessions.count,
      },
    });
    return { kind: "done", row: await readUser(tx, userId) } as const;
  }, ADMIN_TRANSACTION_OPTIONS);
}

/**
 * Reactivates a user in one transaction: lock the row (`FOR NO KEY UPDATE`; none is `not-found`),
 * already active is `invalid-state`, the guarded update `false` to `true`, one audit row
 * (`USER_REACTIVATED`). The user signs in again; nothing else is written (DATA_MODEL.md 4.5).
 */
export async function reactivateUser(userId: string, adminId: string): Promise<ActivationOutcome> {
  const move = activationMove("reactivate");
  return db.$transaction(async (tx) => {
    await assertActingAdmin(tx, adminId);
    const rows = await tx.$queryRaw<LockedUser[]>`
      SELECT "role"::text AS "role", "isActive" FROM "User" WHERE "id" = ${userId}
         FOR NO KEY UPDATE`;
    const locked = rows[0];
    if (locked === undefined) return { kind: "not-found" } as const;
    if (locked.isActive !== move.from) return { kind: "invalid-state" } as const;
    const { count } = await tx.user.updateMany({
      where: { id: userId, isActive: move.from },
      data: { isActive: move.to },
    });
    if (count !== 1) return { kind: "invalid-state" } as const;
    await writeAudit(tx, {
      actorId: adminId,
      action: AUDIT_ACTIONS.userReactivated,
      targetType: AUDIT_TARGETS.user,
      targetId: userId,
      metadata: {
        role: locked.role,
        before: { isActive: move.from },
        after: { isActive: move.to },
      },
    });
    return { kind: "done", row: await readUser(tx, userId) } as const;
  }, ADMIN_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Seller applications (REQ-A-03; the decisions are the sellers module's)
// ---------------------------------------------------------------------------------------------

const APPLICATION_SELECT = {
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

type ApplicationScalarRow = Prisma.SellerApplicationGetPayload<{
  select: typeof APPLICATION_SELECT;
}>;

export interface ApplicationRow extends ApplicationScalarRow {
  applicant: { id: string; name: string; email: string; isActive: boolean };
}

/** One page of applications, oldest first, then `id` (section 5.9.2). */
export async function listApplications(
  filter: { status?: ApplicationScalarRow["status"] },
  page: PageRequest,
): Promise<PageRows<ApplicationRow>> {
  const where: Prisma.SellerApplicationWhereInput =
    filter.status === undefined ? {} : { status: filter.status };
  return snapshot(async (tx) => {
    const total = await tx.sellerApplication.count({ where });
    if (skipOf(page) >= total) return { rows: [], total };
    const rows = await tx.sellerApplication.findMany({
      where,
      select: APPLICATION_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: skipOf(page),
      take: page.pageSize,
    });
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
      select: { id: true, name: true, email: true, isActive: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      rows: rows.map((row) => {
        const applicant = byId.get(row.userId);
        // The foreign key is Restrict; a missing applicant is a database fault, never a 404.
        if (applicant === undefined) throw new Error("admin: an applicant row is missing.");
        return { ...row, applicant };
      }),
      total,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Stores (REQ-A-04; DATA_MODEL.md 4.1, 7.7)
// ---------------------------------------------------------------------------------------------

const STORE_SCALAR_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUploadId: true,
  contactPhone: true,
  status: true,
  statusReason: true,
  isSample: true,
  ownerId: true,
  createdAt: true,
} as const satisfies Prisma.StoreSelect;

type StoreScalarRow = Prisma.StoreGetPayload<{ select: typeof STORE_SCALAR_SELECT }>;

export interface StoreRow extends StoreScalarRow {
  logoKey: string | null;
  ownerIsActive: boolean;
}

async function hydrateStores(
  client: Pick<DbTransaction, "user" | "upload">,
  rows: StoreScalarRow[],
): Promise<StoreRow[]> {
  if (rows.length === 0) return [];
  const owners = await client.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.ownerId))] } },
    select: { id: true, isActive: true },
  });
  const logoIds = rows.flatMap((row) => (row.logoUploadId === null ? [] : [row.logoUploadId]));
  const uploads =
    logoIds.length === 0
      ? []
      : await client.upload.findMany({
          where: { id: { in: logoIds } },
          select: { id: true, storageKey: true },
        });
  const activeByOwner = new Map(owners.map((owner) => [owner.id, owner.isActive]));
  const keyByUpload = new Map(uploads.map((upload) => [upload.id, upload.storageKey]));
  return rows.map((row) => {
    const ownerIsActive = activeByOwner.get(row.ownerId);
    if (ownerIsActive === undefined) throw new Error("admin: a store's owner row is missing.");
    return {
      ...row,
      logoKey: row.logoUploadId === null ? null : (keyByUpload.get(row.logoUploadId) ?? null),
      ownerIsActive,
    };
  });
}

/** One page of stores, hidden ones included, newest first, then `id`. */
export async function listStores(
  filter: { status?: StoreStatusValue; q?: string },
  page: PageRequest,
): Promise<PageRows<StoreRow>> {
  const and: Prisma.StoreWhereInput[] = [];
  if (filter.status !== undefined) and.push({ status: filter.status });
  if (filter.q !== undefined) and.push({ name: containsText(filter.q) });
  const where: Prisma.StoreWhereInput = { AND: and };
  return snapshot(async (tx) => {
    const total = await tx.store.count({ where });
    if (skipOf(page) >= total) return { rows: [], total };
    const rows = await tx.store.findMany({
      where,
      select: STORE_SCALAR_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skipOf(page),
      take: page.pageSize,
    });
    return { rows: await hydrateStores(tx, rows), total };
  });
}

export type StoreMoveOutcome =
  { kind: "done"; row: StoreRow } | { kind: "not-found" } | { kind: "invalid-state" };

/**
 * Suspends or reinstates a store in one transaction (REQ-A-04; DATA_MODEL.md 4.1): lock the row
 * (`FOR NO KEY UPDATE`; none is `not-found`), the move must be a row of `STORE_TRANSITIONS`
 * (`invalid-state` otherwise), the guarded update takes its source state from the same table and
 * writes the reason to `statusReason`, then one audit row. Sessions are not revoked and no order
 * changes (BR-14; D-027).
 */
export async function moveStoreStatus(
  storeId: string,
  to: StoreStatusValue,
  reason: string,
  adminId: string,
): Promise<StoreMoveOutcome> {
  const sources = STORE_TRANSITIONS.filter((row) => row.to === to).map((row) => row.from);
  return db.$transaction(async (tx) => {
    await assertActingAdmin(tx, adminId);
    const rows = await tx.$queryRaw<{ status: StoreStatusValue }[]>`
      SELECT "status"::text AS "status" FROM "Store" WHERE "id" = ${storeId} FOR NO KEY UPDATE`;
    const current = rows[0];
    if (current === undefined) return { kind: "not-found" } as const;
    if (!sources.includes(current.status)) return { kind: "invalid-state" } as const;
    const { count } = await tx.store.updateMany({
      where: { id: storeId, status: { in: sources } },
      data: { status: to, statusReason: reason },
    });
    if (count !== 1) return { kind: "invalid-state" } as const;
    await writeAudit(tx, {
      actorId: adminId,
      action: to === "SUSPENDED" ? AUDIT_ACTIONS.storeSuspended : AUDIT_ACTIONS.storeReinstated,
      targetType: AUDIT_TARGETS.store,
      targetId: storeId,
      metadata: { reason, before: { status: current.status }, after: { status: to } },
    });
    const row = await tx.store.findUniqueOrThrow({
      where: { id: storeId },
      select: STORE_SCALAR_SELECT,
    });
    const [hydrated] = await hydrateStores(tx, [row]);
    if (hydrated === undefined) throw new Error("admin: a store read back is missing.");
    return { kind: "done", row: hydrated } as const;
  }, ADMIN_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Products (REQ-A-05; DATA_MODEL.md 4.2, 7.6)
// ---------------------------------------------------------------------------------------------

const PRODUCT_SCALAR_SELECT = {
  id: true,
  storeId: true,
  slug: true,
  title: true,
  description: true,
  sku: true,
  categoryId: true,
  priceSatang: true,
  stock: true,
  status: true,
  moderationStatus: true,
  moderationNote: true,
  moderationRequestedAt: true,
  contentRevision: true,
  isSample: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProductSelect;

type ProductScalarRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SCALAR_SELECT }>;

export interface ProductRow extends ProductScalarRow {
  category: { id: string; name: string; isActive: boolean };
  store: { id: string; name: string; slug: string; status: StoreStatusValue };
  /** Storage keys of the pictures in display order. */
  imageKeys: string[];
}

/**
 * Adds the category, the store, and the picture keys to scalar rows, by plain statements awaited
 * one after the other (safe inside a transaction, DATA_MODEL.md 7.8).
 */
async function hydrateProducts(
  client: Pick<DbTransaction, "category" | "store" | "productImage" | "upload">,
  rows: ProductScalarRow[],
): Promise<ProductRow[]> {
  if (rows.length === 0) return [];
  const categories = await client.category.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.categoryId))] } },
    select: { id: true, name: true, isActive: true },
  });
  const stores = await client.store.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.storeId))] } },
    select: { id: true, name: true, slug: true, status: true },
  });
  const links = await client.productImage.findMany({
    where: { productId: { in: rows.map((row) => row.id) } },
    select: { productId: true, uploadId: true, sortOrder: true },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
  });
  const uploads =
    links.length === 0
      ? []
      : await client.upload.findMany({
          where: { id: { in: links.map((link) => link.uploadId) } },
          select: { id: true, storageKey: true },
        });
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const keyByUpload = new Map(uploads.map((upload) => [upload.id, upload.storageKey]));
  return rows.map((row) => {
    const category = categoryById.get(row.categoryId);
    const store = storeById.get(row.storeId);
    // Both foreign keys are Restrict; a missing row is a database fault, never a 404.
    if (category === undefined || store === undefined) {
      throw new Error("admin: a product's category or store row is missing.");
    }
    const imageKeys = links
      .filter((link) => link.productId === row.id)
      .map((link) => keyByUpload.get(link.uploadId))
      .filter((key): key is string => key !== undefined);
    return { ...row, category, store, imageKeys };
  });
}

export interface ProductFilter {
  queue?: true;
  moderationStatus?: ProductScalarRow["moderationStatus"];
  status?: ProductScalarRow["status"];
  storeId?: string;
  q?: string;
}

/**
 * The approval queue (BR-36; DATA_MODEL.md 4.2): `PENDING` and `PUBLISHED`, oldest submission
 * first (`moderationRequestedAt`), then `id`. Any other list: newest first, then `id`.
 */
export function productListQuery(filter: ProductFilter): {
  where: Prisma.ProductWhereInput;
  orderBy: Prisma.ProductOrderByWithRelationInput[];
} {
  const and: Prisma.ProductWhereInput[] = [];
  if (filter.queue === true) and.push({ moderationStatus: "PENDING", status: "PUBLISHED" });
  if (filter.moderationStatus !== undefined) {
    and.push({ moderationStatus: filter.moderationStatus });
  }
  if (filter.status !== undefined) and.push({ status: filter.status });
  if (filter.storeId !== undefined) and.push({ storeId: filter.storeId });
  if (filter.q !== undefined) and.push({ title: containsText(filter.q) });
  return {
    where: { AND: and },
    orderBy:
      filter.queue === true
        ? [{ moderationRequestedAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
  };
}

/** One page of products, whatever their state. */
export async function listProducts(
  filter: ProductFilter,
  page: PageRequest,
): Promise<PageRows<ProductRow>> {
  const { where, orderBy } = productListQuery(filter);
  return snapshot(async (tx) => {
    const total = await tx.product.count({ where });
    if (skipOf(page) >= total) return { rows: [], total };
    const rows = await tx.product.findMany({
      where,
      select: PRODUCT_SCALAR_SELECT,
      orderBy,
      skip: skipOf(page),
      take: page.pageSize,
    });
    return { rows: await hydrateProducts(tx, rows), total };
  });
}

async function findProductIn(tx: DbTransaction, productId: string): Promise<ProductRow | null> {
  const row = await tx.product.findUnique({
    where: { id: productId },
    select: PRODUCT_SCALAR_SELECT,
  });
  if (row === null) return null;
  const [hydrated] = await hydrateProducts(tx, [row]);
  return hydrated ?? null;
}

/** Any product by id, whatever its state, in one snapshot; null when unknown. */
export async function findProduct(productId: string): Promise<ProductRow | null> {
  return snapshot((tx) => findProductIn(tx, productId));
}

export type DecisionOutcome =
  | { kind: "done"; row: ProductRow }
  | { kind: "not-found" }
  | { kind: "stale-revision" }
  | { kind: "invalid-state" };

export interface LockedProductState {
  storeId: string;
  status: ProductScalarRow["status"];
  moderationStatus: ProductScalarRow["moderationStatus"];
  contentRevision: number;
}

/**
 * One moderation decision in one transaction (DATA_MODEL.md 4.2 and 7.6):
 *
 *   1. lock the product row (`FOR NO KEY UPDATE`): none is `not-found`;
 *   2. `judge` (the service's rule of state.ts) decides on what is stored: the revision first
 *      (`stale-revision`, item 8.2-6), then the table (`invalid-state`);
 *   3. the guarded statement carries the same conditions (`moderationStatus`, `contentRevision`,
 *      and `status = 'PUBLISHED'` for approve and reject); zero rows is `invalid-state`. Approve
 *      clears `moderationNote`; reject and takedown store the reason in it;
 *   4. one audit row; the product is read back.
 */
export async function decideProduct(
  productId: string,
  decision: ModerationDecision,
  seenRevision: number,
  reason: string | null,
  adminId: string,
  judge: (current: LockedProductState) => "ok" | "stale-revision" | "invalid-state",
): Promise<DecisionOutcome> {
  const rule = moderationRule(decision);
  return db.$transaction(async (tx) => {
    await assertActingAdmin(tx, adminId);
    const rows = await tx.$queryRaw<LockedProductState[]>`
      SELECT "storeId", "status"::text AS "status", "moderationStatus"::text AS "moderationStatus",
             "contentRevision"
        FROM "Product" WHERE "id" = ${productId}
         FOR NO KEY UPDATE`;
    const current = rows[0];
    if (current === undefined) return { kind: "not-found" } as const;
    const judgement = judge(current);
    if (judgement !== "ok") return { kind: judgement } as const;

    const { count } = await tx.product.updateMany({
      where: {
        id: productId,
        moderationStatus: rule.from,
        contentRevision: seenRevision,
        ...(rule.requiresStatus === null ? {} : { status: rule.requiresStatus }),
      },
      data: { moderationStatus: rule.to, moderationNote: rule.reasonRequired ? reason : null },
    });
    if (count !== 1) return { kind: "invalid-state" } as const;
    const action =
      decision === "approve"
        ? AUDIT_ACTIONS.productApproved
        : decision === "reject"
          ? AUDIT_ACTIONS.productRejected
          : AUDIT_ACTIONS.productTakenDown;
    await writeAudit(tx, {
      actorId: adminId,
      action,
      targetType: AUDIT_TARGETS.product,
      targetId: productId,
      metadata: {
        storeId: current.storeId,
        contentRevision: seenRevision,
        ...(reason === null ? {} : { reason }),
        before: { moderationStatus: current.moderationStatus, status: current.status },
        after: { moderationStatus: rule.to, status: current.status },
      },
    });
    const row = await findProductIn(tx, productId);
    if (row === null) throw new Error("admin: a product decided in this transaction is gone.");
    return { kind: "done", row } as const;
  }, ADMIN_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Categories (REQ-A-06; BR-23)
// ---------------------------------------------------------------------------------------------

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  sortOrder: true,
  isActive: true,
  isSample: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CategorySelect;

export type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

/** One page of categories, inactive ones included, by `sortOrder`, then `id`. */
export async function listCategories(page: PageRequest): Promise<PageRows<CategoryRow>> {
  return snapshot(async (tx) => {
    const total = await tx.category.count();
    if (skipOf(page) >= total) return { rows: [], total };
    const rows = await tx.category.findMany({
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      skip: skipOf(page),
      take: page.pageSize,
    });
    return { rows, total };
  });
}

/**
 * Creates a category in one transaction with a generated slug and one audit row. Without a
 * `sortOrder` the category goes after the last one (largest plus one, at most `maxSortOrder`).
 * Only a slug collision on `Category_slug_key` retries the whole create with a new slug, at most
 * CATEGORY_SLUG_ATTEMPTS times; after that, and for any other error, the error goes on (500).
 */
export async function createCategory(
  input: { name: string; sortOrder?: number },
  adminId: string,
  maxSortOrder: number,
): Promise<CategoryRow> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        await assertActingAdmin(tx, adminId);
        let sortOrder = input.sortOrder;
        if (sortOrder === undefined) {
          const last = await tx.category.aggregate({ _max: { sortOrder: true } });
          sortOrder = Math.min((last._max.sortOrder ?? -1) + 1, maxSortOrder);
        }
        const row = await tx.category.create({
          data: { name: input.name, slug: generateSlug(input.name), sortOrder, isActive: true },
          select: CATEGORY_SELECT,
        });
        await writeAudit(tx, {
          actorId: adminId,
          action: AUDIT_ACTIONS.categoryCreated,
          targetType: AUDIT_TARGETS.category,
          targetId: row.id,
          metadata: {
            after: { name: row.name, slug: row.slug, sortOrder: row.sortOrder, isActive: true },
          },
        });
        return row;
      }, ADMIN_TRANSACTION_OPTIONS);
    } catch (error) {
      if (isUniqueIndexViolation(error, CATEGORY_SLUG_INDEX) && attempt < CATEGORY_SLUG_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }
}

export type CategoryUpdateOutcome = { kind: "done"; row: CategoryRow } | { kind: "not-found" };

export type CategoryDeleteOutcome =
  { kind: "deleted" } | { kind: "not-found" } | { kind: "has-products" };

interface LockedCategory {
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * Changes a category in one transaction: lock (`FOR NO KEY UPDATE`; none is `not-found`), write
 * only the fields that differ, and one audit row with their before and after values. A request in
 * which nothing differs writes nothing and no audit row. Switching `isActive` is guarded by the
 * stored value (DATA_MODEL.md 7.6). No product is changed: visibility reads the category (BR-23).
 * The slug never changes.
 */
export async function updateCategory(
  categoryId: string,
  change: { name?: string; sortOrder?: number; isActive?: boolean },
  adminId: string,
): Promise<CategoryUpdateOutcome> {
  return db.$transaction(async (tx) => {
    await assertActingAdmin(tx, adminId);
    const rows = await tx.$queryRaw<LockedCategory[]>`
      SELECT "name", "slug", "sortOrder", "isActive" FROM "Category" WHERE "id" = ${categoryId}
         FOR NO KEY UPDATE`;
    const current = rows[0];
    if (current === undefined) return { kind: "not-found" } as const;
    const before: Record<string, string | number | boolean> = {};
    const after: Record<string, string | number | boolean> = {};
    const data: Prisma.CategoryUpdateManyMutationInput = {};
    if (change.name !== undefined && change.name !== current.name) {
      before.name = current.name;
      after.name = change.name;
      data.name = change.name;
    }
    if (change.sortOrder !== undefined && change.sortOrder !== current.sortOrder) {
      before.sortOrder = current.sortOrder;
      after.sortOrder = change.sortOrder;
      data.sortOrder = change.sortOrder;
    }
    if (change.isActive !== undefined && change.isActive !== current.isActive) {
      before.isActive = current.isActive;
      after.isActive = change.isActive;
      data.isActive = change.isActive;
    }
    if (Object.keys(data).length > 0) {
      const { count } = await tx.category.updateMany({
        where: { id: categoryId, isActive: current.isActive },
        data,
      });
      if (count !== 1) throw new Error("admin: a locked category did not update.");
      await writeAudit(tx, {
        actorId: adminId,
        action: AUDIT_ACTIONS.categoryUpdated,
        targetType: AUDIT_TARGETS.category,
        targetId: categoryId,
        metadata: { slug: current.slug, before, after },
      });
    }
    const row = await tx.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: CATEGORY_SELECT,
    });
    return { kind: "done", row } as const;
  }, ADMIN_TRANSACTION_OPTIONS);
}

/**
 * Deletes a category that no product references, archived ones included (REQ-A-06), in one
 * transaction: lock (`FOR UPDATE`; none is `not-found`), any referencing product is
 * `has-products` and nothing changes, delete, one audit row. A seller's product write holds the
 * category's `FOR SHARE` lock, so one that commits first is counted here; the `Restrict` key on
 * `Product.categoryId` is the backstop (a violation of that key only is the same `has-products`;
 * any other error goes on).
 */
export async function deleteCategory(
  categoryId: string,
  adminId: string,
): Promise<CategoryDeleteOutcome> {
  try {
    return await db.$transaction(async (tx) => {
      await assertActingAdmin(tx, adminId);
      const rows = await tx.$queryRaw<LockedCategory[]>`
        SELECT "name", "slug", "sortOrder", "isActive" FROM "Category" WHERE "id" = ${categoryId}
           FOR UPDATE`;
      const current = rows[0];
      if (current === undefined) return { kind: "not-found" } as const;
      const referenced = await tx.product.findFirst({
        where: { categoryId },
        select: { id: true },
      });
      if (referenced !== null) return { kind: "has-products" } as const;
      await tx.category.delete({ where: { id: categoryId }, select: { id: true } });
      await writeAudit(tx, {
        actorId: adminId,
        action: AUDIT_ACTIONS.categoryDeleted,
        targetType: AUDIT_TARGETS.category,
        targetId: categoryId,
        metadata: {
          before: {
            name: current.name,
            slug: current.slug,
            sortOrder: current.sortOrder,
            isActive: current.isActive,
          },
        },
      });
      return { kind: "deleted" } as const;
    }, ADMIN_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isProductCategoryForeignKeyViolation(error)) return { kind: "has-products" };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Orders (REQ-A-07; BR-20, BR-21, BR-27, BR-29, BR-39, BR-40; DATA_MODEL.md 4.4, 7.3, 7.4)
// ---------------------------------------------------------------------------------------------

const ADMIN_ORDER_SELECT = {
  id: true,
  userId: true,
  orderNumber: true,
  createdAt: true,
  paidAt: true,
  paymentStatus: true,
  itemsSubtotalSatang: true,
  shippingTotalSatang: true,
  grandTotalSatang: true,
  shipRecipientName: true,
  shipPhone: true,
  shipLine1: true,
  shipSubdistrict: true,
  shipDistrict: true,
  shipProvince: true,
  shipPostalCode: true,
  payment: { select: { provider: true, failureReason: true } },
  sellerOrders: {
    select: {
      id: true,
      storeId: true,
      storeName: true,
      store: { select: { slug: true } },
      fulfilmentStatus: true,
      itemsSubtotalSatang: true,
      shippingFeeSatang: true,
      shippingFeeIsSimulated: true,
      commissionRateBps: true,
      shipment: {
        select: {
          carrierName: true,
          trackingNumber: true,
          isSimulated: true,
          shippedAt: true,
          deliveredAt: true,
        },
      },
      items: {
        select: {
          id: true,
          productId: true,
          productTitle: true,
          productSku: true,
          productImageUpload: { select: { storageKey: true } },
          unitPriceSatang: true,
          quantity: true,
          lineTotalSatang: true,
          cartQuantityBeforeReturn: true,
          cartQuantityAfterReturn: true,
          review: { select: { id: true, rating: true, comment: true, createdAt: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.OrderSelect;

/** The customer's order row plus the admin's extras (section 5.9.5). */
export interface AdminOrderRow extends OrderRow {
  userId: string;
  sellerOrders: (OrderRow["sellerOrders"][number] & {
    storeId: string;
    commissionRateBps: number;
  })[];
}

export interface OrderFilter {
  paymentStatus?: PaymentStatusValue;
  fulfilmentStatus?: FulfilmentStatusValue;
  storeId?: string;
  userId?: string;
  orderNumber?: string;
  from?: Date;
  to?: Date;
  paidFrom?: Date;
  paidTo?: Date;
}

/**
 * The `WHERE` of the admin order list. Filters combine with AND. `fulfilmentStatus` and
 * `storeId` are one condition on the seller orders: at least one seller order matches both.
 * The paid range is on `Order.paidAt`, half-open; an order with no paid time (payment `PENDING` or
 * `FAILED`, BR-39) never matches it (BR-40). Pure.
 */
export function orderListWhere(filter: OrderFilter): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (filter.paymentStatus !== undefined) and.push({ paymentStatus: filter.paymentStatus });
  if (filter.fulfilmentStatus !== undefined || filter.storeId !== undefined) {
    and.push({
      sellerOrders: {
        some: {
          ...(filter.fulfilmentStatus === undefined
            ? {}
            : { fulfilmentStatus: filter.fulfilmentStatus }),
          ...(filter.storeId === undefined ? {} : { storeId: filter.storeId }),
        },
      },
    });
  }
  if (filter.userId !== undefined) and.push({ userId: filter.userId });
  if (filter.orderNumber !== undefined) and.push({ orderNumber: filter.orderNumber });
  if (filter.from !== undefined) and.push({ createdAt: { gte: filter.from } });
  if (filter.to !== undefined) and.push({ createdAt: { lt: filter.to } });
  if (filter.paidFrom !== undefined || filter.paidTo !== undefined) {
    and.push({ paymentStatus: "PAID", paidAt: { not: null } });
    if (filter.paidFrom !== undefined) and.push({ paidAt: { gte: filter.paidFrom } });
    if (filter.paidTo !== undefined) and.push({ paidAt: { lt: filter.paidTo } });
  }
  return { AND: and };
}

/**
 * One page of orders, newest first, then `id`, and their count. Outside a transaction: each row
 * carries nested relations (DATA_MODEL.md 7.8), as in the customer's history.
 */
export async function listOrders(
  filter: OrderFilter,
  page: PageRequest,
): Promise<PageRows<AdminOrderRow>> {
  const where = orderListWhere(filter);
  const total = await db.order.count({ where });
  if (skipOf(page) >= total) return { rows: [], total };
  const rows = await db.order.findMany({
    where,
    select: ADMIN_ORDER_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: skipOf(page),
    take: page.pageSize,
  });
  return { rows, total };
}

/** Any order by id, with every seller order; null when unknown. */
export async function findOrder(orderId: string): Promise<AdminOrderRow | null> {
  return db.order.findUnique({ where: { id: orderId }, select: ADMIN_ORDER_SELECT });
}

export type SellerOrderMoveOutcome =
  { kind: "done"; orderId: string } | { kind: "not-found" } | { kind: "invalid-state" };

interface LockedSellerOrder {
  orderId: string;
  storeId: string;
  fulfilmentStatus: FulfilmentStatusValue;
  paymentStatus: PaymentStatusValue;
}

/**
 * An admin's fulfilment move in one transaction (REQ-A-07; DATA_MODEL.md 4.4, 7.3, 7.4):
 *
 *   1. lock the seller order row (`FOR UPDATE OF so`) and read its status and its order's payment
 *      status: none is `not-found`;
 *   2. `judge` (the service's check against the table of src/modules/orders/state.ts for the actor
 *      `ADMIN`, and the refusal of every move on a failed order, BR-20) answers `invalid-state`;
 *   3. the guarded statement takes its source states from the same table; zero rows is
 *      `invalid-state`. An admin's statement carries no store and no paid-order condition (7.4);
 *   4. the effect: `DELIVERED` sets the shipment's delivery time; `CANCELLED` claims the items whose
 *      stock was not yet restored and adds exactly those back (at most once per item, BR-15). The
 *      payment is not touched and no refund is recorded (BR-21);
 *   5. one audit row.
 *
 * Returns the order id; the caller reads the order after the commit.
 */
export async function moveSellerOrderAsAdmin(
  sellerOrderId: string,
  to: AdminTargetStatus,
  adminId: string,
  judge: (current: LockedSellerOrder) => boolean,
): Promise<SellerOrderMoveOutcome> {
  const sources = fulfilmentSourceStates(to, "ADMIN");
  if (sources.length === 0) throw new Error("admin: a fulfilment move with no source state.");
  return db.$transaction(async (tx) => {
    await assertActingAdmin(tx, adminId);
    const rows = await tx.$queryRaw<LockedSellerOrder[]>`
      SELECT so."orderId", so."storeId", so."fulfilmentStatus"::text AS "fulfilmentStatus",
             o."paymentStatus"::text AS "paymentStatus"
        FROM "SellerOrder" so
        JOIN "Order" o ON o."id" = so."orderId"
       WHERE so."id" = ${sellerOrderId}
         FOR UPDATE OF so`;
    const current = rows[0];
    if (current === undefined) return { kind: "not-found" } as const;
    if (!judge(current)) return { kind: "invalid-state" } as const;

    const moved = await tx.$executeRaw`
      UPDATE "SellerOrder"
         SET "fulfilmentStatus" = ${to}::"FulfilmentStatus", "updatedAt" = now()
       WHERE "id" = ${sellerOrderId}
         AND "fulfilmentStatus"::text IN (${Prisma.join(sources)})`;
    if (moved !== 1) return { kind: "invalid-state" } as const;

    let stockRestoredItems = 0;
    if (to === "DELIVERED") {
      if (!(await markShipmentDelivered(tx, sellerOrderId))) {
        // Every move to SHIPPED writes the shipment in the same transaction.
        throw new Error("admin: a SHIPPED seller order has no undelivered shipment.");
      }
    } else {
      stockRestoredItems = await claimAndRestoreStock(tx, sellerOrderId);
    }
    await writeAudit(tx, {
      actorId: adminId,
      action:
        to === "CANCELLED"
          ? AUDIT_ACTIONS.sellerOrderCancelled
          : AUDIT_ACTIONS.sellerOrderDelivered,
      targetType: AUDIT_TARGETS.sellerOrder,
      targetId: sellerOrderId,
      metadata: {
        orderId: current.orderId,
        storeId: current.storeId,
        paymentStatus: current.paymentStatus,
        before: { fulfilmentStatus: current.fulfilmentStatus },
        after: { fulfilmentStatus: to },
        ...(to === "CANCELLED" ? { stockRestoredItems } : {}),
      },
    });
    return { kind: "done", orderId: current.orderId } as const;
  }, ADMIN_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Settings (REQ-A-09; BR-08, BR-13, BR-17, BR-28; DATA_MODEL.md 6.16)
// ---------------------------------------------------------------------------------------------

const SETTINGS_SELECT = {
  flatShippingFeeSatang: true,
  commissionRateBps: true,
  updatedAt: true,
  updatedById: true,
} as const satisfies Prisma.MarketplaceSettingsSelect;

export type SettingsRow = Prisma.MarketplaceSettingsGetPayload<{ select: typeof SETTINGS_SELECT }>;

/** The single row. Its absence is a database fault (the first migration inserts it). */
export async function readSettings(): Promise<SettingsRow> {
  const row = await db.marketplaceSettings.findUnique({
    where: { id: SETTINGS_ROW_ID },
    select: SETTINGS_SELECT,
  });
  if (row === null) throw new Error("admin: the settings row is missing.");
  return row;
}

/**
 * Changes one or both settings in one transaction: lock the row (`FOR UPDATE`), write only the
 * values that differ with the acting admin as `updatedById`, and one audit row with the before
 * and after values. A request in which nothing differs writes nothing and no audit row. A value
 * outside its bounds never reaches this function (the schema), and the row's CHECK constraints
 * are the backstop (BR-28). Existing seller orders keep the values copied at purchase.
 */
export async function updateSettings(
  change: { flatShippingFeeSatang?: number; commissionRateBps?: number },
  adminId: string,
): Promise<SettingsRow> {
  return db.$transaction(async (tx) => {
    await assertActingAdmin(tx, adminId);
    const rows = await tx.$queryRaw<{ flatShippingFeeSatang: number; commissionRateBps: number }[]>`
      SELECT "flatShippingFeeSatang", "commissionRateBps" FROM "MarketplaceSettings"
       WHERE "id" = ${SETTINGS_ROW_ID}
         FOR UPDATE`;
    const current = rows[0];
    if (current === undefined) throw new Error("admin: the settings row is missing.");
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    const data: Prisma.MarketplaceSettingsUncheckedUpdateManyInput = {};
    if (
      change.flatShippingFeeSatang !== undefined &&
      change.flatShippingFeeSatang !== current.flatShippingFeeSatang
    ) {
      before.flatShippingFeeSatang = current.flatShippingFeeSatang;
      after.flatShippingFeeSatang = change.flatShippingFeeSatang;
      data.flatShippingFeeSatang = change.flatShippingFeeSatang;
    }
    if (
      change.commissionRateBps !== undefined &&
      change.commissionRateBps !== current.commissionRateBps
    ) {
      before.commissionRateBps = current.commissionRateBps;
      after.commissionRateBps = change.commissionRateBps;
      data.commissionRateBps = change.commissionRateBps;
    }
    if (Object.keys(data).length > 0) {
      data.updatedById = adminId;
      const { count } = await tx.marketplaceSettings.updateMany({
        where: { id: SETTINGS_ROW_ID },
        data,
      });
      if (count !== 1) throw new Error("admin: the settings row did not update.");
      await writeAudit(tx, {
        actorId: adminId,
        action: AUDIT_ACTIONS.settingsUpdated,
        targetType: AUDIT_TARGETS.settings,
        targetId: String(SETTINGS_ROW_ID),
        metadata: { before, after },
      });
    }
    return tx.marketplaceSettings.findUniqueOrThrow({
      where: { id: SETTINGS_ROW_ID },
      select: SETTINGS_SELECT,
    });
  }, ADMIN_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Summary and report (REQ-A-01, REQ-A-08; BR-33; DATA_MODEL.md 4.4)
// ---------------------------------------------------------------------------------------------

export interface SummaryRows {
  pendingApplicationCount: number;
  pendingProductCount: number;
  userCount: number;
  storesByStatus: { status: string; count: number }[];
  orderCount: number;
  /** Decimal text of a `bigint` sum (an aggregate can exceed 32 bits; section 1.5). */
  paidRevenue: string;
}

/**
 * Every figure of the dashboard, over all time, in one read-only `REPEATABLE READ` snapshot. The
 * order count and the revenue follow BR-33: seller orders of `PAID` orders that are not
 * `CANCELLED`; revenue is `itemsSubtotalSatang` only, never the shipping fee.
 */
export async function readSummaryRows(): Promise<SummaryRows> {
  return snapshot(async (tx) => {
    const pendingApplicationCount = await tx.sellerApplication.count({
      where: { status: "PENDING" },
    });
    const pendingProductCount = await tx.product.count({
      where: { moderationStatus: "PENDING", status: "PUBLISHED" },
    });
    const userCount = await tx.user.count();
    const storesByStatus = await tx.$queryRaw<{ status: string; count: number }[]>`
      SELECT "status"::text AS "status", COUNT(*)::int AS "count" FROM "Store" GROUP BY "status"`;
    const sales = await tx.$queryRaw<{ orderCount: number; revenue: string }[]>`
      SELECT COUNT(DISTINCT so."orderId")::int AS "orderCount",
             COALESCE(SUM(so."itemsSubtotalSatang"::bigint), 0)::text AS "revenue"
        FROM "SellerOrder" so
        JOIN "Order" o ON o."id" = so."orderId"
       WHERE o."paymentStatus" = 'PAID' AND so."fulfilmentStatus" <> 'CANCELLED'`;
    return {
      pendingApplicationCount,
      pendingProductCount,
      userCount,
      storesByStatus,
      orderCount: sales[0]?.orderCount ?? 0,
      paidRevenue: sales[0]?.revenue ?? "0",
    };
  });
}

export interface ReportRows {
  orderCount: number;
  paidRevenue: string;
  newUserCount: number;
  newSellerCount: number;
}

/**
 * The report for `[from, to)` in one snapshot (REQ-A-08): orders and revenue placed by the paid
 * time (D-028), by the rule of BR-33; new users by `User.createdAt`; new sellers by
 * `Store.createdAt` (the moment of approval).
 */
export async function readReportRows(from: Date, to: Date): Promise<ReportRows> {
  return snapshot(async (tx) => {
    const sales = await tx.$queryRaw<{ orderCount: number; revenue: string }[]>`
      SELECT COUNT(DISTINCT so."orderId")::int AS "orderCount",
             COALESCE(SUM(so."itemsSubtotalSatang"::bigint), 0)::text AS "revenue"
        FROM "SellerOrder" so
        JOIN "Order" o ON o."id" = so."orderId"
       WHERE o."paymentStatus" = 'PAID' AND so."fulfilmentStatus" <> 'CANCELLED'
         AND o."paidAt" >= ${from} AND o."paidAt" < ${to}`;
    const newUserCount = await tx.user.count({ where: { createdAt: { gte: from, lt: to } } });
    const newSellerCount = await tx.store.count({ where: { createdAt: { gte: from, lt: to } } });
    return {
      orderCount: sales[0]?.orderCount ?? 0,
      paidRevenue: sales[0]?.revenue ?? "0",
      newUserCount,
      newSellerCount,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Review moderation (SECURITY.md SEC-092; DATA_MODEL.md section 6.15)
// ---------------------------------------------------------------------------------------------

const REVIEW_SCALAR_SELECT = {
  id: true,
  productId: true,
  userId: true,
  rating: true,
  comment: true,
  createdAt: true,
  hiddenAt: true,
  hiddenByUserId: true,
  hiddenReason: true,
} as const satisfies Prisma.ReviewSelect;

type ReviewScalarRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SCALAR_SELECT }>;

export interface ReviewRow extends ReviewScalarRow {
  product: { id: string; title: string; slug: string };
  author: { id: string; name: string };
}

type ReviewHydrationClient = Pick<DbTransaction, "product" | "user">;

/** Adds the product and the author to each row, two scalar reads (DATA_MODEL.md 7.8). */
async function hydrateReviews(
  client: ReviewHydrationClient,
  rows: ReviewScalarRow[],
): Promise<ReviewRow[]> {
  if (rows.length === 0) return [];
  const products = await client.product.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.productId))] } },
    select: { id: true, title: true, slug: true },
  });
  const authors = await client.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
    select: { id: true, name: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const authorById = new Map(authors.map((author) => [author.id, author]));
  return rows.map((row) => {
    const product = productById.get(row.productId);
    const author = authorById.get(row.userId);
    if (product === undefined || author === undefined) {
      throw new Error("admin: a review's product or author is missing.");
    }
    return { ...row, product, author };
  });
}

export interface ReviewFilter {
  productId?: string;
  hidden?: boolean;
}

/**
 * One page of reviews, newest first, then `id`; hidden reviews included unless filtered out. An
 * admin read, so it uses `Review_productId_createdAt_idx`, not the partial index of the public
 * reads (DATA_MODEL.md 6.15).
 */
export async function listReviews(
  filter: ReviewFilter,
  page: PageRequest,
): Promise<PageRows<ReviewRow>> {
  const where: Prisma.ReviewWhereInput = {
    ...(filter.productId === undefined ? {} : { productId: filter.productId }),
    ...(filter.hidden === undefined ? {} : { hiddenAt: filter.hidden ? { not: null } : null }),
  };
  return snapshot(async (tx) => {
    const total = await tx.review.count({ where });
    if (skipOf(page) >= total) return { rows: [], total };
    const rows = await tx.review.findMany({
      where,
      select: REVIEW_SCALAR_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skipOf(page),
      take: page.pageSize,
    });
    return { rows: await hydrateReviews(tx, rows), total };
  });
}

export type ReviewVisibilityOutcome =
  { kind: "done"; row: ReviewRow } | { kind: "not-found" } | { kind: "invalid-state" };

/**
 * Hides or un-hides a review in one transaction (SEC-092; DATA_MODEL.md 6.15), in this order:
 *
 *   1. lock the `Review` row `FOR NO KEY UPDATE` (none is `not-found`);
 *   2. its visibility must be the action's source in `REVIEW_VISIBILITY_TRANSITIONS`
 *      (`invalid-state` otherwise: a double hide, or an un-hide of a public review);
 *   3. the guarded update (D-024): a hide is `WHERE id AND "hiddenAt" IS NULL` and sets
 *      `hiddenAt` to the database clock, `hiddenByUserId` to the session's admin, and
 *      `hiddenReason`; an un-hide is `WHERE id AND "hiddenAt" IS NOT NULL` and sets all three to
 *      null. Zero rows is `invalid-state`;
 *   4. one audit row (`REVIEW_HIDDEN` or `REVIEW_UNHIDDEN`, target `Review`): the reason, the
 *      product id, and the before and after visibility. Never the comment (SR-04).
 *
 * The review's rating and comment are never changed; nothing is deleted.
 */
export async function moveReviewVisibility(
  reviewId: string,
  action: ReviewVisibilityAction,
  reason: string | null,
  adminId: string,
): Promise<ReviewVisibilityOutcome> {
  const move = reviewVisibilityMove(action);
  return db.$transaction(async (tx) => {
    await assertActingAdmin(tx, adminId);
    const rows = await tx.$queryRaw<{ hiddenAt: Date | null; productId: string }[]>`
      SELECT "hiddenAt", "productId" FROM "Review" WHERE "id" = ${reviewId} FOR NO KEY UPDATE`;
    const current = rows[0];
    if (current === undefined) return { kind: "not-found" } as const;
    if (reviewVisibilityOf(current.hiddenAt) !== move.from) {
      return { kind: "invalid-state" } as const;
    }
    const count =
      move.to === "HIDDEN"
        ? await tx.$executeRaw`
            UPDATE "Review"
               SET "hiddenAt" = now(), "hiddenByUserId" = ${adminId},
                   "hiddenReason" = ${reason}, "updatedAt" = now()
             WHERE "id" = ${reviewId} AND "hiddenAt" IS NULL`
        : await tx.$executeRaw`
            UPDATE "Review"
               SET "hiddenAt" = NULL, "hiddenByUserId" = NULL, "hiddenReason" = NULL,
                   "updatedAt" = now()
             WHERE "id" = ${reviewId} AND "hiddenAt" IS NOT NULL`;
    if (count !== 1) return { kind: "invalid-state" } as const;
    await writeAudit(tx, {
      actorId: adminId,
      action: move.to === "HIDDEN" ? AUDIT_ACTIONS.reviewHidden : AUDIT_ACTIONS.reviewUnhidden,
      targetType: AUDIT_TARGETS.review,
      targetId: reviewId,
      metadata: {
        reason,
        productId: current.productId,
        before: { visibility: move.from },
        after: { visibility: move.to },
      },
    });
    const row = await tx.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: REVIEW_SCALAR_SELECT,
    });
    const [hydrated] = await hydrateReviews(tx, [row]);
    if (hydrated === undefined) throw new Error("admin: a review read back is missing.");
    return { kind: "done", row: hydrated } as const;
  }, ADMIN_TRANSACTION_OPTIONS);
}
