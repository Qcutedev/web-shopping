/**
 * The slug generator (DATA_MODEL.md section 9): readable part, suffix alphabet and length, and the
 * use of the random source.
 */
import { describe, expect, it } from "vitest";

import {
  generateSlug,
  SLUG_SUFFIX_ALPHABET,
  SLUG_SUFFIX_PATTERN,
  slugReadablePart,
  slugSuffix,
} from "./slug";

const zeros = (length: number) => new Uint8Array(length);

describe("slugReadablePart", () => {
  it.each([
    ["Hello World", "hello-world"],
    ["  --Shop!!  Name--  ", "shop-name"],
    ["ร้านค้า ดีดี", "ร้านค้า-ดีดี"],
    ["ABC 123", "abc-123"],
    ["!!!", ""],
    ["", ""],
  ])("%j gives %j", (input, expected) => {
    expect(slugReadablePart(input)).toBe(expected);
  });

  it("keeps Thai vowels and tone marks (combining marks)", () => {
    expect(slugReadablePart("น้ำ")).toBe("น้ำ");
  });

  it("normalises to NFC", () => {
    expect(slugReadablePart("e\u0301")).toBe("é");
  });

  it("cuts to 40 code points and drops a trailing hyphen left by the cut", () => {
    expect(Array.from(slugReadablePart("a".repeat(60)))).toHaveLength(40);
    expect(slugReadablePart(`${"a".repeat(39)} bcd`)).toBe("a".repeat(39));
  });
});

describe("slugSuffix", () => {
  it("has 8 characters of lower-case Crockford base 32", () => {
    for (let i = 0; i < 50; i += 1) expect(slugSuffix()).toMatch(SLUG_SUFFIX_PATTERN);
  });

  it("maps each byte's low 5 bits onto the alphabet (unbiased: 32 divides 256)", () => {
    expect(SLUG_SUFFIX_ALPHABET).toHaveLength(32);
    expect(slugSuffix(zeros)).toBe("00000000");
    expect(slugSuffix(() => new Uint8Array([31, 63, 255, 32, 1, 2, 3, 4]))).toBe("zzz01234");
  });

  it("refuses a random source that returns the wrong length", () => {
    expect(() => slugSuffix(() => new Uint8Array(7))).toThrow(RangeError);
  });
});

describe("generateSlug", () => {
  it("joins the readable part and the suffix", () => {
    expect(generateSlug("My Shop", zeros)).toBe("my-shop-00000000");
  });

  it("is the suffix alone when the readable part is empty", () => {
    expect(generateSlug("!!!", zeros)).toBe("00000000");
  });

  it("gives two stores with one name different slugs", () => {
    expect(generateSlug("ร้าน")).not.toBe(generateSlug("ร้าน"));
  });
});
