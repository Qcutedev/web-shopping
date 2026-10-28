# Code review: re-check of the S121 fixes (session 123 commits)

Commits: `e193081` (TEST_STRATEGY: CR-S121-01, 03, 07), `e8aea94` (e2e warm-up: CR-S121-06), `a9f665b` (`scripts/build-probe.ps1`: CR-S121-02, 04), `2c682c8` (ignores: CR-S121-05), `e357960` and `6ec0eb5` (loading `Button`, keyboard focus defect from session 122). Findings under review: [S121-code-review.md](S121-code-review.md).

Reviewer: code reviewer (read-only for code). Date: 2026-10-28.

## Report: S121 fix re-review

Status: VERIFIED (targeted checks below)

Verdict: **APPROVE**. Every CR-S121 finding is fixed in the reviewed commits. No test, assertion, or lint rule was weakened. The findings below are Low or Info and do not block.

### Files changed

- `docs/reviews/S123-code-review.md` (created)

### Status of each S121 finding

| ID | Status | Evidence |
| --- | --- | --- |
| CR-S121-01 | Fixed, one residual phrase (CR-S123-02) | `docs/TEST_STRATEGY.md:317` now says the retry was added and removed in `91c655b`, nothing is retried, `warmRoutes` compiles over HTTP, and `auth-negative` opens each form once with no retry and reports frame navigations and console messages. The cause "remains a hypothesis". Run counts kept. |
| CR-S121-02 | Fixed | `scripts/build-probe.ps1` first bytes `23 20 52` ("# R"), 0 bytes above 127. `tests/security/sec039-040-cr66-recheck.test.ts` passes. |
| CR-S121-03 | Fixed | `TEST_STRATEGY.md:300`: the product is in the admin queue before the rejection and gone from it after; the storefront is checked after approval only. |
| CR-S121-04 | Fixed | `build-probe.ps1:33-36` snapshots `next-env.d.ts` (null when absent); the `finally` block restores the bytes, or removes a file that was absent at start. `DEPLOYMENT.md` says so. |
| CR-S121-05 | Fixed | `.next-*/` in `.gitignore:7` and `.prettierignore:2`, `.next-*/**` in `eslint.config.mjs:285`. `git check-ignore -v .next-probe/x .next-s123/x` matches `.gitignore:7:.next-*/` for both. `.next/` stays listed separately, which is needed because `.next-*/` does not match it. |
| CR-S121-06 | Fixed | `e2e/global-setup.ts:130-134` `logServerError`, called at `:146` and `:150`, warns on status 500 or above for every warm GET and POST. It logs only and does not fail the setup, as the finding allowed. |
| CR-S121-07 | Fixed | `TEST_STRATEGY.md:296` names `NOT_DELIVERED` and `DUPLICATE_REVIEW`. |
| CR-S121-08 | No action needed | Info only; fails closed. |

### Loading Button (`e357960`, `6ec0eb5`)

`src/components/ui/button.tsx:85-98`, final state:

```tsx
type={showSpinner ? "button" : type}
disabled={disabled}
aria-disabled={showSpinner || undefined}
aria-busy={showSpinner || undefined}
onClick={showSpinner ? undefined : onClick}
```

- Focusable while loading: native `disabled` is no longer set for `loading`, only for `disabled`. The unit test focuses the button and asserts `document.activeElement` before and after Enter and Space. A return to native `disabled` makes `focus()` fail, so the test can fail.
- No activation while loading: no click handler is attached, and a submit button becomes `type="button"`, so Enter, Space, and click neither call `onClick` nor submit the form. Unit tests cover click, `fireEvent.click`, keyboard, and form submit.
- Server components: `6ec0eb5` removes the wrapper closure added in `e357960`. `Button` has no `"use client"` and is rendered by server components (for example `src/components/catalog/filter-form.tsx`, `src/components/admin/list-view.tsx`). Now the only function passed to the host element is the caller's own `onClick`, and a server component cannot pass one. So `Button` no longer creates a function in a server render.
- Styling: `buttonVariants` applies `LOADING` (`pointer-events-none`) instead of `DISABLED` when loading. So `aria-disabled` does not switch a loading button to the disabled colours, and the variant colours stay.
- `disabled` together with `loading` still gives native `disabled` and no spinner (`showSpinner = loading && !disabled`), unchanged.

### Findings

