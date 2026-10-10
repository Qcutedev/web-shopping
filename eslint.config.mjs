import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Architecture rule 7 (CLAUDE.md). The import specifier is matched with a regular expression so
// that the alias form, relative forms, and deep paths are all caught.
const ALL_CODE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const DB_DRIVER = "^(@prisma/client|pg|postgres)(/|$)|(^|/)generated/prisma(/|$)";
const DB_LAYER = "(^|/)server/db(/|$)";
const SIBLING_DB = "^(\\./|(\\.\\./)+)db(/|$)";

const driverPattern = {
  regex: DB_DRIVER,
  message: "Only src/server/db may import the database client or driver.",
};
const layerPattern = {
  regex: DB_LAYER,
  message: "Only src/modules may import src/server/db. Call a module service instead.",
};

// `no-restricted-imports` does not see `import()` or `require()`, so those are restricted too.
// A specifier that is not a string literal cannot be checked and is rejected.
function dynamicImportRules(regexSource, message) {
  const escaped = regexSource.replaceAll("/", "\\/");
  return [
    { selector: `ImportExpression[source.value=/${escaped}/]`, message },
    {
      selector: `CallExpression[callee.name='require'][arguments.0.value=/${escaped}/]`,
      message,
    },
    {
      selector: "ImportExpression:not([source.type='Literal'])",
      message: "Dynamic import specifiers must be string literals so import rules can check them.",
    },
  ];
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Everything except the database layer itself: no database client or driver.
  {
    files: ALL_CODE,
    ignores: ["src/server/db/**", "prisma/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [driverPattern] }],
      "no-restricted-syntax": ["error", ...dynamicImportRules(DB_DRIVER, driverPattern.message)],
    },
  },
  // Everything except src/modules and the database layer: no src/server/db either.
  // The list of further allowed importers is proposed in D-021 and waits for owner approval.
  {
    files: ALL_CODE,
    ignores: ["src/modules/**", "src/server/db/**", "prisma/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [driverPattern, layerPattern] }],
      "no-restricted-syntax": [
        "error",
        ...dynamicImportRules(`${DB_DRIVER}|${DB_LAYER}`, layerPattern.message),
      ],
    },
  },
  // Inside src/server the database layer is a sibling, so short relative paths reach it too.
  {
    files: ["src/server/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    ignores: ["src/server/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [driverPattern, layerPattern, { ...layerPattern, regex: SIBLING_DB }] },
      ],
      "no-restricted-syntax": [
        "error",
        ...dynamicImportRules(`${DB_DRIVER}|${DB_LAYER}|${SIBLING_DB}`, layerPattern.message),
      ],
    },
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
