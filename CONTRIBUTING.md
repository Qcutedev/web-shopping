# Contributing

Workflow for people and AI agents working on this repository. Conventions for code live in [CLAUDE.md](CLAUDE.md); agent roles and file ownership live in [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

## Branches

- `main` is always releasable. No direct commits once the repository has a remote; changes arrive through pull requests.
- Branch names: `feat/<task-id>-<short-name>`, `fix/<task-id>-<short-name>`, `docs/<short-name>`, `chore/<short-name>`. Example: `feat/T-032-checkout`.
- One task per branch. Keep branches short-lived.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), in English:

```
<type>(<scope>): <summary in imperative mood>

<why the change was needed, if not obvious>

Refs: T-0xx
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`. Scope is the module or area: `checkout`, `auth`, `seller`, `admin`, `db`, `ui`.

Never commit `.env` files, credentials, database dumps, or uploaded files.

## Before opening a pull request

Run the checks that exist and paste the real results into the pull request:

```
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

These scripts are created by the scaffold task. Until then there is nothing to run, and documentation-only changes say so.

If a check fails, fix the cause. Do not skip tests, disable lint rules, or weaken assertions to get a pass.

## Pull requests

- Use the template. Fill in every section; write "none" where nothing applies.
- Keep them small enough to review properly. Split unrelated changes.
- Link the task id and the requirement ids.
- A pull request touching authentication, authorization, checkout, payments, uploads, or admin actions needs a security review in addition to code review.
- Update the documents the change affects in the same pull request: `API_CONTRACTS.md` for endpoints, `DATA_MODEL.md` for schema, `DECISIONS.md` for decisions, `KNOWN_LIMITATIONS.md` for anything simulated or deferred.

## Review

- The author does not approve their own change. For agent work, the `code-review` agent reviews and the orchestrator re-runs the checks.
- Reviewers cite file and line and separate blocking from non-blocking comments.
- Merge only with required checks green and blocking comments resolved.

## Database changes

- Schema changes go through the database owner and come with a migration.
- Never edit a migration that has been applied to a shared environment.
- Destructive changes need explicit approval and a data plan.

## Reporting bugs and requesting features

Use the issue templates. For security problems, do not open a public issue; follow [.github/SECURITY.md](.github/SECURITY.md).

## Language

UI text is Thai and lives in `src/i18n/th.ts`. Code, comments, commits, pull requests, and technical documents are English.
