/**
 * Second setup file of every integration test file; worker-env.ts has already set DATABASE_URL.
 *
 * Before the first test of each file the worker's database is emptied (the reset rule of
 * docs/TEST_STRATEGY.md), and the result is checked: if a row or a sequence value survived the
 * reset, the file fails here instead of running on another file's data. Nothing is cleaned up
 * after a file, so a failed file leaves its rows for inspection until the next file starts.
 */
import { afterAll, beforeAll } from "vitest";

import { db } from "@/server/db";

import { assertDatabaseIsReset, resetDatabase } from "../../helpers/reset";

beforeAll(async () => {
  await resetDatabase();
  await assertDatabaseIsReset();
});

afterAll(async () => {
  await db.$disconnect();
});
