/**
 * Seller application and store service (docs/API_CONTRACTS.md sections 5.7.1 and 5.9.2;
 * REQ-S-01, REQ-S-02, REQ-S-09, REQ-A-03, BR-06, BR-14).
 *
 * Every function takes the acting user as `actor` (CLAUDE.md rule 2) and checks the role itself;
 * the route handlers' guards are refusals made sooner, never the control. Ownership is the other
 * control: the applicant's rows are read by `actor.userId`, the store by `actor.storeId` **and**
 * `actor.userId` together, both from the session (CLAUDE.md rule 6). Nothing of a request names a
 * user or a store.
 *
 *   function                 access (section 1.8)          role check here
 *   submitApplication        customer-role                 CUSTOMER, owns no store (BR-06)
 *   getOwnApplication        user                          any role, own rows only
 *   getOwnStore              seller (any store status)     SELLER
 *   updateOwnStore           seller                        SELLER with an APPROVED store, and
 *                                                          the write carries the condition (7.7)
 *   approveApplication       admin (T-050 exposes it)      ADMIN
 *   rejectApplication        admin (T-050 exposes it)      ADMIN
 *   requireApprovedStoreForWrite   helper for later seller writes (T-041, T-042)
 *   requireApprovedStoreForStoreRowWrite   the same for a write of the Store row (CR-T040-06)
 */
import { imageRef } from "@/modules/catalog/image";
import { type Actor, requireApprovedSeller, requireRole } from "@/server/auth/actor";
import type { DbTransaction } from "@/server/db";
import { forbidden, invalidStateTransition, unauthenticated } from "@/server/errors";

import {
  applicantInactive,
  applicantNotCustomer,
  applicationNotFound,
  openApplication,
  storeNameReserved,
  storeNameTaken,
  storeNotApproved,
  storeNotFound,
  uploadNotFound,
} from "./errors";
import {
  type ApplicationRow,
  approveApplicationRow,
  type DecisionOutcome,
  type DecisionRow,
  findLatestApplication,
  findOwnStore,
  insertApplication,
  lockStoreForRowWriteIfApproved,
  lockStoreIfApproved,
  rejectApplicationRow,
  type StoreRow,
  type StoreUpdate,
  updateOwnStore as writeOwnStore,
} from "./repository";
import type {
  ApplicationDecisionDto,
  RejectApplicationBody,
  SellerApplicationDto,
  SellerStoreDto,
  SubmitApplicationBody,
  UpdateStoreBody,
} from "./schema";
import { generateSlug } from "./slug";

// ---------------------------------------------------------------------------------------------
// Mapping from rows to response shapes (pure; unit-tested)
// ---------------------------------------------------------------------------------------------

export function toApplicationDto(row: ApplicationRow): SellerApplicationDto {
  return {
    id: row.id,
    storeName: row.storeName,
    description: row.description,
    contactPhone: row.contactPhone,
    status: row.status,
    reviewNote: row.status === "REJECTED" ? row.reviewNote : null,
    reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toStoreDto(row: StoreRow): SellerStoreDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logo: row.logoKey === null ? null : imageRef(row.logoKey),
    contactPhone: row.contactPhone,
    status: row.status,
    statusReason: row.statusReason,
    isSample: row.isSample,
  };
}

export function toDecisionDto(row: DecisionRow): ApplicationDecisionDto {
  return {
    application: {
      id: row.application.id,
      userId: row.application.userId,
      status: row.application.status,
      reviewNote: row.application.reviewNote,
      reviewedAt: row.application.reviewedAt.toISOString(),
    },
    store: row.store,
  };
}

// ---------------------------------------------------------------------------------------------
// The applicant
// ---------------------------------------------------------------------------------------------

/**
 * POST /seller/application (REQ-S-01). Only a `CUSTOMER` who owns no store: a `SELLER` already
 * owns one and an `ADMIN` cannot become a seller, both 403 FORBIDDEN (BR-06; section 5.7.1). The
 * repository repeats both checks under the user row's lock, so a role that changed after the
 * session was read is still refused. A second application while one is `PENDING` is
 * 409 OPEN_APPLICATION and creates nothing; a rejected applicant may apply again. A store name
 * that is reserved is 409 STORE_NAME_RESERVED, one whose key an existing store has is
 * 409 STORE_NAME_TAKEN; both create nothing (SEC-058, D-041).
 */
