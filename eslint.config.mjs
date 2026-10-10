import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Architecture rule 7 (CLAUDE.md): only src/server/db talks to Prisma.
  {
    files: ["**/*.{ts,tsx,mts}"],
    ignores: ["src/server/db/**", "prisma/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@prisma/client",
                "@prisma/client/*",
                "**/generated/prisma",
                "**/generated/prisma/*",
              ],
              message: "Import the database client from src/server/db only.",
            },
          ],
        },
      ],
    },
  },
  // Architecture rule 7 (CLAUDE.md): pages, route handlers, and components reach data through module services.
  {
    files: [
      "src/app/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
      "src/i18n/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@prisma/client",
                "@prisma/client/*",
                "**/generated/prisma",
                "**/generated/prisma/*",
              ],
              message: "Import the database client from src/server/db only.",
            },
            {
              group: ["@/server/db", "@/server/db/*"],
              message: "Call a service in src/modules instead of the database layer.",
            },
          ],
        },
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
