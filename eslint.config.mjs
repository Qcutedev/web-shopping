import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Architecture rule 7 (CLAUDE.md). The import specifier is matched with a regular expression so
// that the alias form, relative forms, and deep paths are all caught. The guards stop accidental
// violations; an inline eslint-disable, createRequire, or a re-export through an allowed folder
// still gets past them and has to be caught in review.
const ALL_CODE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
// Revisit when T-013 pins the Prisma generator output path and driver adapter.
const DB_DRIVER = "^(@prisma/client|pg|postgres)(/|$)|(^|/)generated/prisma(/|$)";
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
  message: "Only src/modules may import src/server/db. Call a module service instead.",
};
const siblingPattern = { ...layerPattern, regex: SIBLING_DB };
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

function importGuard(patterns, message) {
  return {
    "no-restricted-imports": ["error", { patterns: [...patterns, normalPattern] }],
    "no-restricted-syntax": [
      "error",
      ...dynamicImportRules(patterns.map((pattern) => pattern.regex).join("|"), message),
    ],
  };
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Everything except the database layer itself: no database client or driver.
  // prisma/ is exempt because the generated client and the migration tooling live there.
  {
    files: ALL_CODE,
    ignores: ["src/server/db/**", "prisma/**"],
    rules: importGuard([driverPattern], driverPattern.message),
  },
  // Everything except src/modules and the database layer: no src/server/db either.
  // The list of further allowed importers (auth, health, seed, scripts, tests) is proposed in
  // D-021 and is not allowed here until the owner approves it.
  {
    files: ALL_CODE,
    ignores: ["src/modules/**", "src/server/db/**", "prisma/**"],
    rules: importGuard([driverPattern, layerPattern], layerPattern.message),
  },
  {
    files: ["prisma/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: importGuard([layerPattern], layerPattern.message),
  },
  // Inside src/server the database layer is a sibling, so short relative paths reach it too.
  {
    files: ["src/server/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    ignores: ["src/server/db/**"],
    rules: importGuard([driverPattern, layerPattern, siblingPattern], layerPattern.message),
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
