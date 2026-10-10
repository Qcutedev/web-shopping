## Summary

<!-- What changed and why, in two or three sentences. -->

Task: T-
Requirements: REQ-

## Type

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Tests
- [ ] Documentation
- [ ] CI or tooling
- [ ] Database migration

## Changes

<!-- Key files and what happened in each. -->

## Verification

<!-- Paste real results. Write "not run" with the reason if a check was not executed. Do not write "passes" without having run it. -->

| Check | Command | Result |
| --- | --- | --- |
| Format | `pnpm format:check` | |
| Lint | `pnpm lint` | |
| Types | `pnpm typecheck` | |
| Unit | `pnpm test` | |
| Integration | `pnpm test:integration` | |
| E2E | `pnpm test:e2e` | |
| Build | `pnpm build` | |

Manual checks performed:

## Security checklist

<!-- Tick what applies and is true. Leave unticked and explain if not. -->

- [ ] Every new or changed protected operation checks role and ownership on the server
- [ ] No user id, store id, role, price, or total is trusted from the client
- [ ] All new input is validated with a schema at the boundary
- [ ] No secrets, tokens, or personal data added to code, logs, or client bundles
- [ ] No test, lint rule, or auth check was skipped, disabled, or weakened
- [ ] Not applicable: this change has no security-relevant surface

Needs security review (touches auth, authorization, checkout, payments, uploads, or admin actions):

- [ ] Yes
- [ ] No

## Database

- [ ] No schema change
- [ ] Migration included and applied locally
- [ ] Migration is backward compatible with the previous application version
- [ ] Destructive change (requires explicit approval)

## Documentation

- [ ] `docs/API_CONTRACTS.md` updated, or no endpoint changed
- [ ] `docs/DATA_MODEL.md` updated, or no schema changed
- [ ] `docs/STATUS.md` updated
- [ ] `docs/DECISIONS.md` or `docs/KNOWN_LIMITATIONS.md` updated where relevant

## UI changes

<!-- Screenshots at mobile and desktop widths, if any UI changed. Confirm Thai copy comes from src/i18n/th.ts. -->

## Risks and follow-ups

<!-- What could go wrong, what is deliberately left out, what should happen next. -->
