import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Architecture rule 7 (CLAUDE.md). The import specifier is matched with a regular expression so
// that the alias form, relative forms, and deep paths are all caught. The guards stop accidental
// violations. In src (not tests, not src/server/db) the guards are hardened (SEC-081): inline
// config comments are ignored, and the ways to load a module without `import` or a direct
// `require("...")` call are rejected. A re-export through an allowed folder still has to be
// caught in review.
const ALL_CODE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
// Pinned by T-013: the client is generated into prisma/generated/prisma, and the driver is the
// `pg` pool behind `@prisma/adapter-pg`. The pattern covers every `@prisma/*` package (client,
// driver adapters, their runtime utilities), `pg` and its `pg-*` companion packages, and the
// generated client by path. The `prisma` package itself (the CLI and `prisma/config`) is not a
// database client and is not covered.
const DB_DRIVER = "^(@prisma/[^/]+|pg(-[a-z0-9-]+)?|postgres)(/|$)|(^|/)generated/prisma(/|$)";
const DB_LAYER = "(^|/)server/db(/|$)";
const SIBLING_DB = "^(\\./|(\\.\\./)+)db(/|$)";
// The patterns above match text, so a path must be written in its normal form: no "/./", no "//",
// no backslash, and no ".." after a named segment (as in "@/server/auth/../db").
const NOT_NORMAL = "/\\./|//|\\\\|(^|/)[^./][^/]*/\\.\\.(/|$)";

const driverPattern = {
  regex: DB_DRIVER,
  message: "Only src/server/db may import the database client or driver.",
};
const layerPattern = {
  regex: DB_LAYER,
  message:
    "Only src/modules, src/server/auth, src/server/health.ts, prisma/seed.ts, scripts, and tests may import src/server/db. Call a module service instead.",
};
// Rule 7 allow-list (D-021, owner approved in D-025). Allowed to import src/server/db; none of
// them may import the client or a driver.
const DB_LAYER_IMPORTERS = [
  "src/modules/**",
  "src/server/auth/**",
  "src/server/health.ts",
  "prisma/seed.ts",
  "scripts/**",
  "tests/**",
];
// The generated client (written by `prisma generate`, git-ignored) imports the Prisma runtime. It
// is the only thing under prisma/ that does: the seed goes through src/server/db like every other
// allowed importer, and the CLI configuration (prisma7.config.ts, at the repository root) imports
// `prisma/config`, which the driver pattern does not cover.
const GENERATED_CLIENT = "prisma/generated/**";
const siblingPattern = { ...layerPattern, regex: SIBLING_DB };

// D-022 (CR-65): a module reaches the auth layer only through the pure file src/server/auth/actor.ts
// (the Actor type and the permission helpers). Everything else there (session.ts, auth.ts,
// routes.ts, config.ts, ...) reads the database or the framework and belongs to route handlers and
// the auth layer itself. The allow-list holds file names without extension; add one only with a
// decision, and only for a file that imports no database client and no framework code.
const AUTH_LAYER = "(^|/)server/auth";
const MODULE_AUTH_ALLOWED = ["actor"];
const authPattern = {
  regex: `${AUTH_LAYER}(/(?!(${MODULE_AUTH_ALLOWED.join("|")})(\\.[cm]?[jt]s)?$)|$)`,
  message:
    "Modules import src/server/auth only through actor.ts (D-022). Take what you need as a parameter, or import the pure helpers from actor.",
};
// Test files of a module may import any part of the auth layer: they exercise it.
const MODULE_TESTS = [
  "src/modules/**/*.test.{ts,tsx,mts,cts}",
  "src/modules/**/*.itest.{ts,tsx,mts,cts}",
];
const normalPattern = {
  regex: NOT_NORMAL,
  message: "Write import paths in normal form so the architecture import rules can check them.",
};

// `no-restricted-imports` does not see `import()` or `require()`, so those are restricted too.
// A specifier that is not a string literal cannot be checked and is rejected.
function dynamicImportRules(regexSource, message) {
  const pattern = `/${`${regexSource}|${NOT_NORMAL}`.replaceAll("/", "\\/")}/i`;
  const notLiteral = "Import specifiers must be string literals so import rules can check them.";
  return [
    { selector: `ImportExpression[source.value=${pattern}]`, message },
    { selector: `CallExpression[callee.name='require'][arguments.0.value=${pattern}]`, message },
    { selector: "ImportExpression:not([source.type='Literal'])", message: notLiteral },
    {
      selector: "CallExpression[callee.name='require']:not([arguments.0.type='Literal'])",
      message: notLiteral,
    },
  ];
}

