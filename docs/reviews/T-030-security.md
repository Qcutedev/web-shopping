# Security review: T-030 profile and address routes (`/api/v1/me/**`)

Reviewer: security agent, 2026-10-13. Narrow review, done on its own. The backend-api handoff and its tests were read but not relied on.

Tree reviewed: commit `7526c1d` (profile module), plus the uncommitted backend-api files on disk: `src/app/api/v1/me/route.ts`, `src/app/api/v1/me/addresses/route.ts`, `src/app/api/v1/me/addresses/[id]/route.ts`, their `route.test.ts` files, `tests/integration/profile/`, and `docs/API_CONTRACTS.md` section 5.3.1. This review did not change or commit those files.

Test file: [tests/security/t030-me-routes.test.ts](../../tests/security/t030-me-routes.test.ts).

## Verdict

No finding registered. No Critical, High, Medium, or Low issue was found in the reviewed paths. One owner decision is noted below (address count per user).

A passing test suite shows only that these tests found nothing. It does not prove that the code is secure. No scanner was run for this narrow review.

## The T-020 static check that failed

`tests/security/t020-t018-catalog-shell.test.ts`, describe "T-020 review: the catalog route files are thin". It took every `route.ts` under `src/app/api/v1` outside `auth/` as a public catalog GET. The three `/me` files therefore failed 4 cases: the "exactly six files" case, and the "GET only ... no session read" case of each `/me` file.

Fix (no assertion weakened):

- The six catalog paths are named one by one. Each of them still gets every original assertion: `GET` only, `return handlePublicGet(request, async`, no database import, no `requireActor`, `getActor`, `cookies(`, or `headers()`.
- The "exactly six" case still compares the full sorted list. A missing catalog file still fails it.
- A new case requires that every other non-auth route file appears in a reviewed list, which holds the three `/me` files. An unreviewed new route under `src/app/api/v1` therefore still fails this describe, as it did before.

## Static checks added for the guarded `/me` routes

For each of the three files, in `t030-me-routes.test.ts`:

| Check | How |
| --- | --- |
| Methods exactly `GET`+`PATCH`, `GET`+`POST`, `PATCH`+`DELETE` | The exported handler names are compared to the list. The count of `export` lines must equal the method count, so a second export of any kind fails. |
| No database | No `@/server/db`, `@prisma`, `prisma/generated`, `$transaction`, or `$queryRaw`. Every import specifier is one of `@/modules/profile`, `@/server/auth/session`, `@/server/env`, `@/server/http`, and `@/server/request-frame`. |
| No business logic | No `where:`, `select:`, `data:`, `if (`, ternary, `switch (`, or `for (`. No spread of `body`, `raw`, or `request`. |
| No identity from the request | No `userId`, `storeId`, `role`, `isActive`, `cookies(`, `headers()`, `request.json(`, `request.text(`, or `getActor(` in the file. |
| Inside the frame | Each handler has `return handleRequest(request, async`. |
| Order of checks | Each handler calls `requireActor(request)` exactly once. A mutation calls `assertSameOrigin`, then `assertContentType`, then `requireActor`. A `GET` calls neither `assertSameOrigin` nor `readJsonBody`. |
| Guard before the body | `readJsonBody(request)` appears exactly once, after the guard, in `PATCH /me`, `POST /me/addresses`, and `PATCH /me/addresses/{id}`, and nowhere else. Every `parseInput(` comes after the guard. |
| Actor passed | Exactly one profile service is called in each handler. It is called after the guard, with `actor` as its first argument. |

Not done: a mutation probe (break a route file and watch the check fail). The route files belong to backend-api and were not edited. Each check is a direct string or order comparison.

## Ownership and mass assignment

Read: `src/modules/profile/{schema,service,repository,errors,index}.ts`, `src/server/auth/session.ts` (`requireActor`, `loadActor`), `src/server/http.ts` (`assertSameOrigin`, `assertContentType`, `readJsonBody`), and `docs/API_CONTRACTS.md` sections 1.1 and 5.3.