export async function submitApplication(
  actor: Actor,
  input: SubmitApplicationBody,
): Promise<SellerApplicationDto> {
  requireRole(actor, "CUSTOMER");
  if (actor.storeId !== null) throw forbidden(); // BR-06; the data model gives a customer no store
  const outcome = await insertApplication(actor.userId, {
    storeName: input.storeName,
    description: input.description,
    contactPhone: input.contactPhone,
  });
  switch (outcome.kind) {
    case "created":
      return toApplicationDto(outcome.row);
    case "user-gone":
      throw unauthenticated();
    case "not-customer":
      // The role changed after the session was read (an approval in between): as at the guard.
      throw forbidden();
    case "open-application":
      throw openApplication(outcome.cause);
    case "store-name-reserved":
      throw storeNameReserved();
    case "store-name-taken":
      throw storeNameTaken();
  }
}

/**
 * GET /seller/application: the caller's latest application, of any role (a seller sees the
 * approved one). None: 404. The rejection reason is shown only on a rejected application.
 */
export async function getOwnApplication(actor: Actor): Promise<SellerApplicationDto> {
  const row = await findLatestApplication(actor.userId);
  if (row === null) throw applicationNotFound();
  return toApplicationDto(row);
}

// ---------------------------------------------------------------------------------------------
// The seller's own store
// ---------------------------------------------------------------------------------------------

/**
 * GET /seller/store (REQ-S-02, BR-14): role `SELLER`, whatever the store's status; a suspended
 * store's seller reads the settings and the suspension reason. A seller without a store (which
 * the data model does not allow) is 404.
 */
export async function getOwnStore(actor: Actor): Promise<SellerStoreDto> {
  requireRole(actor, "SELLER");
  if (actor.storeId === null) throw storeNotFound();
  const row = await findOwnStore(actor.storeId, actor.userId);
  if (row === null) throw storeNotFound();
  return toStoreDto(row);
}

/**
 * PATCH /seller/store (REQ-S-02, REQ-S-09, BR-14, D-028, D-033 point 3). Role `SELLER` with an
 * `APPROVED` store, judged here from the session's actor and again by the transaction under the
 * store row's lock; a suspended store is 403 SELLER_NOT_APPROVED and nothing changes. A change of
 * contact phone needs no approval. A rename keeps the slug. `logoKey` must be an upload of the
 * caller's own store, else 404 with `details.resource` `"upload"`. A new name that is reserved is
 * 409 STORE_NAME_RESERVED, one whose key another store has is 409 STORE_NAME_TAKEN, and nothing
 * changes; a rename writes an audit row with the seller as actor (SEC-058, D-041).
 */
export async function updateOwnStore(
  actor: Actor,
  input: UpdateStoreBody,
): Promise<SellerStoreDto> {
  const { storeId } = requireApprovedSeller(actor);
  const update: StoreUpdate = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.contactPhone !== undefined) update.contactPhone = input.contactPhone;
  if (input.logoKey !== undefined) update.logoKey = input.logoKey;
  const outcome = await writeOwnStore(storeId, actor.userId, update);
  switch (outcome.kind) {
    case "updated":
      return toStoreDto(outcome.row);
    case "not-found":
      throw storeNotFound();
    case "not-approved":
      throw storeNotApproved();
    case "upload-not-found":
      throw uploadNotFound();
    case "store-name-reserved":
      throw storeNameReserved();
    case "store-name-taken":
      throw storeNameTaken();
  }
}

/**
 * For the seller writes of later tasks (T-041, T-042), as the first statement of their
 * transaction: step 8 of section 1.8. Refuses a caller who is not a seller with an approved store
 * (403, from the session's actor), then share-locks the store row while it is still `APPROVED`
 * and owned by the actor, so a suspension cannot commit before the caller's write does
 * (DATA_MODEL.md section 7.7). Returns the store id to scope the write by.
 *
 * Deadlock warning (CR-T040-04): the lock is `FOR SHARE`. The caller must not update or delete
 * the `Store` row itself later in the same transaction. Two such transactions on one store would
 * each hold the share lock and wait for the other to release it before the update; PostgreSQL
 * then aborts one of them with a deadlock error (a 500). Writes to other tables that only
 * reference the store (products, uploads, stock) are safe. A write that must change the store row
 * calls `requireApprovedStoreForStoreRowWrite` below instead (CR-T040-06), which makes the same
 * check under a lock the later update does not have to upgrade.
 */
