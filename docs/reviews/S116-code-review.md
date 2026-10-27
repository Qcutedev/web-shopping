# Code review: session 116 commits (949285f, 2bd6ded, f475211)

Two independent read-only reviewers; findings merged and de-duplicated by the orchestrator. Review date: 2026-10-27.

Verdict: **APPROVE with follow-ups.** Reviewer A rated the silent header catch blocks Medium (blocking); reviewer B rated the same item Low, citing the existing practice in `src/components/catalog/category-chips.tsx:19`. Treat as Medium until the owner accepts the silent degrade or frontend adds logging.

Architecture rules 1-8 hold in all three commits. The `SIGN_UP_RATE_LIMIT` override is refused in production twice (`src/server/env.ts`, `src/server/rate-limit.ts`).

## Findings

| ID | Severity | Where | Problem | Fix | Owner |
| --- | --- | --- | --- | --- | --- |
| CR-S116-01 | Medium (A) / Low (B) | `src/components/shell/header-session.tsx` (catch blocks of `getActor`, `getProfile`, `getCart`) | Errors swallowed without a log line. A database fault shows as signed out. | After `unstable_rethrow(error)`, `logger.warn` with fixed event name and error class only (no PII); unit test per case. Or owner accepts the silent degrade. | frontend |
| CR-S116-02 | Low | `header-session.tsx` | Badge runs full `getCart` (lines, visible products, shipping fee, pricing) on every route group including `/admin`, `/seller`, not-found. | `countCartLines(actor)` service backed by one `COUNT`. | backend-api |
| CR-S116-03 | Low | `playwright.config.ts:9` | `process.env.SIGN_UP_RATE_LIMIT` set as module side effect; bypasses `e2eServerEnvironment()` and its pinning test; leaks to runner workers. | Move into `e2eServerEnvironment()`, pin in `tests/unit/e2e/server-environment.test.ts`; coordinate with `tests/security/sec074-077-recheck.test.ts`. | devops |
| CR-S116-04 | Low | `src/server/auth/routes.ts` (`getAuthRuntime`, `signUpRule`) | `limiter` and `signUpRule` wiring untested; a runtime with the raised limiter but no rule would answer 500 on every sign-up. Only e2e covers it. | Bundle into one required `{ limiter, rule }`; add `getAuthRuntime` / `handleSignUp` tests. | devops |
| CR-S116-05 | Low | `src/server/rate-limit.ts` (`signUpOverride` module-level `let`) | Not in `processState()` like the shared state; per-instance under HMR. Correct today. | Move into `processState()` or comment as intended. | devops |
| CR-S116-06 | Low (a11y) | `src/components/shell/account-menu.tsx:34-36` | Escape closes the menu but focus is not returned to the button. | Ref to button, `focus()` on Escape, test. | frontend |
| CR-S116-07 | Low | `account-menu.tsx` | `failed` alert persists across close/reopen and sits inside the `hidden` panel. | Clear `failed` when `open` becomes false, or render outside the panel. | frontend |
| CR-S116-08 | Low | `src/components/shell/account-menu.test.tsx:106-115` | "pending" test does not await work after `finish(...)`; act warnings or flake. | `await waitFor(() => expect(replace).toHaveBeenCalled())`. | frontend |
| CR-S116-09 | Low | `e2e/support/session.ts:26` | `ACCOUNT_BUTTON` regex built from unescaped Thai copy with `.+` name. | Match exactly with `fill(th.shell.header.account.buttonLabel, { name })`. | qa |
| CR-S116-10 | Low (test gap) | `e2e/support/session.ts`, `e2e/checkout.spec.ts` | No e2e step asserts the header cart badge after add-to-cart (badge is stale until navigation). | After the second add, go to `/` and assert the cart link label with 2 lines. | qa |
| CR-S116-11 | Info | `src/i18n/th.ts` `shell.header.account` | `fallbackName` and `profile` are both "บัญชีของฉัน". | Add to the owner question on the 8 pending `th.shell.header.*` keys. | owner |
| CR-S116-12 | Info | `src/lib/api-client/auth.ts:40` | `{ signedOut: boolean }` vs contract `true` (`API_CONTRACTS.md:462`). | Narrow to `true` (optional). | frontend |
| CR-S116-13 | Info | `e2e/checkout.spec.ts:19` | Stray comment between imports. | Move to file header. | qa |
| CR-S116-14 | Info | `src/server/env.ts` | Override guarded only by `NODE_ENV === "production"`; a preview or staging env with another NODE_ENV could set it. | For security review. | security |

## Checks re-run by reviewers

- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (215 of 215 import-guard probes).
- Targeted vitest (env, sign-up-rate-limit, rate-limit, shell components, auth): 391 passed.
- `pnpm test` run 1: 1 failed (unidentified, likely parallel security work), run 2: 5930 passed, 0 failed.

## Not verified

- `pnpm build` (Cache Components prerender of the shell layout change), `pnpm test:e2e` (35 passed not reproduced), browser check of header and menu.
- Thai copy of the 8 `th.shell.header.*` keys awaits owner approval.