| Question | Result | Evidence |
| --- | --- | --- |
| Is every query scoped by `actor.userId`? | Yes. The profile read and write use `where { id: userId, isActive: true }`. The address count, list, owned lookup, update, and delete all include `userId`. `clearDefault` uses `updateMany where { userId, isDefault: true, id: { not } }`. | Recorder tests "every query is scoped by the actor" and "a foreign address id is 404" |
| Is a foreign address id 404, with nothing changed? | Yes. `PATCH` runs `findFirst where { id, userId }`. When nothing is found it returns before any `update` or `updateMany`, including when `isDefault: true` (only the row lock on the actor's own `User` row is taken). `DELETE` runs one `deleteMany where { id, userId }`, and `count 0` gives 404. Unknown and foreign ids take the same path and get the same body (`notFound()`, default message, `details {}`). | Recorder tests; `errors.ts` |
| Are unknown keys refused? | Yes. All three bodies are `z.strictObject`. `id`, `userId`, `email`, `role`, `isActive`, `storeId`, `createdAt`, and `__proto__` are each refused by `PATCH /me`, `POST /me/addresses`, and `PATCH /me/addresses/{id}`. Valid bodies still pass. | Tests "unknown keys are refused, not dropped" |
| Is there mass assignment? | No. `updateProfile` copies `name` and `phone` by name. `createAddress` copies the eight address fields by name, and the repository writes `{ ...input, userId }` with `userId` last. `updateAddress` passes the strict-parsed body through `presentKeys`, so only schema keys reach `data`. A test called the services directly with smuggled `role`, `isActive`, `email`, `userId`, and `id`. Only `name`/`phone` were written, and the address was written for the actor without the chosen `id`. | Recorder tests |
| Does a deactivated user keep access? | No. `requireActor` loads the actor with `isActive`. The profile queries check `isActive` again, and a miss is 401. | `session.ts` `loadActor`; `errors.ts` `profileGone` |
| CSRF | `Origin` must equal `APP_URL` on every mutation, and `Content-Type: application/json` is required, `DELETE` included (contract section 1.1). | Static checks |
| Raw SQL | One tagged template, `` SELECT 1 FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE ``. It is parameterised and `userId` comes from the session. | `repository.ts` |
| Response data | The address shape has no `userId` or timestamps. The profile shape returns the caller's own email, role, store summary, and latest application only. | `service.ts` mappers |

## Owner decision (note only, not a finding)

**No limit on the number of addresses per user, and no rate limit on `POST /me/addresses`.** One signed-in account can create rows without bound. Each row holds at most about 640 characters of text. The list is paginated, so reads stay bounded, but storage and the `count` grow. REQUIREMENTS and the contract set no cap, so this is a product decision for the owner, for example a cap of 20 or 50 addresses per user with `409`, or a rate limit in section 6. It is not registered as a finding because no requirement is broken. It should be decided before launch.

## Not reviewed

- The integration tests in `tests/integration/profile/` were not run (no database). What PostgreSQL does with the partial unique index `Address_userId_default_key` under concurrent default switches was not tested here.
- The backend-api `route.test.ts` files were not reviewed for completeness.
- No UI for profile or addresses exists yet, so output encoding of these fields in pages was not reviewed.

## Commands and results (2026-10-13)

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm vitest run tests/security/t030-me-routes.test.ts tests/security/t020-t018-catalog-shell.test.ts` | 0 | 2 files, 93 tests passed |
| `pnpm test` | 0 | 74 files; 2514 passed, 4 expected fail |
| `pnpm format:check` | 0 | after `prettier --write` on the new test file |
| `pnpm lint` | 0 | eslint clean; 111 of 111 import-guard probes as expected |
| `pnpm typecheck` | 0 | |