| ID | Severity | Where | Problem | Fix | Owner |
| --- | --- | --- | --- | --- | --- |
| CR-S123-01 | Low | `docs/TEST_STRATEGY.md:303` (row for `e2e/keyboard.spec.ts`), `:317` (last sentences) | The row still says the focus case "fails, defect above". The paragraph still says "The suite is red until that defect is fixed". `e357960`/`6ec0eb5` fixed the defect, and STATUS records `pnpm test:e2e` 68 passed. The doc now contradicts the suite. | Record the fix commits and the 68-passed run. Remove "fails" and "suite is red". | qa |
| CR-S123-02 | Low | `docs/TEST_STRATEGY.md:317` | The residual half of CR-S121-01: "failed three times in four full runs with `net::ERR_ABORTED` on `/sign-up` (the dev server's reload after a first compile aborts the navigation; ...)" still states the cause as fact. Later in the same paragraph it is called a hypothesis. | Change the parenthesis to "suspected: ..." or drop it. The sentence that follows already states the hypothesis. | qa |
| CR-S123-03 | Low | `src/components/admin/categories-panel.tsx:130`, `:224`; `src/components/admin/settings-form.tsx:147`; `src/components/seller/order-status-panel.tsx:179-230` | These callers pass `loading={pending} disabled={pending}` (or `disabled={busy}`). `disabled` wins, so the spinner never shows and native `disabled` still drops keyboard focus to BODY. That is the defect the Button fix was for. The pattern was there before these commits, but the fix does not reach these buttons. | Drop `disabled={pending}` where `loading` already covers it. Keep `disabled` for the other actions in the same group only. | frontend |
| CR-S123-04 | Info | `src/components/ui/button.tsx:93` | A native `disabled` default button blocked implicit submission (Enter in a text field). A loading submit button is now `type="button"`. So a form with one text field and no other submit button can be submitted again by Enter while loading. Every form checked guards this already: inputs are disabled while pending, or the handler returns early (`add-to-cart.tsx:67`, `stock-panel.tsx:43`, `product-form.tsx:134`, `order-status-panel.tsx:78`, `:110`). No double submit was found. A new form that has neither guard would be exposed. | Optional: state in DESIGN_SYSTEM.md (Button, loading) that the form's submit handler must ignore a submit while pending. | ui-ux-design |
| CR-S123-05 | Info | `src/components/ui/button.tsx:88-97` | `{...props}` now comes before `disabled`, `aria-disabled`, `aria-busy`, `onClick`, and `type`. A caller's own `aria-disabled` or `aria-busy` is overwritten with `undefined` when not loading. Before `e357960` the caller's value won. No caller passes either today (grep of `src`). | None needed now. If a caller needs it later, merge the values (`aria-disabled={showSpinner \|\| props["aria-disabled"]}`). | ui-ux-design |

### Commands run

- `pnpm exec vitest run src/components/ui/button.test.tsx tests/security/sec039-040-cr66-recheck.test.ts tests/security/sec043-045-recheck.test.ts` -> exit 0, 3 files passed, 44 passed, 2 expected fail.
- `pnpm exec eslint src/components/ui/button.tsx src/components/ui/button.test.tsx e2e/global-setup.ts` -> exit 0.
- `pnpm exec prettier --check` on `button.tsx`, `button.test.tsx`, `e2e/global-setup.ts`, `docs/TEST_STRATEGY.md`, `docs/DEPLOYMENT.md`, `eslint.config.mjs` -> exit 0, all formatted.
- `[IO.File]::ReadAllBytes("scripts/build-probe.ps1")` -> first bytes `23 20 52`, 0 non-ASCII bytes.
- `git check-ignore -v .next-probe/x .next-s123/x` -> both match `.gitignore:7:.next-*/`.

### Not run

- `pnpm test` (full), `pnpm verify`, `pnpm typecheck`, `pnpm lint` (whole repo): the brief asked for targeted checks only. STATUS records typecheck and lint ok after `6ec0eb5`. This review did not reproduce that.
- `pnpm test:e2e`: not run, because the brief asked for targeted checks only. The "68 passed" run, including the keyboard focus case, is taken from STATUS and not reproduced.
- `scripts/build-probe.ps1`: not run again. The `next-env.d.ts` restore was read, not executed.
- A server render of a page with `Button` (`pnpm build` or dev): not run. The server-component claim rests on reading the code: no function is created inside `Button`.

### Acceptance criteria

- [x] CR-S121-01 to 07 fixed in code or docs: see the table above. One residual phrase is filed as CR-S123-02.
- [x] No regression in the loading Button: it has `aria-disabled`, stays focusable, attaches no click handler while loading, and cannot submit. The unit tests pass and can fail.
- [x] `scripts/build-probe.ps1` has no BOM, and the SEC-043 test file passes.
- [x] `.next-*/` is ignored in git, prettier, and eslint.
- [x] E2E change (`e8aea94`) only adds logging. The keyboard spec and the other e2e specs were not changed in these commits.

### Requests for other owners

- qa: CR-S123-01, CR-S123-02 (`docs/TEST_STRATEGY.md`).
- frontend: CR-S123-03 (`loading` with `disabled={pending}` in the admin and seller panels).
- ui-ux-design: CR-S123-04 note in DESIGN_SYSTEM.md (being updated in session 124).

### Risks and open concerns

- Security review of the Button change is not needed for authorization: the server still enforces every action. The change affects only UI double submit, which the form handlers guard against (CR-S123-04).