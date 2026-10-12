import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { th } from "./th";

// REQ-N-12: the marketplace name is one string in one place. This test fails when the literal
// name is copied into another source file, so changing `th.site.name` changes it everywhere.
const SRC = join(__dirname, "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe("marketplace name", () => {
  it("is defined once, in src/i18n/th.ts", () => {
    const owners = sourceFiles(SRC).filter((file) =>
      readFileSync(file, "utf8").includes(th.site.name),
    );
    const relative = owners.map((file) => file.slice(SRC.length + 1).replaceAll("\\", "/"));
    // This test itself does not contain the literal; th.ts is the only source that does.
    expect(relative).toEqual(["i18n/th.ts"]);
  });

  it("is not an empty string", () => {
    expect(th.site.name.trim()).not.toBe("");
  });
});
