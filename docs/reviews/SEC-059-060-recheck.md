# SEC-059 and SEC-060 re-check after D-042

Reviewer: security agent. Date: 2026-10-19. Commits re-checked: `c09207a` (backend-api: `containsReservedName`, `reservedMatchText`, `checkStoreName`, `NAME_ALLOWED_TEXT`), `e0fddea` (backend-api: integration and security test updates), `2324ee9` (contract wording). Tree at review: `2324ee9`. Ruling: [D-042](../DECISIONS.md). Register: [../SECURITY.md](../SECURITY.md).

Result: **SEC-059 FIXED** and **SEC-060 FIXED** for the forms the findings named and for the forms D-042 lists. Three new Low findings bypass the same rules: **SEC-061** (a variation selector between two sara e), **SEC-062** (a narrow space inside a word), and **SEC-063** (Thai look-alike letters). Each needs an owner decision. No Critical, High, or Medium finding.

A clean scanner run shows only that the scanner found nothing. Passing tests show only that the tested attacks fail. Neither shows that store names cannot be imitated.

## Scope

- `src/modules/sellers/store-name.ts` (`RESERVED_STORE_NAMES`, `reservedMatchText`, `containsReservedName`), `src/modules/sellers/repository.ts` (`checkStoreName`), `src/modules/sellers/errors.ts`
- `src/modules/auth/schema.ts` (`NAME_FORBIDDEN_CHAR`, `NAME_REPEATED_MARK`, `NAME_DOUBLED_SARA_E`, `NAME_ALLOWED_TEXT`), `src/modules/sellers/schema.ts` (store name and description use the same rule)
- `prisma/migrations/20261015090000_store_name_key/migration.sql` (read only: what the key removes and collapses)
- Test edits by backend-api in `tests/security/t040-sellers.itest.ts` and `tests/security/sec041-042-cr57-recheck.test.ts`
- Not read: `tests/integration/sellers/store-names.test.ts` beyond the diff (qa's file)

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| SEC-059 flipped case | `it.fails` changed to `it`, body unchanged. Passes: `<site name> Official` is `409`. | `t040-sellers.itest.ts` "SEC-059 the reserved-name rule ..." |
| SEC-060 flipped case | `it.fails` changed to `it`. Expected status changed from 409 to 400: D-042 point 2 refuses the copies at validation, not at the key. No other change. Passes. | `t040-sellers.itest.ts` "SEC-060 visually identical ..." |
| Contained match | Holds for 18 forms on rename and application: trailing and inner punctuation, `_`, symbols, joined words, full width, U+200B, U+FE0F, U+200D inside a word, Thai entries inside Thai names, the site name with a suffix, prefix, or full stop inside. Database unchanged. | New case "SEC-059 re-check ... 409 STORE_NAME_RESERVED on rename and application" |
| Name-rule refusals | Hold for 13 forms on rename and application: doubled sara e directly and with U+200B, U+200C, U+200D, or all three between; mai ek twice adjacent, across sara u in either order, across U+200B, across U+FE0F; U+2800 and U+1D159 in place of a space or at the start. All `400 VALIDATION_ERROR`. Database unchanged. | New case "SEC-060 re-check ... 400 on rename and application" |
| Regressions | Ordinary Thai names with up to three distinct marks still pass. A one-word entry split by an ordinary space is accepted (by design). | New cases |
| Bypasses | Three found; see Findings. | `it.fails` cases, flipped in a scratch copy |
| Backend-api's test edits | Intent kept (next section). | Diff read; cases run |
| Wider than D-042 | Recorded (next section). | Code read; documented cases |

### Backend-api's edits to cases that were not `it.fails`

- `sec041-042-cr57-recheck.test.ts`, run-limit table: the Mc, Me, and outside-BMP rows used one mark four times. They now use four distinct marks of the same kind. Checked with Node 24.20.0 `\p{gc=..}`: U+0903, U+093E, U+093F, U+0940 are Mc; U+20DD to U+20E0 and U+20E2 to U+20E4 are Me; U+1D167 to U+1D169 and U+1D17B are Mn. So each row still tests the run limit, and it tests it more cleanly: a repeated mark would now be refused by the repeat rule alone. Intent kept.
- Same file, random oracle: expected result is now "run at most 3 **and** no mark repeated within a run". This matches the new rule. The gap in `NAME_REPEATED_MARK` is bounded by 3, which is equivalent because a longer run is refused anyway. The refusal share still lies between 300 and 2,700 of 3,000. Intent kept.
- Same file, "a run at the start of the name counts too": still uses one mark four times, which is now refused for two reasons. The reviewer added the same case with four distinct marks (refused) and three distinct marks (accepted). This isolates the run limit again. No assertion removed.
- `t040-sellers.test.ts` probe list (reviewer's own file): its comment "three combining marks: at the limit" was wrong after D-042 (U+0301 three times is now refused). The comment is corrected. Probes added for three and four distinct marks, doubled sara e, sara e + U+FE0F + sara e, and U+2800. The probes compare the store-name schema with the user-name rule; nothing removed.
- `t040-sellers.itest.ts`, SEC-058 cases: `Official Shop` became `Famous Shop`. Since D-042, `Official Shop` is `STORE_NAME_RESERVED`, which would hide the `STORE_NAME_TAKEN` path these cases test. The new name contains no reserved entry. The TAKEN cases still assert `409 STORE_NAME_TAKEN` for the ten renames to the other store's name, and 200 plus one audit row for the others. Intent kept.
- Same file, the SEC-059 and SEC-060 "documented behaviour" cases: they now assert the fixed answers (`409 STORE_NAME_RESERVED`, `400 VALIDATION_ERROR`) and an unchanged database. They are stronger than before.

### The implementation is wider than D-042 says (not findings; for the owner)

1. **Any repeated combining mark.** D-042 point 2 names "a repeated tone mark". `NAME_REPEATED_MARK` refuses any `\p{M}` twice within one run, adjacent or not, in every script. Examples: Latin `e` + U+0301 twice, `A` + U+20DD twice, U+FE0F twice. This applies to every field that uses `NAME_ALLOWED_TEXT`: sign-up name, profile name, address fields, and store name and description lines. The source comment says no word needs one mark twice on one base; the reviewer agrees for Thai and found no counter-example, but did not survey other scripts. Documented case: "documented behaviour (wider than D-042 point 2 ...)".
2. **Contained match on any entry.** D-042 point 1 accepts false positives. They are real and common. `Badminton Pro` (contains `admin`), `Unofficial Fan Shop`, and Thai names that contain `ทางการ` across a word boundary are all `409 STORE_NAME_RESERVED`. Examples: `ผลผลิตทางการเกษตร` (agricultural produce) and `อุปกรณ์ทางการแพทย์` (medical equipment). `ทางการ` appears inside many ordinary Thai compounds (`ทางการเกษตร`, `ทางการแพทย์`, `ทางการค้า`), so this entry will refuse ordinary agricultural, medical, and trading shops. Only the owner can trim the list. Documented case: "documented behaviour (D-042 point 1, accepted side effect) ...".

## Findings

- **SEC-059** FIXED (re-checked 2026-10-19).
- **SEC-060** FIXED (re-checked 2026-10-19) for the three forms of the finding and for every form D-042 point 2 names. Two of those forms are bypassed by SEC-061; see that finding.
- **SEC-061** (Low, OPEN): `NAME_DOUBLED_SARA_E` allows only U+200B to U+200D between the two sara e. U+FE0E and U+FE0F are allowed after any letter (SEC-041), and `store_name_key` removes them. So sara e + U+FE0F + sara e passes the name rule and gets the key of the doubled sara e. Renderers draw a variation selector that starts no sequence as nothing. The result reads like sara ae. It copies any Thai store name that contains sara ae, and it defeats the reserved match for `แอดมิน` and for the current site name (`ชื่อแบรนด์`). Reproduction: describe "SEC-061"; the flipped `it.fails` answers 200 for all three copies.
- **SEC-062** (Low, OPEN): the key turns every White_Space run into one U+0020 (migration line 39). The reserved match keeps spaces for a one-word entry. So a hair space U+200A, thin space U+2009, or narrow no-break space U+202F inside a word gives `ad min`. That key neither contains `admin` nor equals the key of `Famous`. These spaces are about one sixth of an em wide or narrower, and Thai is written without spaces between words. So `Ad<U+200A>min`, `<site name>` with a hair space inside, and `Fam<U+200A>ous 062` read as the original. Reproduction: describe "SEC-062"; the flipped `it.fails` answers 200 for all five.
- **SEC-063** (Low, OPEN): three Thai letter pairs that NFKC keeps apart: lakkhangyao U+0E45 for sara aa U+0E32, kho khuat U+0E03 for kho khai U+0E02, kho khon U+0E05 for kho khwai U+0E04. `ทๅงกๅร` is not reserved, and `ขๅยค้ๅ`, `ฃายค้า`, and `ขายฅ้า` are new keys beside `ขายค้า`. In common Thai fonts the members of each pair differ only in a small detail: the lakkhangyao's tail below the line, or the notch or zigzag at the top of kho khuat and kho khon. They are not identical. That is why this is a separate decision from SEC-060. D-041 accepted look-alike letters of other scripts only. Reproduction: describe "SEC-063"; the flipped `it.fails` answers 200 for all four.

### Tried and not a finding

- Zero-width U+200B to U+200D, U+FE0E or U+FE0F inside a reserved word: the key removes them. Refused.
- Full width, case, and NBSP or U+3000 around a word: refused (covered by the key, SEC-058 re-check).
- Repeated mark across U+200B, U+FE0F, or another mark: refused (`NAME_REPEATED_MARK` counts U+FE0E and U+FE0F as marks).
- U+2800 and U+1D159: refused. Other blank-drawn code points (Hangul fillers, U+034F, U+115F, U+3164, U+FFA0) were already refused. Other `So` characters checked (U+FFFC, U+2B7F, U+1D15A) draw a visible glyph.

### Observations (not registered)

1. U+16FE4 (Khitan small script filler) is `Mn` and not default-ignorable, so it passes the name rule and is kept by the key. `Ad<U+16FE4>min` is accepted. Whether it draws as nothing depends on the font: without a Khitan font, browsers usually draw a box or a dotted circle. Not shown to be invisible; not registered. A browser check would settle it.
2. Canonically equivalent repeated marks escape `NAME_REPEATED_MARK`, which compares code points before normalisation. Examples: `e` + U+0301 + U+0341 (U+0341 normalises to U+0301), and precomposed `é` + U+0301. Latin fonts usually stack a second acute above the first, so the copy is visible. Not registered. A rule on the NFC form would close it.
3. Confusables within Latin (`rn` for `m`, `0` for `O`, `1` or `I` for `l`, `í` for `i`) and the Turkish dotted capital I (case-folds to `i` + U+0307) defeat the reserved match. The same class was left open for keys in the SEC-058 re-check (punctuation, `0`/`O`, `rn`/`m`), and D-041 accepted other scripts' look-alikes (Cyrillic, Greek). Recorded under residual risks.

## Tests added or changed

`tests/security/t040-sellers.itest.ts`:
- SEC-059 `it.fails` to `it`, body unchanged.
- SEC-060 `it.fails` to `it`, expected status 409 to 400, with a comment giving the reason.
- New describes: "SEC-059 re-check" (4 plain cases), "SEC-060 re-check" (3 plain), "SEC-061" (1 plain, 1 `it.fails`), "SEC-062" (1 plain, 1 `it.fails`), "SEC-063" (1 plain, 1 `it.fails`). A helper `accepted` returns every name whose answer is not one of the given refusals.
- Header comment updated.

`tests/security/sec041-042-cr57-recheck.test.ts`: two assertions added (distinct marks at the start of a name).

`tests/security/t040-sellers.test.ts`: one comment corrected, five probes added.

No case deleted or weakened. All three files are printable ASCII without backslash-u escapes (SEC-040). Checked by a byte scan: 0 bytes outside 0x20 to 0x7E other than tab, CR, and LF, and 0 occurrences of a backslash followed by `u`.

## Commands run

- `node <scratch>\probe.mjs` (Node 24.20.0; a copy of the `NAME_ALLOWED_TEXT` source with NFKC output) -> it listed the candidates above; the FE0F-between-sara-e, narrow-space, U+0E45, and U+16FE4 forms pass the rule
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t040-sellers.itest.ts` -> first run: 1 failed (the reviewer's own case took a snapshot before signing in an applicant, which created a user row; fixed by signing in first). Final: exit 0, 34 passed, 3 expected fail
- Scratch copy `tests/security/zz-sec061-flip.itest.ts` with every `it.fails(` replaced by `it(`, run with `-t` on the SEC-059 to SEC-063 describes; deleted afterwards -> 3 failed, each on its assertion, with every name listed `-> 200`; the other 28 selected cases passed
- `pnpm exec vitest run tests/security/t040-sellers.test.ts tests/security/sec041-042-cr57-recheck.test.ts` -> exit 0, 44 passed
- `pnpm format:check` -> exit 0; `pnpm lint` -> exit 0 (111 of 111 import-guard probes); `pnpm typecheck` -> exit 0
- `pnpm test` -> exit 0, 131 files, 3623 passed, 5 expected fail
- `pnpm test:integration` -> exit 0, 39 files, 1113 passed, 4 expected fail (SEC-053, SEC-061, SEC-062, SEC-063)
- `pnpm exec vitest run --project security` -> exit 0, 25 files, 931 passed, 5 expected fail. One intermediate run failed the SEC-043 tripwire: the first draft of the SEC-061 remediation in SECURITY.md wrote the character class with backslash-u escapes, which the tripwire reads as the characters. The text now names the code points. The rerun is the one quoted, and `pnpm test` was run again after that edit with the same counts
- `Get-Command gitleaks, trufflehog` -> neither installed; no secret scan. The fix commits change no manifest or lockfile, so no dependency audit was run

## Not run

- The flipped SEC-059 and SEC-060 cases against the pre-fix tree. The SEC-058 re-check of 2026-10-15 recorded both failing there (`expected 200 to be 409`). The bodies are unchanged apart from the SEC-060 status, and the 400 now comes from the new rule.
- A browser or font check of SEC-061 to SEC-063 and of U+16FE4. The visual claims rest on how variation selectors, Unicode spaces, and common Thai fonts are known to render, not on a screenshot.
- Requests through a running `next dev` or `next start` server; handlers were called in process.
- `pnpm build`, `pnpm verify` as one command (their parts except the build were run).
