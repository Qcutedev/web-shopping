/**
 * Store name rules of SEC-058 as the owner ruled them in D-041 (docs/DECISIONS.md):
 *
 *   - point 1, unique names: two stores may not have names with the same key. The key is
 *     `Store.nameKey`, a generated column computed by the database function `store_name_key`
 *     (NFKC, full case folding, default-ignorables removed, white space collapsed and trimmed;
 *     DATA_MODEL.md section 21.7) with the unique index `Store_nameKey_key`. There is deliberately
 *     no copy of the normalisation in TypeScript: every comparison goes through the function.
 *   - point 3, reserved names, widened by D-042 point 1 (SEC-059): a name is refused when its key,
 *     with punctuation and symbols removed (`reservedMatchText`), CONTAINS the same text of an
 *     entry of `RESERVED_STORE_NAMES` anywhere, not only when it equals it. So `Admin.`,
 *     `<site name> Official`, `Official Support`, `A.d.m.i.n`, and `ร้านแอดมินขายดี` are all
 *     refused (`containsReservedName`).
 *
 * Contains-match, not word match. Thai is written without spaces between words, so a word rule
 * cannot find `แอดมิน` inside `ร้านแอดมินขายดี`; and a Latin word rule would let `ShopAdmin` through.
 * The accepted cost (D-042 point 1) is false positives: any name that contains a reserved entry as
 * a plain substring is refused, also where no reader sees that word. Examples refused today:
 * `Badminton Pro` (contains `admin`), `Unofficial Fan Shop`, `Supportive Care`, and Thai names
 * that contain `ทางการ` across a word boundary, such as `ผลผลิตทางการเกษตร` (agricultural produce) or
 * `อุปกรณ์ทางการแพทย์` (medical equipment). The owner trims the list to change this; nothing else
 * needs to change. The applicant sees `409 STORE_NAME_RESERVED` and picks another name.
 *
 * White space is kept for the comparison (only punctuation and symbols are removed), so a
 * one-word entry is not matched across a space (`Pad Mint` is accepted; `Pad.Mint` is not). An
 * entry that holds a space itself is compared with all spaces removed on both sides, so a
 * punctuation mark in place of that space does not slip past it.
 *
 * Nothing here logs. `error.meta` of a violation holds the name in its `DETAIL` and is never read
 * beyond the constraint name and the PostgreSQL code (DATA_MODEL.md section 21.5; SR-04).
 */
import { th } from "@/i18n/th";

import { isUniqueIndexViolation } from "./unique-index";

/**
 * Text a store name may not contain, compared by key (so `ADMIN`, `Ａｄｍｉｎ`, and ` admin ` are all
 * `admin`) and then by `containsReservedName` (SEC-059, D-042 point 1: contained anywhere, after
 * punctuation and symbols are removed). The marketplace's own name is read from its single
 * definition (REQ-N-12), so this list follows a change of that name. The owner may extend or trim
 * the list (D-041 point 3, D-042 point 1); an entry needs no particular case or spacing. Every
 * entry also refuses every longer name that contains it, so a short or common entry refuses many
 * ordinary names (see the file comment).
 */
export const RESERVED_STORE_NAMES: readonly string[] = Object.freeze([
  th.site.name,
  "admin",
  "administrator",
  "official",
  "support",
  "ผู้ดูแลระบบ",
  "แอดมิน",
  "ทางการ",
  "ร้านค้าทางการ",
]);

/**
 * Punctuation and symbols (`\p{P}`, `\p{S}`), removed before the reserved comparison. Combining
 * marks are kept: Thai vowels and tone marks are part of the word. Escapes only (SEC-040).
 */
const RESERVED_MATCH_REMOVED = /[\p{P}\p{S}]/gu;

/**
 * The text the reserved comparison uses, from a key that `store_name_key` computed (DATA_MODEL.md
 * section 21.7): punctuation and symbols removed, then runs of spaces collapsed and the ends
 * trimmed again. Not a copy of the key's normalisation; it only takes characters away from the
 * database's result. Pure.
 */
export function reservedMatchText(key: string): string {
  return key.replace(RESERVED_MATCH_REMOVED, "").replace(/ +/g, " ").trim();
}

/**
 * True when the name whose key is `nameKey` contains one of the reserved entries whose keys are
 * `reservedKeys` (both computed by `store_name_key`), after `reservedMatchText` on both sides.
 * An entry left empty by the removal (an entry of punctuation only) matches nothing, so a list
 * mistake cannot refuse every name. An entry with a space is compared with spaces removed on
 * both sides. Pure; SEC-059, D-042 point 1.
 */
export function containsReservedName(nameKey: string, reservedKeys: readonly string[]): boolean {
  const text = reservedMatchText(nameKey);
  const compact = text.replace(/ /g, "");
  return reservedKeys.some((key) => {
    const entry = reservedMatchText(key);
    if (entry === "") return false;
    return entry.includes(" ") ? compact.includes(entry.replace(/ /g, "")) : text.includes(entry);
  });
}

/** The unique index on the generated `Store.nameKey` (migration `20261015090000_store_name_key`). */
export const STORE_NAME_KEY_INDEX = "Store_nameKey_key";

/**
 * True when `error` is the unique index `Store_nameKey_key` refusing a write through the model API
 * (`P2002`, `meta.driverAdapterError.cause.constraint.index` and `cause.originalCode` `23505`;
 * DATA_MODEL.md section 21.5). Any other unique violation (slug, owner, logo) is false, so it keeps
 * its own handling. Reads only those two labels of `meta` (`isUniqueIndexViolation`).
 */
export function isStoreNameKeyViolation(error: unknown): boolean {
  return isUniqueIndexViolation(error, STORE_NAME_KEY_INDEX);
}
