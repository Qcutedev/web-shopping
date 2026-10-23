/**
 * The admin's moderation decisions (REQUIREMENTS.md "Product moderation", BR-17, BR-19, BR-36;
 * DATA_MODEL.md sections 4.2 and 7.6; docs/API_CONTRACTS.md sections 3.3 and 5.9.3; D-028). The
 * one place where they are defined: the guarded statement of each decision takes its conditions
 * from this table, and anything not listed is refused with `409 INVALID_STATE_TRANSITION`.
 *
 *   approve    PENDING and PUBLISHED  to  APPROVED     (clears the note)
 *   reject     PENDING and PUBLISHED  to  REJECTED     (reason required)
 *   takedown   APPROVED, any status   to  TAKEN_DOWN   (reason required)
 *
 * Approve and reject apply only to a product in the approval queue: published and awaiting
 * approval (BR-36). Takedown has no condition on the seller's status. No setting turns approval
 * off (BR-17). The seller's moves of `moderationStatus` (back to `PENDING`) are in
 * src/modules/inventory/state.ts; the store moves are in src/modules/sellers/state.ts; the
 * fulfilment moves are in src/modules/orders/state.ts.
 *
 * Which refusal comes first when the revision and the state both differ (item 8.2-6): the
 * revision, so `409 CONFLICT STALE_REVISION`. The admin's screen is out of date either way; the
 * answer that says "reload" is the useful one. Settled in T-050.
 *
 * Pure: no database and no framework import.
 */
import type { ModerationStatusValue, ProductStatusValue } from "@/modules/inventory";

export const MODERATION_DECISIONS = ["approve", "reject", "takedown"] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

export interface ModerationDecisionRule {
  readonly decision: ModerationDecision;
  readonly from: ModerationStatusValue;
  /** The seller's status the product must have; null when any status will do. */
  readonly requiresStatus: ProductStatusValue | null;
  readonly to: ModerationStatusValue;
  readonly reasonRequired: boolean;
}

export const MODERATION_DECISION_RULES: readonly ModerationDecisionRule[] = Object.freeze([
  {
    decision: "approve",
    from: "PENDING",
    requiresStatus: "PUBLISHED",
    to: "APPROVED",
    reasonRequired: false,
  },
  {
    decision: "reject",
    from: "PENDING",
    requiresStatus: "PUBLISHED",
    to: "REJECTED",
    reasonRequired: true,
  },
  {
    decision: "takedown",
    from: "APPROVED",
    requiresStatus: null,
    to: "TAKEN_DOWN",
    reasonRequired: true,
  },
]);

export function moderationRule(decision: ModerationDecision): ModerationDecisionRule {
  const rule = MODERATION_DECISION_RULES.find((row) => row.decision === decision);
  if (rule === undefined) throw new Error(`admin: no rule for the decision ${decision}.`);
  return rule;
}

export interface ModerationState {
  readonly status: ProductStatusValue;
  readonly moderationStatus: ModerationStatusValue;
  readonly contentRevision: number;
}

export type ModerationJudgement = "ok" | "stale-revision" | "invalid-state";

/**
 * What a decision meets on the product as it stands: the revision first (item 8.2-6), then the
 * table. Pure.
 */
export function judgeModerationDecision(
  decision: ModerationDecision,
  current: ModerationState,
  seenRevision: number,
): ModerationJudgement {
  if (current.contentRevision !== seenRevision) return "stale-revision";
  const rule = moderationRule(decision);
  if (current.moderationStatus !== rule.from) return "invalid-state";
  if (rule.requiresStatus !== null && current.status !== rule.requiresStatus) {
    return "invalid-state";
  }
  return "ok";
}

/**
 * The active-flag table of a user (DATA_MODEL.md section 4.5). The repository's lock check and
 * guarded update of `deactivateUser` and `reactivateUser` take their values from here.
 */
export const USER_ACTIVATION_TRANSITIONS = Object.freeze([
  { action: "deactivate", from: true, to: false },
  { action: "reactivate", from: false, to: true },
] as const);
export type UserActivationAction = (typeof USER_ACTIVATION_TRANSITIONS)[number]["action"];

/** The `isActive` value the action starts from and the one it leaves. */
export function activationMove(action: UserActivationAction): { from: boolean; to: boolean } {
  const row = USER_ACTIVATION_TRANSITIONS.find((entry) => entry.action === action);
  if (row === undefined) throw new Error(`admin: no activation row for ${action}.`);
  return { from: row.from, to: row.to };
}
