# SEC-089 re-check: Next.js upgrade to 16.4.3

Reviewer: security agent. Date: 2026-10-26. Commit re-checked: `f9d916f` (deps: next and eslint-config-next 16.4.3, zod 4.6.7). Tree: `efbdb9f`, clean. Register: [../SECURITY.md](../SECURITY.md) SEC-089, TM-22, SEC-010.

Result: **SEC-089 FIXED.** The installed `next` is 16.4.3, outside the vulnerable range `>=16.0.0 <=16.4.0` reported by the audit, and `pnpm audit --prod` reports no known vulnerability. No new finding is raised. The development tree has two new advisory families (`undici`, `fast-uri`), recorded under SEC-010.

A clean scanner run shows only that the scanner found nothing. It does not show that the application or its dependencies are secure.

## Limits

- The three advisory texts (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r) were **not read**. This agent has no web-fetch tool in this session, and no other third-party access was used. Only the titles and version ranges from the audit output are known. Any configuration precondition or extra hardening step that the advisories name is therefore unknown.
- The fix is judged on version range only: 16.4.3 is above the patched version 16.4.1. Whether 16.4.3 fixes the defects completely is the vendor's claim, not verified here.
- E2E was not run by this agent (the orchestrator runs it on the same tree). `pnpm build` and `pnpm dev` were not run, so as not to share `.next` with the e2e run. The orchestrator's `pnpm verify` result in the SEC-089 fix evidence was not re-run.
- `gitleaks` is not installed (`Get-Command gitleaks` empty). No secret scan was needed: the commit changes no source, only `package.json`, `pnpm-lock.yaml`, and three docs.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| pnpm version | `pnpm --version` | 12.11.2 |
| Production audit | `pnpm audit --prod` | "No known vulnerabilities found", exit 0 |
| Full audit | `pnpm audit`; `pnpm audit --json` | exit 1; 8 advisories: 2 high, 4 moderate, 2 low, 0 critical. None in `next`, `zod`, or `eslint-config-next` |
| Production reach of the dev advisories | `pnpm why deepmerge-ts --prod`; `pnpm why undici --prod`; `pnpm why fast-uri --prod` | empty output for all three: not in the production tree |
| Installed versions | `node_modules/<pkg>/package.json` `version`; `pnpm ls next zod eslint-config-next --depth 0`; `pnpm why zod --prod` | `next` 16.4.3, `eslint-config-next` 16.4.3 (dev), `zod` 4.6.7, "Found 1 version of zod" (also used by `better-auth` and `better-call`) |
| Commit scope | `git show --stat f9d916f` | 5 files: `docs/DECISIONS.md`, `docs/SECURITY.md`, `docs/STATUS.md`, `package.json`, `pnpm-lock.yaml` (176 lines). No `src` change |
| Manifest diff | `git show f9d916f -- package.json` | three lines: `next` 16.4.0 to 16.4.3, `zod` ^4.6.5 to ^4.6.7, `eslint-config-next` 16.4.0 to 16.4.3 |
| Lockfile diff | `git show f9d916f -- pnpm-lock.yaml`, changed lines only | see below |

### Lockfile diff

Every changed line is one of these:

- `next` 16.4.0 to 16.4.3, with new integrity hashes.
- `@next/env`, `@next/eslint-plugin-next`, and the eight `@next/swc-*` platform binaries, 16.4.0 to 16.4.3, with new integrity hashes.
- `eslint-config-next` 16.4.0 to 16.4.3.
- `zod` 4.6.5 to 4.6.7.
- Peer-resolution keys that embed those versions: `better-auth@1.7.7(... next@16.4.3 ...)`, `@better-auth/*@1.7.7(... better-call@1.4.0(zod@4.6.7) ...)`, `better-call@1.4.0(zod@4.6.7)`, `zod-validation-error@4.0.2(zod@4.6.7)`. The versions of `better-auth`, `@better-auth/*`, `better-call`, and `zod-validation-error` are unchanged.

No other package was added, removed, or moved. No `overrides` or `pnpm` settings changed. No registry or tarball URL changed.

### Full audit (development tree)

| Advisory | Severity | Package | Vulnerable | Path | Status |
| --- | --- | --- | --- | --- | --- |
| GHSA-ggr8-5vv4-36mx | high | `deepmerge-ts` | <8.0.0 | Prisma CLI (`prisma > @prisma/config`) | known since 2026-10-12, SEC-010 |
| GHSA-xjj6-f33q-929c | high | `undici` | >=8.0.0 <8.12.2 | `jsdom` (Vitest test environment) | first recorded here |
| GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472 | moderate | `undici` | >=8.0.0 <8.12.2 | `jsdom` | first recorded here |
| GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr | moderate | `fast-uri` | <3.1.9 | Prisma CLI (`@prisma/dev > @prisma/streams-local > ajv`) | first recorded here |
| GHSA-xhq7-xmqj-769h, GHSA-333x-w4r6-6crp | low | `fast-uri` | <3.1.9 | Prisma CLI | first recorded here |

The `undici` and `fast-uri` versions did not change in `f9d916f`, so the upgrade did not bring them; the advisories were published after the last full audit (2026-10-13). They are development-only and are added to SEC-010 (Low): the test runner's DOM library and the Prisma CLI do not serve requests.

## Configuration checked against the advisory titles

These checks were made on 2026-10-23 and repeated now. They matter less after the upgrade but are kept as the record of exposure while 16.4.0 was installed.

| Advisory title | Precondition named in the title | What the code has |
| --- | --- | --- |
| GHSA-2464-fhr4-w9xw, RCE in Image Optimization API when SVG files are used | Image optimiser reaches an SVG | `next.config.ts` sets no `images` option (no `remotePatterns`, no `dangerouslyAllowSVG`, so the framework defaults apply); both `next/image` uses (`src/components/catalog/product-image.tsx:34`, `store-section.tsx:63`) pass `unoptimized`; no `public/` directory exists; uploads refuse SVG by magic bytes (T-041). The `/_next/image` route itself is still served by the framework. |
| GHSA-673q-mjm6-r5xr, RCE in `use cache` functions returning typed arrays | A `"use cache"` function | `grep` for `use cache` in `src`: no match. `cacheComponents: true` is on in `next.config.ts`. |
| GHSA-p3m5-59mp-jv5r, DoS in App Router using Server Actions | Server Actions | `grep` for `use server` in `src`: no match. The title names a feature every App Router server has; reachability without Server Actions is unknown. |

## Remaining for the owner

- Read the three advisories when web access is available and record any configuration they require. If one requires a setting, a new finding is opened; SEC-089 itself stays FIXED because the vulnerable code is no longer installed.
- The e2e suite on 16.4.3 is the orchestrator's run; its result is not part of this re-check.
- `.github/workflows/ci.yml:130-152` already has a job "Dependency audit (production)" running `pnpm audit --prod`. Whether it ran on GitHub for `f9d916f` was not checked (no GitHub access used). No Dependabot configuration was looked for in this re-check.
