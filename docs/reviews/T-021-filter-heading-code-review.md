# T-021 follow-ups code review: filter form (87c796b), category heading (004c213)

Date: 2026-10-14. Reviewer: code-review agent (read-only). Verdict: **APPROVED WITH FOLLOW-UPS**, no Blocking finding.

Checks re-run by the reviewer: `pnpm lint` ok (111 of 111 probes), `pnpm typecheck` ok, `vitest run src/components/catalog "src/app/(storefront)"` 10 files, 107 passed, prettier ok. Not run: `pnpm verify`, `pnpm build`, browser, real HTTP status (D-039).

| Id | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| CR-T021-11 | Medium | `src/components/catalog/search-filters.tsx:25-31`, `filter-form.tsx:62,67` | Category filter dropped on submit when `listCategories` fails (`categories=[]`) or the current slug is not among loaded options (>50 categories, stale slug). Result set widens. | Hidden `category` input when `categories === undefined \|\| length === 0`; add option or hidden field when slug not in list; tests for both. |
| CR-T021-12 | Medium | `src/app/(storefront)/storefront-pages.test.tsx:17-24,241,276` | `catalog` mock has no `getCategory`; heading path throws TypeError and falls back silently. CR-T021-05 wiring untested at page level. | Add `getCategory` mock; assert h1 "ชา"; NOT_FOUND case; INTERNAL case keeps list and fallback h1. |
| CR-T021-13 | Low | `categories/[slug]/page.tsx:30-39,70` | D-039 HTTP 200 plus not-found content has no HTTP-level test. | Playwright E2E for missing category, store, product (T-060). |
| CR-T021-14 | Low | `categories/[slug]/page.tsx:56-62`, `stores/[slug]/page.tsx:41` | Unknown slug plus invalid filter shows invalid-filter page, not not-found. | Accept and document, or resolve slug first. |
| CR-T021-15 | Low | `filter-form.tsx:48-60` | Errors not announced after GET submit; range error marks only max field. | `role="alert"` summary with `th.catalog.filter` copy; mark min invalid too. |
| CR-T021-16 | Low | `price-filter.ts:89-102` | Range check duplicates `src/modules/catalog/schema.ts:168-180`. | Comment pointing at the schema rule. |
| CR-T021-17 | Low | `filter-form.test.tsx:44-45` | `as never` hides `CategoryDto` shape changes. | Build full `CategoryDto`. |
| CR-T021-18 | Info | `store-section.tsx:89-102` | SortLinks/FilterForm order differs between store and category pages. | Pick one order. |

Verified correct: baht to satang integer math and bounds, `satangToBaht`, URL handling, CLAUDE.md rules 1-8, Thai strings via `th.ts`, `CategoryHeading` (`unstable_rethrow`, `<bdi>`).
