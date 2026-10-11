// Prisma CLI configuration (Prisma 7). The CLI of the pinned version looks for
// `prisma7.config.ts` first and generates that name with `prisma init`; `prisma.config.ts`
// is only its fallback name. Used by `prisma generate`, `prisma migrate ...`, and `prisma db seed`.
//
// Prisma 7 does not read `.env` by itself, and the schema file no longer carries the connection
// URL. The local `.env` (git-ignored, copied from `.env.example`) is loaded here with the Node.js
// built-in loader, which never overrides a variable that is already set. So a deployment, CI, or
// a one-off command can supply `DATABASE_URL` in the environment and no `.env` file is needed.
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read directly, not with `env()`: `prisma generate` runs on install and needs no database,
    // and `env()` would fail it when the variable is absent. Commands that connect report the
    // missing URL themselves.
    url: process.env["DATABASE_URL"],
  },
});
