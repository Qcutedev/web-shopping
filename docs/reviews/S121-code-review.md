# Code review: re-check of the S119 fixes (session 121 commits)

Commits: `91c655b` (e2e: CR-S119-01, 02, 04 to 09), `ab22b2b` (TEST_STRATEGY: CR-S119-01, 03, 08, 10), `9e6f599` (security tests after `21c9c33` and the `webServer.env` spread), `119b6bf` (`scripts/build-probe.ps1`, CR-S119-11). Findings under review: [S119-code-review.md](S119-code-review.md).

Reviewer: code reviewer (read-only for code). Date: 2026-10-28.

## Verdict

**CHANGES REQUIRED**: CR-S121-01, CR-S121-02.

- `91c655b`: **APPROVE.** Every e2e finding is fixed in code, and no assertion was weakened.
- `ab22b2b`: **CHANGES REQUIRED** (CR-S121-01, CR-S121-03). The docs still describe the removed retry.
- `9e6f599`: **APPROVE.** The `toContain("env: e2eServerEnvironment({")` check was replaced by a stricter structural check, not a weaker one.
- `119b6bf`: **CHANGES REQUIRED** (CR-S121-02). The script works, but its BOM turns `pnpm test` red.

## Status of each S119 finding

| ID | Status | Evidence |
| --- | --- | --- |
| CR-S119-01 | Code fixed; docs not fixed (CR-S121-01) | `e2e/auth-negative.spec.ts:32-55` has no retry. It does one browser `goto` per form after `warmRoutes`, records main-frame navigations and console messages, and adds them to the error on failure. STATUS records 2 full runs of 65 passed without the retry. `docs/TEST_STRATEGY.md:316` still says the warm-up retries and still states the cause as fact. |
| CR-S119-02 | Fixed | `e2e/global-setup.ts:93` calls `warmRoutes()`, and every spec shares it. `WARM_PATHS` covers `/sign-in`, `/sign-up`, `/products/[slug]`, `/cart`, `/checkout`, search, orders, and the API GETs. `WARM_POSTS` compiles checkout, cart items, and review. Unauthenticated POSTs stop at `401`, so they write nothing. STATUS records `e2e/review.spec.ts` passing alone. |
| CR-S119-03 | Fixed | `TEST_STRATEGY.md:312`, `:313`, `:320` match `registerCustomer`, `addToCartOnPage`, and `SIGN_UP_RATE_LIMIT=1000` in `playwright.config.ts`. |
| CR-S119-04 | Fixed | `e2e/review.spec.ts` asserts `details.reason` `NOT_DELIVERED` and `DUPLICATE_REVIEW`. This matches `API_CONTRACTS.md:972-973`. |
| CR-S119-05 | Fixed | The `[class*="danger"]` checks are gone. The spec asserts the `th.cart.notAvailable` badge text and `getByRole("note")` with `th.cart.notAvailableNote`. These exist in `src/components/cart/cart-view.tsx:199-201` and `:212`, so no `src` change was needed. The kept line asserts that neither is present. |
| CR-S119-06 | Fixed | `e2e/resubmission.spec.ts` asserts that the queue lists the title before the rejection. The storefront check before approval is removed with a stated reason. |
| CR-S119-07 | Fixed | `expect.poll(..., { timeout: 30_000 })`. |
| CR-S119-08 | Fixed | The stock `PATCH` asserts `error.code` `SELLER_NOT_APPROVED`, reads `stock` before and after, and asserts `stockBefore !== 50`, so the "unchanged" check can fail. |
| CR-S119-09 | Fixed | A comment marks the element count as the decisive check. |
| CR-S119-10 | Fixed (documented option) | `TEST_STRATEGY.md:321` says no spec may change the shipping setting and names the hardcoded values. |
| CR-S119-11 | Fixed, with a regression (CR-S121-02) | The probe ran here (see below): the build passed, `tsconfig.json` was restored byte for byte, and the dist directory was removed. |

## Findings

