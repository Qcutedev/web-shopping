// Not part of the integration or unit run: only run-guards.test.ts starts it, with
// `--root tests/integration/fixtures/teardown --config <this file>` (CR-37).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "teardown-fixture",
    environment: "node",
    include: ["passes.fixture.ts"],
    globalSetup: ["global-setup.ts"],
    pool: "forks",
  },
});
