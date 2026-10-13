# T-030 code review (profile and addresses)

Reviewed 2026-10-13 by agent code-review, read-only. Commits: `7526c1d` (module), `db2a716` (routes), `e2744b1` (security tests), `b396ac4` (pages).

Verdict: **APPROVED WITH FOLLOW-UPS**. Nothing blocking. T-030 stays IMPLEMENTED until the integration file runs against PostgreSQL.

CR-79 to CR-90 belong to the T-020 review, so these findings start at CR-91.

## What holds

- Routes and pages are thin (CLAUDE.md rule 1).
- Every service function takes `actor` and scopes by `actor.userId`; a foreign or unknown address id gives 404 (rule 2).
- Prisma is imported only in `src/modules/profile/repository.ts` (rule 7).
- Default-address switch runs in a transaction with a `FOR NO KEY UPDATE` lock on the User row (rule 5).
- Zod schemas match API_CONTRACTS 5.3.1; error mapping matches.
- Names render through `UserName`; strings come from `th.ts`; no skipped tests.

## Findings

| Id | Severity | Owner | Location | Problem | Fix |
| --- | --- | --- | --- | --- | --- |
| CR-91 | Medium | backend-api | `src/modules/profile/repository.ts:185-195` | `updateOwnedAddress` checks ownership then updates; a concurrent DELETE makes `update` throw P2025, uncaught, so the caller gets 500 instead of 404. | Catch P2025 and return null (as `updateProfile` does), or `FOR UPDATE` on the address row. Add a test with a mocked P2025. |
| CR-92 | Low | frontend | `src/components/account/address-book.tsx:160` | Inline delete confirm is `role="alertdialog"` with no focus move and no accessible name; focus falls to `body` after the action. | Use `role="alert"` or move focus to the confirm button; return focus to a stable element afterwards. |
| CR-93 | Low | frontend | `src/components/account/addresses-section.tsx:38-40` | `pageSize` is read from the URL but pagination links drop it, so rows are skipped. | Carry `pageSize` in links or ignore it on this page. |
| CR-94 | Low | frontend | `src/components/account/address-form.tsx:94-96`, `validation.ts:76` | Edit sends the whole body including `isDefault`; saving can silently retake the default from another tab. | Send only changed fields. |
| CR-95 | Low | frontend | `src/i18n/th.ts` | Keys `account.profile.noChange` and `account.breadcrumbLabel` are unused. | Remove or use. |
| CR-96 | Low | database, product-requirements | `docs/DATA_MODEL.md:390`, `docs/REQUIREMENTS.md:159` | DATA_MODEL 6.2 does not record the User-row lock pattern, and CR-22 (a) still says a concurrent switch gives 23505. REQ-C-04 says 404 "on read" but no single-address read endpoint exists. | Document the lock, close CR-22 (a); reword REQ-C-04. |

Known gap, not a finding: no `/sign-in` page exists; redirects lead to 404 (open owner question `/login` vs `/sign-in`).

## Checks run by the reviewer

- `pnpm typecheck`: no errors.
- `pnpm lint`: no errors, 111 of 111 import-guard probes as expected.
- `pnpm test` over the T-030 paths: 12 files, 297 passed.
- No `.skip`, `.only`, `.todo`, `.fails` in the T-030 test paths.

## Not verified

- `pnpm test:integration` (`tests/integration/profile/endpoints.test.ts`, 515 lines) never run against PostgreSQL: row lock, partial index backstop, and the P2025 race are unproven.
- `pnpm build`, `pnpm format:check`, browser checks at 360/768/1280, keyboard and screen reader.
- Thai copy in `th.ts` is still a proposal awaiting owner approval.
