/**
 * The seller application and store state machines (REQUIREMENTS.md "Seller application and store
 * status"; DATA_MODEL.md section 4.1; docs/API_CONTRACTS.md section 3; D-024). The one place where
 * these transitions are defined: every guarded status statement of this module takes its allowed
 * source states from these tables, and anything not listed is refused with
 * `409 INVALID_STATE_TRANSITION`.
 *
 * A new application starts `PENDING` (the insert's database default). `APPROVED` and `REJECTED`
 * are final for that application: a rejected applicant applies again with a new row. A store row
 * exists only after approval, so a store is never pending or rejected; it moves between
 * `APPROVED` and `SUSPENDED`, each move by an admin with a reason (T-050 builds those two).
 *
 * Pure: no database and no framework import.
 */
import { invalidStateTransition } from "@/server/errors";

export const APPLICATION_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ApplicationStatusValue = (typeof APPLICATION_STATUSES)[number];

export const STORE_STATUSES = ["APPROVED", "SUSPENDED"] as const;
export type StoreStatusValue = (typeof STORE_STATUSES)[number];

export interface ApplicationTransition {
  readonly from: ApplicationStatusValue;
  readonly to: ApplicationStatusValue;
  /** Whether the move needs a reason from the admin (stored as `reviewNote`). */
  readonly reasonRequired: boolean;
}

/** Both moves are the admin's (REQ-A-03). */
export const APPLICATION_TRANSITIONS: readonly ApplicationTransition[] = Object.freeze([
  { from: "PENDING", to: "APPROVED", reasonRequired: false },
  { from: "PENDING", to: "REJECTED", reasonRequired: true },
]);

export interface StoreTransition {
  readonly from: StoreStatusValue;
  readonly to: StoreStatusValue;
}

/** Both moves are the admin's, each with a reason (REQ-A-04, BR-14). */
export const STORE_TRANSITIONS: readonly StoreTransition[] = Object.freeze([
  { from: "APPROVED", to: "SUSPENDED" },
  { from: "SUSPENDED", to: "APPROVED" },
]);

export function isApplicationTransitionAllowed(
  from: ApplicationStatusValue,
  to: ApplicationStatusValue,
): boolean {
  return APPLICATION_TRANSITIONS.some((row) => row.from === from && row.to === to);
}

/** The states an application may move to `to` from. Empty when none. */
export function applicationSourceStates(to: ApplicationStatusValue): ApplicationStatusValue[] {
  return APPLICATION_TRANSITIONS.filter((row) => row.to === to).map((row) => row.from);
}

/** 409 INVALID_STATE_TRANSITION unless the table allows the move. */
export function assertApplicationTransition(
  from: ApplicationStatusValue,
  to: ApplicationStatusValue,
): void {
  if (!isApplicationTransitionAllowed(from, to)) throw invalidStateTransition();
}

export function isStoreTransitionAllowed(from: StoreStatusValue, to: StoreStatusValue): boolean {
  return STORE_TRANSITIONS.some((row) => row.from === from && row.to === to);
}

/** 409 INVALID_STATE_TRANSITION unless the table allows the move. */
export function assertStoreTransition(from: StoreStatusValue, to: StoreStatusValue): void {
  if (!isStoreTransitionAllowed(from, to)) throw invalidStateTransition();
}