| ID | Severity | Where | Problem | Fix | Owner |
| --- | --- | --- | --- | --- | --- |
| CR-S121-01 | Medium (blocking) | `docs/TEST_STRATEGY.md:316` | The paragraph still says "the warm-up now retries that error up to three times, nothing else is retried". It also says "The retry could hide a real defect of that kind". It still states the cause as fact in parentheses ("the dev server's reload after a first compile aborts the navigation"), then calls it a hypothesis in the next sentence. The code has had no retry since `91c655b`. A reader of the doc is told the opposite of what the suite does. This is the doc half of CR-S119-01. | Rewrite the sentences to match the code. The retry was removed in `91c655b`. `warmRoutes` compiles the routes over HTTP. `auth-negative` opens each form once in a browser with no retry and reports frame navigations and console messages on failure. The `ERR_ABORTED` cause is still a hypothesis. Keep the run counts. | qa |
| CR-S121-02 | Medium (blocking) | `scripts/build-probe.ps1:1` | The file starts with a UTF-8 BOM (`EF BB BF`) and is otherwise pure ASCII. `tests/security/sec039-040-cr66-recheck.test.ts` (SEC-043) fails with `expected [ 'scripts/build-probe.ps1:1 U+FEFF' ] to deeply equal []`. The failure is deterministic, so `pnpm test` and `pnpm verify` are red. | Save the file without a BOM. Windows PowerShell 5.1 reads ASCII without a BOM correctly. Do not add an exception to the test. | devops |
| CR-S121-03 | Low | `docs/TEST_STRATEGY.md:300` (row for `e2e/resubmission.spec.ts`) | The row still says the rejected product "leaves the queue and the storefront". After CR-S119-06 the spec checks only the queue at that point, with a positive control first. | Say that the product is in the queue before the rejection and is gone from it afterwards, and that the storefront is checked after approval only. | qa |
| CR-S121-04 | Low | `scripts/build-probe.ps1` (`finally` block) | The probe restores `tsconfig.json` but not the git-ignored `next-env.d.ts`. After the run observed here, that file imports `./.next-s121review/types/routes.d.ts` from the deleted directory. A plain `tsc` or an editor reports errors until `pnpm typecheck` or `pnpm dev` regenerates the file. `DEPLOYMENT.md` says "without leaving a dirty tree", which is true for git only. | Snapshot and restore `next-env.d.ts` the same way as `tsconfig.json`, or document the side effect in `DEPLOYMENT.md`. | devops |
| CR-S121-05 | Low | `.gitignore`, `.prettierignore`, `eslint.config.mjs:284-285` | Only `.next/` and `.next-e2e/` are ignored. During a probe, or after `-KeepDist`, `.next-probe/` is an untracked directory of build output. `git add -A` would stage it and `pnpm lint` would scan it. | Ignore `.next-*/` in all three files, or have the script refuse `-KeepDist` for a directory that is not ignored. | devops |
| CR-S121-06 | Info | `e2e/global-setup.ts:130-146` | `warmRoutes` ignores the response status. A `500` from a broken compile passes the warm-up silently, and the first spec then reports it less directly. | Optional: log any response with status 500 or above. | qa |
| CR-S121-07 | Info | `docs/TEST_STRATEGY.md:298` (row for `e2e/review.spec.ts`) | The row says "a direct request is `409`" and does not mention the reason codes the spec now asserts. | Optional: add `NOT_DELIVERED` and `DUPLICATE_REVIEW`. | qa |
| CR-S121-08 | Info | `tests/security/sec074-077-recheck.test.ts` (`closeOf`, `webServerEnvExtras`) | The bracket scanner does not handle backslash escapes or `${}` inside template strings, and it strips only whole-line comments. Each gap makes the check throw or fail rather than pass. This fails closed, so it is acceptable. | None. | security |

## Checks re-run

- `pnpm lint`: exit 0, 215 of 215 import-guard probes.
- `pnpm typecheck`: exit 0.
- `pnpm test` (full, twice): exit 1. One failure is deterministic: SEC-043 on `scripts/build-probe.ps1:1 U+FEFF` (CR-S121-02). The other failures, 8 on the first run and 10 on the second, were timeouts under full-suite load. The 5 s and 30 s tests include `sec050`, `sec049`, `sec032`, `t019`, and `cr-t032-10`. All of them pass when re-run alone (see the next item). The reviewed commits do not touch these files.
- `pnpm exec vitest run --project security` on the 7 timed-out files: 7 files, 379 passed.
- `pnpm exec vitest run --project security` on `sec039-040-cr66`, `t032-sec055-item1`, `t051-admin-ui`, `sec037-038`, `sec074-077-recheck`, `s116-header-session`, and `s116-signup-limit-header-session`: 1 failed (the BOM), 148 passed, 2 expected fail.
- `powershell -NoProfile -File scripts/build-probe.ps1 -DistDir .next-s121review`: `PASS next build exited 0`. Only `include + .next-s121review/types/**/*.ts` and `include + .next-s121review/dev/types/**/*.ts` were added. `tsconfig.json` had the same hash after the run, the dist directory was removed, and `PASS build probe`, exit 0.

## Not verified

- `pnpm test:e2e`: not run. Untracked `e2e/keyboard.spec.ts` and `e2e/support/keyboard.ts` from another agent appeared during the review, and the suite owns port 3100. The "65 passed" runs (twice) and the single-spec run are taken from STATUS and TEST_STRATEGY and were not reproduced.
- The `ERR_ABORTED` cause: still a hypothesis. The new event capture has not yet seen a failure.
- Mutation runs for CR-S119-04 to 08: not run by the owner or by this review. Each new assertion was read and can fail: wrong reason, wrong code, changed stock, and a missing note or badge.
- `pnpm verify` and `pnpm format:check`: not run. `pnpm test` is red (CR-S121-02).
- Whether the full-suite timeouts are new: they are not linked to these commits, but no baseline full-suite run on this machine was compared.