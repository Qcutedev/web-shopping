/** SEC-077: global setup refuses to send a write to a server that does not show the canary. */
import { describe, expect, it } from "vitest";

import {
  assertServerShowsCanary,
  CANARY_SLUG_PREFIX,
  isCanarySlug,
  newCanarySlug,
} from "../../../e2e/support/server-identity";

describe("server identity canary", () => {
  it("makes a fresh slug of the accepted shape each time", () => {
    const a = newCanarySlug();
    expect(a.startsWith(CANARY_SLUG_PREFIX)).toBe(true);
    expect(isCanarySlug(a)).toBe(true);
    expect(newCanarySlug()).not.toBe(a);
  });

  it.each([
    undefined,
    "",
    "e2e-canary-",
    "e2e-canary-xyz",
    "x; rm -rf /",
    `${"e2e-canary-"}${"g".repeat(32)}`,
  ])("refuses %j as a canary slug", (value) => {
    expect(isCanarySlug(value)).toBe(false);
  });

  it("passes when the category list shows the slug", async () => {
    const slug = newCanarySlug();
    await expect(
      assertServerShowsCanary(
        async () => ({ status: 200, body: JSON.stringify({ data: [{ slug }] }) }),
        slug,
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a server that answers without the slug (another process on the port)", async () => {
    await expect(
      assertServerShowsCanary(
        async () => ({ status: 200, body: JSON.stringify({ data: [{ slug: "other" }] }) }),
        newCanarySlug(),
      ),
    ).rejects.toThrow(/does not read the e2e database/);
  });

  it("refuses a server that answers with an error status", async () => {
    const slug = newCanarySlug();
    await expect(
      assertServerShowsCanary(async () => ({ status: 500, body: `"${slug}"` }), slug),
    ).rejects.toThrow(/does not read the e2e database/);
  });

  it("refuses when the request itself fails", async () => {
    await expect(
      assertServerShowsCanary(async () => {
        throw new Error("ECONNREFUSED");
      }, newCanarySlug()),
    ).rejects.toThrow(/did not answer/);
  });
});
