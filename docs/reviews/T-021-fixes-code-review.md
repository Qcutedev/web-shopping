# T-021 fixes code review (cc991db, b411e34)

Reviewer: agent code-review, read-only. Recorded by the orchestrator, 2026-10-14.

Verdict: **APPROVED WITH FOLLOW-UPS**. No Blocking or Medium finding.

## Checks run by the reviewer

- `pnpm lint` exit 0 (111 of 111 import-guard probes as expected)
- `pnpm typecheck` exit 0
- `pnpm exec vitest run src/components/catalog src/lib/bidi.test.ts "src/app/(storefront)/storefront-pages.test.tsx" tests/security/sec033-rendering-recheck.test.ts` exit 0, 12 files, 175 passed
- `pnpm format:check` exit 0 on re-run (first run saw temporary files of a parallel security agent)

Not run: the new tests against `cc991db^` and `b411e34^` (fail-without-fix was judged by reading), `pnpm test`, `pnpm build`, integration, browser and screen reader.

## Closure of earlier findings

- CR-T021-11 closed (`filter-form.tsx:60-66,75,96`): hidden `category` field when the list is missing or empty; unknown slug kept as an extra option.
- CR-T021-12 mostly closed (`storefront-pages.test.tsx:18,284-311`); gap is CR-T021-20.
- CR-T021-15 partly closed (`filter-form.tsx:48-58,77-86`): `role="alert"` summary, both range fields invalid; announcement is uncertain, see CR-T021-21.
- SEC-057 `alt` fixed (`src/lib/bidi.ts:7-14`, `product-detail-view.tsx:50`); U+2066 to U+2069 stripped; FSI used only there.

## New findings

| Id | Severity | Where | Problem | Fix | Owner |
| --- | --- | --- | --- | --- | --- |
| CR-T021-19 | Low (security-adjacent) | `src/components/catalog/filter-form.tsx:96` | Extra `<option>` shows the raw `category` query value as visible text. `slugSchema` accepts up to 200 storable characters including Thai, spaces and bidi overrides, and an `<option>` cannot hold `<bdi>`. A shared link can show attacker text as the selected category (reflected content spoofing). Also shows a slug, not the Thai name, for a category past the 50-item limit. | Label the extra option with a fixed `th.ts` string, keep `value={category}`; or strip bidi controls and truncate. Add a test. | frontend, security to rule |
| CR-T021-20 | Low | `src/app/(storefront)/storefront-pages.test.tsx:131-134` | `vi.resetAllMocks()` leaves `getCategory` returning `undefined`; other category tests silently run the error path. | `catalog.getCategory.mockResolvedValue(categories[0])` in `beforeEach`. | frontend |
| CR-T021-21 | Low (a11y) | `filter-form.tsx:77-86` | Plain GET form reloads the document, so the `role="alert"` is present at load and may not be announced. | Confirm with NVDA and VoiceOver, or move focus to the summary (`tabIndex={-1}`); track under CR-68. | frontend, qa |
| CR-T021-22 | Info | `filter-form.tsx:49-58,79-83` | Range error text appears three times. | Optional: shorter hint or one shared `aria-describedby` target. | frontend |
| CR-T021-23 | Info | `filter-form.test.tsx:83-89,108` | `getAllByText(...).length > 0`; the test never checks the tie of error text to the control. | Assert min `aria-describedby` points at an element with `th.catalog.filter.minInvalid`. | frontend |

CR-T021-13, 14, 16, 17, 18 were out of scope here and stay open.
