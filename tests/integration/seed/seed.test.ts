/**
 * T-014: the seed script against the real test database (DATA_MODEL.md section 18).
 *
 * The script is run the way `pnpm db:seed` runs it (`tsx prisma/seed.ts`, a separate process),
 * pointed at this worker's database, so its environment check, exit statuses, and output are the
 * real ones. The cases share the file's database and run in order: refusals and the conflict
 * first, on an empty database, then the first run, the second run, and sign-in.
 */
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { db } from "@/server/db";

import { buildSampleData, SAMPLE_PASSWORD } from "../../../prisma/seed/data";
import { runProcess, type ProcessRun } from "../../helpers/process-tree";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { json, post, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";

const ROOT = process.cwd();
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SEED_TIMEOUT_MS = 60_000;

const EXIT = { ok: 0, refused: 2, conflict: 3 } as const;

const data = buildSampleData();

function seedEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test" };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

async function runSeed(overrides: Record<string, string | undefined> = {}): Promise<ProcessRun> {
  const run = await runProcess(process.execPath, [TSX_CLI, "prisma/seed.ts"], {
    cwd: ROOT,
    env: seedEnv(overrides),
    timeoutMs: SEED_TIMEOUT_MS,
  });
  expect(run.timedOut).toBe(false);
  return run;
}

/** Output never names a sample email, name, phone, or the password (SECURITY.md SR-04). */
function expectNoPersonalData(output: string): void {
  expect(output).not.toContain(SAMPLE_PASSWORD);
  expect(output).not.toContain("@example.com");
  for (const user of data.users) expect(output).not.toContain(user.name);
  for (const store of data.stores) expect(output).not.toContain(store.contactPhone);
}

beforeAll(() => {
  stubAuthEnvironment();
});

describe("seed refusal (DATA_MODEL.md section 18)", () => {
  it("refuses NODE_ENV=production in any letter case and changes nothing", async () => {
    const before = await snapshotDatabase();
    for (const nodeEnv of ["production", " Production "]) {
      const run = await runSeed({ NODE_ENV: nodeEnv });
      expect(run.exitCode).toBe(EXIT.refused);
      expect(run.output).toContain("NODE_ENV is production");
    }
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  }, 120_000);

  it("refuses a database that is not on this machine and never prints the URL", async () => {
    const remote = "postgresql://someone:pw-not-printed@db.example.net:5432/shop";
    const run = await runSeed({ DATABASE_URL: remote });
    expect(run.exitCode).toBe(EXIT.refused);
    expect(run.output).toContain("does not name a database on this machine");
    expect(run.output).not.toContain("pw-not-printed");
    expect(run.output).not.toContain("db.example.net");
  });

  it("stops on a sample key that is not sample data and keeps nothing of the run", async () => {
    const clothing = data.categories[0];
    if (clothing === undefined) throw new Error("sample data has no category");
    const real = await db.category.create({
      data: { name: "หมวดจริง", slug: clothing.slug, sortOrder: 1, isSample: false },
    });
    const before = await snapshotDatabase();
    const run = await runSeed();
    expect(run.exitCode).toBe(EXIT.conflict);
    expect(run.output).toContain("is not sample data");
    expectNoPersonalData(run.output);
    // Users were inserted before the category was reached; the one transaction kept none.
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    await db.category.delete({ where: { id: real.id } });
  });
});

describe("seed runs twice cleanly", () => {
  it("first run creates the sample rows", async () => {
    const run = await runSeed();
    expect(run.exitCode).toBe(EXIT.ok);
    expect(run.output).toContain("users 3 created, 0 already present");
    expect(run.output).toContain("products 9 created, 0 already present");
    expectNoPersonalData(run.output);

    const users = await db.user.findMany({
      include: { accounts: true, store: true, sellerApplications: true },
      orderBy: { email: "asc" },
    });
    expect(users.map((u) => [u.email, u.role])).toEqual(
      [...data.users].sort((a, b) => a.email.localeCompare(b.email)).map((u) => [u.email, u.role]),
    );
    for (const user of users) {
      expect(user.id).toMatch(/^[A-Za-z0-9]{32}$/);
      expect(user.isActive).toBe(true);
      expect(user.name.startsWith("ผู้ใช้ตัวอย่าง")).toBe(true);
      expect(user.accounts).toHaveLength(1);
      const account = user.accounts[0];
      expect(account).toMatchObject({ providerId: "credential", accountId: user.id });
      // The library's scrypt format, never the plain password.
      expect(account?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
      if (user.role === "SELLER") {
        expect(user.store).toMatchObject({ status: "APPROVED", isSample: true });
        expect(user.store?.name.startsWith("ร้านตัวอย่าง")).toBe(true);
        expect(user.sellerApplications.map((a) => a.status)).toEqual(["APPROVED"]);
      } else {
        expect(user.store).toBeNull();
      }
    }
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(0);

    const products = await db.product.findMany();
    expect(products).toHaveLength(data.products.length);
    for (const product of products) {
      expect(product.isSample).toBe(true);
      expect(Number.isInteger(product.priceSatang)).toBe(true);
      expect(product.priceSatang).toBeGreaterThan(0);
      expect(product.stock).toBeGreaterThanOrEqual(0);
      expect(product.title.startsWith("สินค้าตัวอย่าง")).toBe(true);
    }
    expect(await db.category.count({ where: { isSample: true } })).toBe(data.categories.length);
    expect(await db.address.count()).toBe(data.addresses.length);

    // No feedback, orders, or money movement is ever seeded.
    expect(await db.review.count()).toBe(0);
    expect(await db.order.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
  });

  it("second run changes nothing", async () => {
    const before = await snapshotDatabase();
    const run = await runSeed();
    expect(run.exitCode).toBe(EXIT.ok);
    for (const table of [
      "users 0 created, 3",
      "addresses 0 created, 1",
      "categories 0 created, 4",
    ]) {
      expect(run.output).toContain(table);
    }
    expect(run.output).toContain("stores 0 created, 2 already present");
    expect(run.output).toContain("products 0 created, 9 already present");
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("an archived sample product does not break a later run", async () => {
    const first = data.products[0];
    if (first === undefined) throw new Error("sample data has no product");
    await db.product.update({ where: { slug: first.slug }, data: { status: "ARCHIVED" } });
    const before = await snapshotDatabase();
    const run = await runSeed();
    expect(run.exitCode).toBe(EXIT.ok);
    expect(run.output).toContain("products 0 created, 9 already present");
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("sample accounts sign in with the published password through the real route", async () => {
    for (const sample of data.users) {
      resetProcessRateLimiter();
      const response = await signInRoute(
        post("/api/v1/auth/sign-in", {
          body: { email: sample.email, password: SAMPLE_PASSWORD },
        }),
      );
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ data: { role: sample.role } });
    }
    resetProcessRateLimiter();
    const wrong = await signInRoute(
      post("/api/v1/auth/sign-in", {
        body: { email: data.users[0]?.email, password: "not the sample password" },
      }),
    );
    expect(wrong.status).toBe(401);
  });
});
