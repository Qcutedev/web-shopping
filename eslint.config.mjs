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
// A query or fragment suffix ("?" or "#") is also refused: "@/server/db?x" would not match the
// patterns, which end at "/" or the end of the string (SEC-081).
// A specifier that starts with "./.." (SEC-084) or is absolute (a drive letter, a leading "/", or a
// file: URL) is refused too: the patterns anchor on "../" and on a bare "./db", so "./../db" and
// "C:/x/scripts/y" would pass them. The real tree has no such specifier.
const NOT_NORMAL =
  "/\\./|//|\\\\|[?#]|(^|/)[^./][^/]*/\\.\\.(/|$)|^\\./\\.\\.|^([A-Za-z]:|/|file:)";

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
  regex: "^(node:)?(module|vm)$",
  message: "Only src/server/db may use node:module (createRequire) or node:vm.",
};
// A non-test file never imports a test-named module: such a file keeps a plain guard elsewhere
// and may be run by no test configuration (SEC-081).
const testImportPattern = {
  regex: "\\.(test|itest)(\\.[cm]?[jt]sx?)?$",
  message: "Do not import a test file (*.test.*, *.itest.*) from application code.",
};
const LOADER_MESSAGE =
  "Load modules with import or a direct require(...) call so the import rules can check them (SEC-081).";
const LOADER_NAMES = "require|createRequire|getBuiltinModule|mainModule|_load|eval|Function";
// Globals that give access to the loader or to the global object. Only `name.property` (not
// computed) is allowed, so that an alias (`const g = globalThis`) cannot be built. A type-position
// use (`typeof globalThis`) and the cast form `(globalThis as T)[key]` are allowed.
const GLOBAL_NAMES = "module|global|globalThis|Reflect|__non_webpack_require__|__webpack_require__";
// The cast form is allowed for globalThis only (SEC-081 recheck 3). A non-computed member whose
// property is itself one of these names (`globalThis.globalThis`, `.global`, `.module`) is
// rejected below, so a member position does not give a fresh alias; the bundler loader names are
// rejected in every position.
const GLOBAL_ALLOWED = [
  "MemberExpression[computed=false] > Identifier.object",
  "Property[computed=false] > Identifier.key",
  "TSPropertySignature > Identifier.key",
  "TSTypeQuery > Identifier",
  "TSQualifiedName > Identifier",
  "MemberExpression[computed=true] > TSAsExpression.object > Identifier.expression[name='globalThis']",
]
  .map((part) => `:not(${part})`)
  .join("");
const loaderRules = [
  `Identifier[name=/^(${GLOBAL_NAMES})$/]${GLOBAL_ALLOWED}`,
  "MemberExpression[computed=false][property.name='constructor']",
  // A computed key built from a string expression ("req" + "uire"). A numeric key (`items[i + 1]`)
  // is ordinary indexing and stays allowed: only a key that holds a string or template literal.
  // Two string literals joined by `+` and kept in a variable ("constr" + "uctor"): a name built to
  // avoid the name-based selectors, used later as a computed key. Only short pieces (16 characters
  // or fewer each) count: a long string split over two lines (class names) is ordinary. Any other
  // use of a built string as a key is caught by the computed-key selector below. Residual: longer
  // pieces and three or more pieces; code review is the control (D-045).
  "VariableDeclarator > BinaryExpression.init[operator='+'][left.type='Literal'][right.type='Literal'][left.value=/^.{0,16}$/][right.value=/^.{0,16}$/]",
  "MemberExpression[computed=true] > BinaryExpression.property:has(:matches(Literal[value=type(string)], TemplateLiteral))",
  // SEC-081 recheck 3 (b): the bundler runtime names, in every position (object, property, key).
  "Identifier[name=/^__(non_)?webpack_|^__turbopack_/]",
  // (c): a global name as the property of a non-computed member builds an alias, and a computed
  // literal key does the same. (The Identifier selector above already refuses the property
  // position; this one names the intent and also covers the computed literal.)
  `MemberExpression[computed=true][property.value=/^(${GLOBAL_NAMES})$/]`,
  // (d): destructuring reaches `constructor` or a loader without a member access, with an
  // identifier, string, computed literal, or template key. A computed key that is not a literal
  // cannot be read and is rejected too.
  `ObjectPattern > Property[key.name=/^(${LOADER_NAMES}|constructor|construct)$/]`,
  `ObjectPattern > Property[key.value=/^(${LOADER_NAMES}|constructor|construct)$/]`,
  "ObjectPattern > Property[computed=true]:not([key.type='Literal'])",
  // (e): a plain string kept in a variable (or assigned) that names the constructor or a loader.
  `VariableDeclarator[init.value=/^(${LOADER_NAMES}|constructor|construct)$/]`,
  `AssignmentExpression[right.value=/^(${LOADER_NAMES}|constructor|construct)$/]`,
  `VariableDeclarator[init.type='TemplateLiteral'][init.quasis.0.value.cooked=/^(${LOADER_NAMES}|constructor|construct)$/]`,
  `MemberExpression[property.name=/^(${LOADER_NAMES})$/]`,
  `MemberExpression[computed=true][property.value=/^(${LOADER_NAMES}|constructor|construct)$/]`,
  "MemberExpression[computed=true][property.type='TemplateLiteral']",
  "MemberExpression[computed=true]:matches([object.name='process'], [object.name='module'], [object.name='globalThis'], [object.name='Reflect'], [object.name='require'])[property.type!='Literal']",
  "CallExpression > MemberExpression.callee[property.name='constructor']",
  "MemberExpression[object.name='Reflect'][property.name='construct']",
  "Identifier[name=/^(require|createRequire|eval|Function)$/]:not(CallExpression > Identifier.callee[name='require']):not(MemberExpression > Identifier.property)",
  "Identifier[name='process']:not(MemberExpression > Identifier.object)",
  "CallExpression[callee.name='eval']",
  "CallExpression[callee.name='Function']",
  "NewExpression[callee.name='Function']",
].map((selector) => ({ selector, message: LOADER_MESSAGE }));

