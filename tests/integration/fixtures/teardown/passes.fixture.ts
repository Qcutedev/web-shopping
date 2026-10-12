/** The one passing test of the teardown fixture run (see global-setup.ts in this directory). */
import { expect, it } from "vitest";

it("passes", () => {
  expect(1 + 1).toBe(2);
});
