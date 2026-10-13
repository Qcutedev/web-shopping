# T-018 app shell: code review

Reviewed commit `1018fde` on 2026-10-13 (seventeenth session). Reviewer: code-review agent, read-only. Recorded by the orchestrator.

Verdict: **APPROVED WITH FOLLOW-UPS.** No blocking finding. T-018 stays IMPLEMENTED, not VERIFIED, until CR-68 is done.

## Medium

- **CR-67** (frontend): header and footer link to `/search`, `/cart`, `/sign-in`, `/seller/apply`; none exist, so each lands on Next's built-in English 404 page. Breaks REQ-N-01. Fix: add `src/app/not-found.tsx` with Thai copy from `th.ts`. Check `node_modules/next/dist/docs/` for `not-found.tsx` vs `global-not-found` first.
- **CR-68** (qa with frontend): acceptance check "renders at 360, 768, 1280 px" (REQ-N-02) has not run; jsdom tests do not check layout; keyboard and screen-reader checks not done. Mark VERIFIED only after a recorded browser check or Playwright run.

## Low

- **CR-69** (frontend): `site-header.tsx:23,29,37-40`: below `md` the DOM order is brand, search, nav but the visual order is brand and nav, then search; Tab order differs from visual order (WCAG 2.4.3). Put the DOM in visual order and use `md:order-*` for wide screens.
- **CR-70** (ui-ux-design, owner): `site-header.tsx:41`: "open store" link is `hidden sm:inline-flex`, which DESIGN_SYSTEM.md:456 does not approve. Footer still has it. Show it, or get approval and record it.
- **CR-71** (frontend): `app-shell.tsx:22`: `<main>` has no `tabIndex={-1}`; the skip link may only scroll in some browser and screen-reader pairs.
- **CR-72** (frontend): `site-header.tsx:23-28`: brand link lacks `min-h-11` (44 px target, DESIGN_SYSTEM.md:475).
- **CR-73** (frontend): `site-header.tsx:30-35`: search input has no length cap; API_CONTRACTS.md:548 caps `q` at 100 characters and returns 400 above that.
- **CR-74** (ui-ux-design, frontend): `src/lib/format.ts:11-13` imports from `@/components/ui/format-price`; `lib` must not depend on the component layer, and `formatMoney` is only an alias. Move `formatSatang` into `src/lib`, keep one implementation.
- **CR-75** (frontend): `src/i18n/fill.ts:5` vs `:14`: doc says a value that is not a finite whole number throws; code checks only `Number.isFinite`. Use `Number.isSafeInteger` or correct the doc; add a test.
- **CR-76** (frontend, qa): `src/lib/format.test.ts:43-54`: formatters are built at module load, so changing `TZ` later has no effect; on a machine set to Asia/Bangkok, removing `timeZone` from `format.ts` still passes. Assert `resolvedOptions().timeZone` or pin `TZ=UTC` in `vitest.config.mts`. The tests also hard-code Buddhist year 2569, which depends on open question Q43.
- **CR-77** (ui-ux-design): `cart-link.tsx` implements the CartButton spec (DESIGN_SYSTEM.md:317) inside `src/components/shell`, while DESIGN_SYSTEM.md:339 and STATUS.md say CartButton is not built. Adopt it into `src/components/ui` or record that `CartLink` is the CartButton; update both documents.
- **CR-78** (product-requirements): `docs/REQUIREMENTS.md:339,349,376` say "none yet" but `src/i18n/site-name.test.ts` covers REQ-N-12 and `src/lib/format.test.ts` covers the date part of REQ-N-01.

## Notes

- SEC-033 second layer (`<bdi>`): this commit renders no user-supplied name; carry the rule to the signed-in header, store names, and address names, with a test.
- Mock payment and simulated shipping notices sit in the site-wide footer with the approved texts and a test. Showing them site-wide is still an owner question.
- All new UI text is in `src/i18n/th.ts`; "proposal" keys still need owner approval.
- No Prisma import, no business logic; routes are centralised in `src/lib/routes.ts`.

## Checks run by the reviewer

- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (82 of 82 probes); `pnpm test -- src/components/shell src/i18n src/lib/format.test.ts` 4 files, 29 passed.

## Not verified

- `pnpm build`, `pnpm format:check`, full `pnpm test`, `pnpm test:integration`.
- Browser rendering at three widths, contrast, keyboard, screen reader.
- Security review of this change.