// SEC-083: application code under src does not import the folders whose files may import the db
// layer (scripts, tests, prisma/seed.ts) or e2e. Relative depth is the only way out of src: the
// `@/` alias stays inside it. The db layer is exempt (it reaches prisma/generated).
const outsideSrcPattern = {
  regex: "^(\\.\\./)+(scripts|tests|e2e|prisma)(/|$)",
  message: "Code under src may not import scripts, tests, e2e, or prisma (SEC-083).",
};

function importGuard(patterns, message, hardened = false) {
  const all = hardened
    ? [...patterns, moduleLoaderPattern, testImportPattern, outsideSrcPattern]
    : patterns;
  return {
    "no-restricted-imports": ["error", { patterns: [...all, normalPattern] }],
    "no-restricted-syntax": [
      "error",
      ...dynamicImportRules(all.map((pattern) => pattern.regex).join("|"), message),
      ...(hardened ? loaderRules : []),
    ],
  };
}

// SEC-081: the same guard again for src, where it is also hardened and inline config comments are
// ignored for every file under src, tests included. Only the db layer keeps the plain guard (it uses
// createRequire). Test-named files under src get the hardened guard too: a page can import one,
// and some of them are run by no test configuration.
const SRC_CODE = ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const HARDENED_EXEMPT = ["src/server/db/**"];
const CODE_EXT = "{ts,tsx,mts,cts,js,jsx,mjs,cjs}";
// Vitest runs these under src. Their loader use (createRequire, module mocks, `.constructor`) is
// legitimate and not reachable from a page, because application code may not import a test-named
// file (testImportPattern). They keep the path rules and noInlineConfig, but not the loader rules.
const VITEST_TESTS = ["**/*.test.ts", "**/*.test.tsx"];
function hardenedGuard(scope, ignores, patterns, message) {
  return [
    {
      files: [`${scope}/**/*.${CODE_EXT}`],
      ignores: [...ignores, ...HARDENED_EXEMPT, ...VITEST_TESTS],
      rules: importGuard(patterns, message, true),
    },
    {
      files: VITEST_TESTS.map((test) => [`${scope}/**`, test]),
      ignores: [...ignores, ...HARDENED_EXEMPT],
      rules: importGuard(patterns, message),
    },
  ];
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
  // SEC-081: inline config comments (eslint-disable and the like) are ignored in all of src.
  { files: SRC_CODE, linterOptions: { noInlineConfig: true } },
  // SEC-081 (owner decision, session 105): inline config comments are ignored everywhere, not only
  // in src, so a new top-level folder or a root file cannot switch the guards off. Generated
  // client code (git-ignored, written by `prisma generate`) is the one exception: it carries its
  // own disable header.
  { files: ALL_CODE, ignores: [GENERATED_CLIENT], linterOptions: { noInlineConfig: true } },
  // SEC-081: hardened copies of the blocks above for src. They come last so they win.
  ...hardenedGuard("src", [GENERATED_CLIENT], [driverPattern], driverPattern.message),
  ...hardenedGuard(
    "src",
    [...DB_LAYER_IMPORTERS, GENERATED_CLIENT],
    [driverPattern, layerPattern],
    layerPattern.message,
  ),
  ...hardenedGuard(
    "src/modules",
    MODULE_TESTS,
    [driverPattern, authPattern],
    "Only src/server/db may import the database client or driver, and modules import src/server/auth only through actor.ts (D-022).",
  ),
  ...hardenedGuard(
    "src/server",
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
