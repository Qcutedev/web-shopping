# Code review: commit a7f63ca (CR-T040-02, CR-T040-04)

Date: 2026-10-19. Reviewer: code-review agent. Verdict: APPROVE. No blocking findings.

Checks re-run by reviewer: `vitest run src/modules/sellers` 6 files, 164 passed; `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test:integration` on sellers plus `tests/security/t040-sellers.itest.ts` 7 files, 94 passed, 3 expected fail. Not run: `pnpm verify`. Deadlock claim checked by reading PostgreSQL lock rules only.

| Id | Severity | Location | Finding | Fix |
| --- | --- | --- | --- | --- |
| CR-T040-05 | Low | `src/modules/sellers/unique-index.ts:32` | Three separate unique-violation helpers (sellers repository, `auth/bootstrap-admin.ts:176`, new one). T-042 needs one for `Product_slug_key`. | Move to a shared place under `src/server/db`; local copies call it. Before T-042. |
| CR-T040-06 | Low | `src/modules/sellers/service.ts:220-222` | Comment tells Store-row writers not to call `requireApprovedStoreForWrite`; they would hand-roll a drifting check. | Add a variant with `FOR NO KEY UPDATE` when first needed; point comment and API_CONTRACTS to it. |
| CR-T040-07 | Info | `src/modules/sellers/repository.ts:592-595` | After third slug collision the raw Prisma error (meta includes DETAIL with slug) is thrown. Unchanged behaviour. | Security to confirm the 500 handler does not log `meta` (SR-04). |
| CR-T040-08 | Info | `tests/integration/sellers/approval-unique-keys.test.ts:74-90` | Slug-retry case overlaps CR-T040-03 test. Intentional. | Delete if suite gets slow. |