export async function requireApprovedStoreForWrite(
  tx: DbTransaction,
  actor: Actor,
): Promise<{ storeId: string }> {
  const { storeId } = requireApprovedSeller(actor);
  if (!(await lockStoreIfApproved(tx, storeId, actor.userId))) throw storeNotApproved();
  return { storeId };
}

/**
 * The variant of `requireApprovedStoreForWrite` for a seller write that updates the `Store` row
 * itself later in the same transaction (CR-T040-06), as the first statement of that transaction:
 * the same refusals (403 FORBIDDEN for a caller who is not a `SELLER`, 403 SELLER_NOT_APPROVED
 * unless the store is `APPROVED`, judged from the session's actor and again under the lock), but
 * the store row is locked `FOR NO KEY UPDATE`, or `FOR UPDATE` when `changesUniqueKey` is set
 * (the update changes `name`, and so the unique `nameKey`). Two such writers on one store queue
 * one behind the other instead of deadlocking, and a suspension waits until the caller ends.
 * Returns the store id to scope the write by.
 *
 * `updateOwnStore` predates this helper and takes the same two locks itself (`lockOwnStore`),
 * because it also reads the current name under the lock.
 */
export async function requireApprovedStoreForStoreRowWrite(
  tx: DbTransaction,
  actor: Actor,
  options: { changesUniqueKey: boolean },
): Promise<{ storeId: string }> {
  const { storeId } = requireApprovedSeller(actor);
  const lock = options.changesUniqueKey ? "FOR UPDATE" : "FOR NO KEY UPDATE";
  if (!(await lockStoreForRowWriteIfApproved(tx, storeId, actor.userId, lock))) {
    throw storeNotApproved();
  }
  return { storeId };
}

// ---------------------------------------------------------------------------------------------
// Admin decisions (REQ-A-03; T-050 exposes them as POST /admin/applications/{id}/approve and
// /reject, after requireActor and requireRole(actor, "ADMIN"))
// ---------------------------------------------------------------------------------------------

function decided(outcome: DecisionOutcome): ApplicationDecisionDto {
  switch (outcome.kind) {
    case "decided":
      return toDecisionDto(outcome.row);
    case "not-found":
      throw applicationNotFound();
    case "not-pending":
      throw invalidStateTransition();
    case "applicant-not-customer":
      throw applicantNotCustomer();
    case "applicant-inactive":
      throw applicantInactive();
    case "store-name-reserved":
      throw storeNameReserved();
    case "store-name-taken":
      throw storeNameTaken();
  }
}

/**
 * Approves a `PENDING` application: in one transaction the application becomes `APPROVED`, the
 * store is created with status `APPROVED` and a generated slug, the applicant's role becomes
 * `SELLER`, and an audit row is written. Not `PENDING`: 409 INVALID_STATE_TRANSITION. Applicant
 * no longer a `CUSTOMER`: 409 APPLICANT_NOT_CUSTOMER, nothing changes. Applicant deactivated
 * (`isActive = false`): 409 APPLICANT_INACTIVE, nothing changes and the application stays
 * `PENDING` so an admin can reject it (D-040 point 1). A store name that is reserved, or whose key
 * another store has by now: 409 STORE_NAME_RESERVED or STORE_NAME_TAKEN, nothing changes and the
 * application stays `PENDING` (SEC-058, D-041). Unknown id: 404.
 */
export async function approveApplication(
  actor: Actor,
  applicationId: string,
): Promise<ApplicationDecisionDto> {
  requireRole(actor, "ADMIN");
  return decided(await approveApplicationRow(applicationId, actor.userId, (n) => generateSlug(n)));
}

/**
 * Rejects a `PENDING` application with a reason (required; the schema refuses a blank one). No
 * store is created and the role stays `CUSTOMER`; the applicant may apply again. An audit row with
 * the reason is written in the same transaction. Not `PENDING`: 409; unknown id: 404.
 */
export async function rejectApplication(
  actor: Actor,
  applicationId: string,
  input: RejectApplicationBody,
): Promise<ApplicationDecisionDto> {
  requireRole(actor, "ADMIN");
  return decided(await rejectApplicationRow(applicationId, actor.userId, input.reason));
}