// SEC-081: other routes to a module that the rules above cannot read. Applied to src only.
const moduleLoaderPattern = {
  regex: "^(node:)?module$",
  message: "Only src/server/db may use node:module (createRequire).",
};
const LOADER_MESSAGE =
  "Load modules with import or a direct require(...) call so the import rules can check them (SEC-081).";
const loaderRules = [
  "MemberExpression[object.name='process'][property.name='getBuiltinModule']",
  "Identifier[name='require']:not(CallExpression > Identifier.callee)",
  "Identifier[name='createRequire']",
  "CallExpression[callee.name='eval']",
  "CallExpression[callee.name='Function']",
  "NewExpression[callee.name='Function']",
].map((selector) => ({ selector, message: LOADER_MESSAGE }));

function importGuard(patterns, message, hardened = false) {
  return {
    "no-restricted-imports": [
      "error",
      { patterns: [...patterns, normalPattern, ...(hardened ? [moduleLoaderPattern] : [])] },
    ],
    "no-restricted-syntax": [
      "error",
      ...dynamicImportRules(patterns.map((pattern) => pattern.regex).join("|"), message),
      ...(hardened ? loaderRules : []),
    ],
  };
}

// SEC-081: the same guard again for src, where it is also hardened and inline config comments are
// ignored. Tests and the db layer keep the plain guard (they use createRequire and test fixtures).
const HARDENED_EXEMPT = ["src/server/db/**", "**/*.test.*", "**/*.itest.*"];
const SRC_CODE = ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
function hardenedGuard(files, ignores, patterns, message) {
  return {
    files,
    ignores: [...ignores, ...HARDENED_EXEMPT],
    linterOptions: { noInlineConfig: true },
    rules: importGuard(patterns, message, true),
  };
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Everything except the database layer itself and the generated client: no database client or
  // driver. This includes prisma/seed.ts and anything else written by hand under prisma/.
  {
    files: ALL_CODE,
    ignores: ["src/server/db/**", GENERATED_CLIENT],
    rules: importGuard([driverPattern], driverPattern.message),
  },
  // Everything except the allowed importers and the database layer: no src/server/db either.
  // A later block replaces the rules of an earlier one for the same file, so this block repeats
  // the driver pattern.
  {
    files: ALL_CODE,
    ignores: [...DB_LAYER_IMPORTERS, "src/server/db/**", GENERATED_CLIENT],
    rules: importGuard([driverPattern, layerPattern], layerPattern.message),
  },
  // The generated client may import the Prisma runtime, and nothing in it imports src/server/db.
  {
    files: ["prisma/generated/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: importGuard([layerPattern], layerPattern.message),
  },
  // Module code (not its tests): the auth layer only through actor.ts. A later block replaces the
  // rules of an earlier one for the same file, so this block repeats the driver pattern.
  {
    files: ["src/modules/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    ignores: MODULE_TESTS,
    rules: importGuard(
      [driverPattern, authPattern],
      "Only src/server/db may import the database client or driver, and modules import src/server/auth only through actor.ts (D-022).",
    ),
  },
  // Inside src/server the database layer is a sibling, so short relative paths reach it too.
  {
    files: ["src/server/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    ignores: ["src/server/db/**", "src/server/auth/**", "src/server/health.ts"],
    rules: importGuard([driverPattern, layerPattern, siblingPattern], layerPattern.message),
  },
  // SEC-081: hardened copies of the blocks above for src. They come last so they win.
  hardenedGuard([...SRC_CODE], [GENERATED_CLIENT], [driverPattern], driverPattern.message),
  hardenedGuard(
    [...SRC_CODE],
    [...DB_LAYER_IMPORTERS, GENERATED_CLIENT],
    [driverPattern, layerPattern],
    layerPattern.message,
  ),
  hardenedGuard(
    ["src/modules/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    MODULE_TESTS,
    [driverPattern, authPattern],
    "Only src/server/db may import the database client or driver, and modules import src/server/auth only through actor.ts (D-022).",
  ),
  hardenedGuard(
    ["src/server/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    ["src/server/db/**", "src/server/auth/**", "src/server/health.ts"],
    [driverPattern, layerPattern, siblingPattern],
    layerPattern.message,
  ),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
