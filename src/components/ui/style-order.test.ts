import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * jsdom applies no CSS, so a test that only looks at class names cannot show which rule wins when
 * two of them set the same property. This file compiles src/app/globals.css through Tailwind with
 * the classes that the primitives use and checks the order of the emitted rules (CR-01).
 * A rule that is emitted later wins over an earlier one of equal specificity.
 */

const require = createRequire(import.meta.url);
const uiDir = dirname(fileURLToPath(import.meta.url));
const globalsPath = fileURLToPath(new URL("../../app/globals.css", import.meta.url));

function source(name: string): string {
  return readFileSync(`${uiDir}/${name}`, "utf8");
}

/** Every whitespace or quote separated word of the given files: a superset of the class names. */
function candidatesOf(...files: string[]): string[] {
  const words = new Set<string>();
  for (const file of files) {
    for (const word of source(file).split(/[\s"'`{}()<>,;=]+/)) {
      if (word.length > 0) words.add(word);
    }
  }
  return [...words];
}

let output = "";

beforeAll(async () => {
  const compiler = await compile(readFileSync(globalsPath, "utf8"), {
    base: dirname(globalsPath),
    loadStylesheet: async (id, base) => {
      if (id === "tailwindcss") {
        const path = require.resolve("tailwindcss/index.css");
        return { path, base: dirname(path), content: readFileSync(path, "utf8") };
      }
      throw new Error(`Unexpected stylesheet import in globals.css: ${id} (from ${base})`);
    },
  });
  output = compiler.build(
    candidatesOf("field.tsx", "checkbox.tsx", "radio.tsx", "quantity-stepper.tsx"),
  );
});

/** Position of the rule for a class in the compiled sheet, or -1. */
function position(className: string): number {
  const escaped = className.replace(/[:/[\]]/g, (character) => `\\${character}`);
  return output.indexOf(`.${escaped}`);
}

function expectBefore(earlier: string, later: string): void {
  const a = position(earlier);
  const b = position(later);
  expect(a, `${earlier} is not in the compiled CSS`).toBeGreaterThanOrEqual(0);
  expect(b, `${later} is not in the compiled CSS`).toBeGreaterThanOrEqual(0);
  expect(a, `${earlier} must be emitted before ${later}`).toBeLessThan(b);
}

describe("border rule order of form controls (CR-01)", () => {
  it("emits the hover border before the disabled and error borders", () => {
    expectBefore("hover:border-control-border-hover", "disabled:border-border");
    expectBefore("hover:border-control-border-hover", "aria-invalid:enabled:border-danger");
  });

  it("emits the checked hover border before the disabled checked border", () => {
    expectBefore(
      "checked:hover:border-primary-hover",
      "disabled:checked:border-foreground-disabled",
    );
  });

  it("emits the disabled state after the pointer states of the step buttons", () => {
    expectBefore("hover:bg-surface-muted", "aria-disabled:bg-surface");
    expectBefore("active:bg-border", "aria-disabled:bg-surface");
  });
});

describe("invalid border of a disabled control (CR-07)", () => {
  it("applies the danger border only to an enabled control", () => {
    const start = position("aria-invalid:enabled:border-danger");
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = output.slice(start, output.indexOf("}", start));
    expect(rule).toContain(":enabled");
    expect(rule).toContain("aria-invalid");
  });

  it("no longer emits the unconditional error border", () => {
    expect(position("aria-invalid:border-danger")).toBe(-1);
  });
});
