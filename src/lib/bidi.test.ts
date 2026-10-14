import { describe, expect, it } from "vitest";
import { stripIsolateControls } from "@/lib/bidi";

describe("stripIsolateControls", () => {
  it("removes the four isolate controls", () => {
    const isolates = String.fromCodePoint(0x2066, 0x2067, 0x2068, 0x2069);
    expect(stripIsolateControls(`a${isolates}b`)).toBe("ab");
  });

  it("keeps overrides, Thai, and Latin text", () => {
    const rlo = String.fromCodePoint(0x202e);
    expect(stripIsolateControls(`เสื้อยืด${rlo}Basic 100%`)).toBe(`เสื้อยืด${rlo}Basic 100%`);
  });
});
