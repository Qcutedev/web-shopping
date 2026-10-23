# SEC-090 re-check: admin read of product pictures (BR-41)

Reviewer: security agent. Date: 2026-10-23. Commits re-checked: `027edfa` (uploads: BR-41) and `10c0cd9` (API_CONTRACTS 5.8). Tree: `263d89b`, clean. Rule: BR-41 and REQ-A-05 acceptance (a) to (g) in [../REQUIREMENTS.md](../REQUIREMENTS.md). Register: [../SECURITY.md](../SECURITY.md) SEC-090 and SEC-068. Original review: [T-051-security.md](T-051-security.md).

Result: **SEC-090 FIXED.** No new finding. SEC-068 item 1 stays fixed, amended by BR-41.

A clean scanner run shows only that the scanner found nothing. Passing tests show only that the tested attacks fail. Neither shows that the file endpoint is secure.

## What was read

- `src/modules/uploads/service.ts`: `mayServe`, `openFile`
- `src/modules/uploads/repository.ts`: `fileLookupStatement`, `findUploadByKey`, `isLogoOfPublicStore`
- `src/app/api/files/[key]/route.ts`
- `src/server/auth/session.ts`: `getActor`, `loadActor`
- `src/modules/inventory/repository.ts`: `resolveOwnUploads`
- The author's tests: `src/modules/uploads/service.test.ts`, `tests/integration/uploads/endpoints.test.ts` (describe "BR-41" and the changed SEC-068 case), and the changes to `tests/security/sec068-recheck.itest.ts` and `tests/security/t051-admin-ui.itest.ts`

## Findings of the code read

| Question | Answer |
| --- | --- |
| Who reads a non-public file? | `mayServe`: a `SELLER` only when its store id is the upload's; an `ADMIN` only when `isProductPicture`; every other role `false`. An admin that carries a store id gains nothing from it. |
| What is "attached"? | `productPicture` is `EXISTS (SELECT 1 FROM "ProductImage" pim WHERE pim."uploadId" = f."id")`, computed on every request. No condition on product status, moderation, store, or category, as BR-41 (1) requires. It turns false as soon as the row goes. |
| Deactivated or demoted admin? | `loadActor` reads `isActive` and `role` from the user row on every request. An inactive user is no actor; a demoted user is judged by its new role. |
| Orphans | The orphan check runs before `mayServe`. A `ProductImage` row makes an upload not an orphan, so the two checks cannot disagree. |
| Logos | A logo is readable by an admin only if it is also a product picture. A seller can attach its own logo upload to a product (`resolveOwnUploads` scopes by store, not by use), which then makes the logo readable by admins while the store is not public. This follows BR-41 (1) and is the seller's own content; recorded as accepted residual risk, not a finding. |
| Response headers | Unchanged route: `no-store`, `nosniff`, `default-src 'none'; sandbox`, `inline`. The admin's 200 is byte-for-byte and header-for-header the owner's. |
| 404 differences | Every refusal goes through the same `fileNotFound()`. Measured: the admin's refusal of an unattached upload equals the unknown-key 404 in status, every header except `X-Request-Id`, and body. |
| Writes | None in the read path. Measured: no audit row, no session row change. |

## Test edits by backend-api in security-owned files

- `sec068-recheck.itest.ts`: `expectOwnerOnly` gained an `admin` argument. The admin reads the product picture in every product-state case and is refused the unattached upload and both logos. The other four non-owner callers keep the identical 404. The admin's 200 goes through the same `expectServed` checks as the owner's. This is a faithful translation of BR-41, not a weakening. Accepted.
- `t051-admin-ui.itest.ts`: the `it.fails` became `it`. The first case, named "documents today", recorded the defect (admin 404). It now asserts admin 200. That is acceptable: a "documents today" case exists to record current behaviour, and the rule changed. The case still asserts the owner 200 and the no-session 404, and the control case is unchanged. Security renamed the case and the describe and updated the header so they no longer describe an open finding.

## New tests

`tests/security/sec090-recheck.itest.ts`, 10 cases, written from BR-41:

- An admin demoted to `CUSTOMER` with a live session row gets a 404 identical to an unknown key.
- After its sessions are deleted, an admin gets the same 404.
- A forged admin cookie is treated as anonymous.
- After the `ProductImage` row is deleted, the admin gets the identical 404 and the owner still gets 200.
- After the product is deleted (cascade), the admin gets the identical 404.
- Documented: an upload that is both a suspended store's logo and a product picture is readable by the admin. Once detached, the admin gets the 404 again.
- The admin's 200 equals the owner's 200.
- The admin's refusal of an unattached upload equals the unknown-key 404.
- Seven variants of a readable key each get the identical 404.
- Three admin reads add no audit row and leave session rows unchanged.

Negative control (scratch copy, deleted): with `findUploadByKey` mocked to report every upload as a product picture, 4 of the 10 cases fail as intended (both detach cases, the logo case, the unattached refusal).

## Commands and results

| Command | Result |
| --- | --- |
| `docker ps` | `marketplace-db-test-1` up, healthy |
| `pnpm test:integration tests/security/sec090-recheck.itest.ts tests/security/sec068-recheck.itest.ts tests/security/t051-admin-ui.itest.ts tests/integration/uploads/endpoints.test.ts` | 4 files, 87 passed, 1 expected fail (SEC-071) |
| `pnpm test:integration tests/security/t041-uploads.itest.ts tests/security/sec065-recheck.itest.ts tests/security/t042-inventory.itest.ts tests/security/sec090-recheck.itest.ts tests/security/sec068-recheck.itest.ts tests/security/t051-admin-ui.itest.ts` | 6 files, 71 passed, 3 expected fail (SEC-064, SEC-066, SEC-071) |
| `pnpm exec vitest run src/modules/uploads/service.test.ts tests/security/t041-uploads.test.ts` | 2 files, 64 passed |
| Negative control, scratch copy with a `vi.mock` of `findUploadByKey` | 4 failed, 6 passed (intended) |
| `pnpm exec eslint` on the three touched test files | exit 0 |
| `pnpm exec prettier --check` on the three touched test files | clean |
| `pnpm typecheck` | exit 0 |

Not run: the full integration suite, `pnpm build`, e2e, `next start`, a browser.

## Notes for other owners (not findings)

- `src/app/api/files/[key]/route.ts` lines 9 to 11: the header comment still says a non-public file is served "only to a seller whose session's store owns it". It does not mention the BR-41 admin rule. This is stale documentation and has no effect on behaviour. Owner: backend-api.
- `docs/API_CONTRACTS.md` section 5.8.1 still says the BR-41 rule is "Not yet re-checked by security". It is now re-checked. Owner: backend-api.
- On the review page, a picture whose bytes are missing still renders as an empty box with no message. Frontend copy, not a security control.

## Not covered

- Pages in a real browser and through `next start`: whether the review page's `<img>` loads with the admin cookie and how the browser caches it.
- Timing differences between refusal paths. A non-public file always triggers one session lookup, whoever the caller is, so no timing difference by role was expected. This was not measured.
