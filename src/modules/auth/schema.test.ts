import { describe, expect, it } from "vitest";

import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/server/auth/config";

import {
  EMAIL_MAX,
  emailRateLimitSubject,
  NAME_MAX,
  NAME_MAX_MARK_RUN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  signInBodySchema,
  signUpBodySchema,
} from "./schema";

const valid = { name: "สมชาย ใจดี", email: "somchai@example.com", password: "correct horse" };

describe("bounds", () => {
  it("are the auth layer's", () => {
    expect(PASSWORD_MIN).toBe(PASSWORD_MIN_LENGTH);
    expect(PASSWORD_MAX).toBe(PASSWORD_MAX_LENGTH);
    expect(NAME_MAX).toBe(NAME_MAX_LENGTH);
    expect(EMAIL_MAX).toBe(EMAIL_MAX_LENGTH);
  });
});

describe("signUpBodySchema", () => {
  it("accepts a valid body and trims name and email", () => {
    expect(
      signUpBodySchema.parse({ ...valid, name: "  สมชาย  ", email: " somchai@example.com " }),
    ).toEqual({ ...valid, name: "สมชาย" });
  });

  it("refuses every key that could set a privilege or an owner", () => {
    for (const key of [
      "role",
      "isActive",
      "phone",
      "storeId",
      "userId",
      "emailVerified",
      "image",
    ]) {
      const result = signUpBodySchema.safeParse({ ...valid, [key]: "ADMIN" });
      expect(result.success, key).toBe(false);
      expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("enforces the password length on the server: 8 to 128", () => {
    expect(signUpBodySchema.safeParse({ ...valid, password: "1234567" }).success).toBe(false);
    expect(signUpBodySchema.safeParse({ ...valid, password: "12345678" }).success).toBe(true);
    expect(signUpBodySchema.safeParse({ ...valid, password: "x".repeat(128) }).success).toBe(true);
    expect(signUpBodySchema.safeParse({ ...valid, password: "x".repeat(129) }).success).toBe(false);
  });

  it("refuses an invalid email, an empty name, and a control character in the name", () => {
    for (const body of [
      { ...valid, email: "not-an-email" },
      { ...valid, email: `${"a".repeat(250)}@example.com` },
      { ...valid, name: "   " },
      { ...valid, name: "a\u0000b" },
      { ...valid, name: "a".repeat(101) },
    ]) {
      expect(signUpBodySchema.safeParse(body).success).toBe(false);
    }
  });

  it("refuses every bidirectional formatting character in the name (SEC-033)", () => {
    const bidi = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e];
    bidi.push(0x2066, 0x2067, 0x2068, 0x2069);
    for (const code of bidi) {
      const name = `ร้าน${String.fromCodePoint(code)}abc`;
      expect(signUpBodySchema.safeParse({ ...valid, name }).success, code.toString(16)).toBe(false);
    }
  });

  it("keeps the zero-width space and non-joiner that Thai text uses (SEC-033)", () => {
    for (const zeroWidth of [0x200b, 0x200c]) {
      const name = `สมชาย${String.fromCodePoint(zeroWidth)}ใจดี`;
      expect(signUpBodySchema.safeParse({ ...valid, name }).success).toBe(true);
    }
  });

  it("refuses every format character except U+200B to U+200D, and U+2028, U+2029 (SEC-037)", () => {
    const allowed = new Set([0x200b, 0x200c, 0x200d]);
    const passed: string[] = [];
    for (let code = 0; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = String.fromCodePoint(code);
      if (!/^[\p{Cf}\p{Zl}\p{Zp}]$/u.test(char) || allowed.has(code)) continue;
      if (signUpBodySchema.safeParse({ ...valid, name: `สม${char}ชาย` }).success) {
        passed.push(code.toString(16));
      }
    }
    expect(passed).toEqual([]);
  });

  it("refuses a lone surrogate in the name", () => {
    for (const name of ["a\ud800b", "a\udc00b"]) {
      expect(signUpBodySchema.safeParse({ ...valid, name }).success).toBe(false);
    }
  });

  it("refuses a name with nothing visible in it (SEC-037)", () => {
    for (const name of [
      "\u200b",
      "\u200b\u200c\u200d",
      "\u3164",
      "\u115f\u1160",
      "\uffa0",
      "\u2800",
      "\u2800 \u3164",
      "\u0e31",
      "\u0301\u0301",
      "\u{1d159}",
    ]) {
      expect(signUpBodySchema.safeParse({ ...valid, name }).success, JSON.stringify(name)).toBe(
        false,
      );
    }
  });

  it("accepts short and decorated names that have one visible character", () => {
    for (const name of ["\u0e01", "A", "1", "-", "\u2764\ufe0f", "\u{1f469}\u200d\u{1f4bb}"]) {
      expect(signUpBodySchema.safeParse({ ...valid, name }).success, JSON.stringify(name)).toBe(
        true,
      );
    }
  });

  it("refuses unassigned, private-use, and default-ignorable characters next to a visible one (SEC-039)", () => {
    for (const hidden of [
      "\u2065",
      "\ufff0",
      "\u{e0000}",
      "\ufdd0",
      "\uffff",
      "\u{10ffff}",
      "\ue000",
      "\u{f0000}",
      "\u034f",
      "\u17b4",
      "\u180b",
      "\ufe00",
      "\u{e0100}",
      "\u3164",
      "\u1160",
    ]) {
      const name = `Admin${hidden}`;
      expect(signUpBodySchema.safeParse({ ...valid, name }).success, JSON.stringify(name)).toBe(
        false,
      );
    }
  });

  it("keeps the emoji and text presentation selectors U+FE0E and U+FE0F (SEC-039)", () => {
    for (const name of ["\u2764\ufe0f", "\u2764\ufe0e", "1\ufe0f\u20e3"]) {
      expect(signUpBodySchema.safeParse({ ...valid, name }).success, JSON.stringify(name)).toBe(
        true,
      );
    }
  });
});

describe("runs of combining marks and kept invisible characters (SEC-041, SEC-042; D-036 item 7)", () => {
  // Code points as numbers only, never as escapes or literals (SEC-040).
  const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
  const accepted = (name: string): boolean =>
    signUpBodySchema.safeParse({ ...valid, name }).success;

  it("allows at most three in a row", () => {
    expect(NAME_MAX_MARK_RUN).toBe(3);
  });

  it("keeps real Thai words, up to three marks on one consonant", () => {
    for (const name of [
      // vowel above + tone mark + vowel below on one consonant (the owner's test case)
      cp(0x0e01, 0x0e34, 0x0e48, 0x0e38),
      // the same with the vowel below first
      cp(0x0e1b, 0x0e39, 0x0e48),
      // ที่, น้ำ, กิ๊ฟ, สิ้น, ปู่
      cp(0x0e17, 0x0e35, 0x0e48),
      cp(0x0e19, 0x0e49, 0x0e33),
      cp(0x0e01, 0x0e34, 0x0e4a, 0x0e1f),
      cp(0x0e2a, 0x0e34, 0x0e49, 0x0e19),
      cp(0x0e1b, 0x0e39, 0x0e48),
      // ศักดิ์, จันทร์ (U+0E4C thanthakhat)
      cp(0x0e28, 0x0e31, 0x0e01, 0x0e14, 0x0e34, 0x0e4c),
      cp(0x0e08, 0x0e31, 0x0e19, 0x0e17, 0x0e23, 0x0e4c),
      // vowel above + tone mark + U+0E4C
      cp(0x0e01, 0x0e34, 0x0e48, 0x0e4c),
      // ที่ followed by U+200B and another word: two marks and the space make three
      cp(0x0e17, 0x0e35, 0x0e48, 0x200b, 0x0e19, 0x0e35, 0x0e49),
      // ร้าน + U+200C + ค้า
      cp(0x0e23, 0x0e49, 0x0e32, 0x0e19, 0x200c, 0x0e04, 0x0e49, 0x0e32),
    ]) {
      expect(accepted(name), JSON.stringify(name)).toBe(true);
    }
  });

  it("keeps emoji sequences: keycaps, presentation selectors, ZWJ sequences", () => {
    for (const name of [
      cp(0x23, 0xfe0f, 0x20e3),
      cp(0x2764, 0xfe0f),
      cp(0x1f441, 0xfe0f, 0x200d, 0x1f5e8, 0xfe0f),
      cp(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb),
      cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
    ]) {
      expect(accepted(name), JSON.stringify(name)).toBe(true);
    }
  });

  it("accepts three in a row and refuses four, whatever the mix", () => {
    expect(accepted(`A${cp(0x0301, 0x0302, 0x0303)}`)).toBe(true);
    expect(accepted(`A${cp(0x0301, 0x0302, 0x0303, 0x0304)}`)).toBe(false);
    expect(accepted(`Admin${cp(0x200b, 0x200b, 0x200b)}`)).toBe(true);
    expect(accepted(`Admin${cp(0x200b, 0x200b, 0x200b, 0x200b)}`)).toBe(false);
    expect(accepted(`Ad${cp(0x200c, 0x200d, 0x200b, 0x200c)}min`)).toBe(false);
    expect(accepted(`A${cp(0x0301, 0x0302, 0x200b, 0x200c)}B`)).toBe(false);
    expect(accepted(`${cp(0x2764, 0xfe0f, 0x200d, 0x200b, 0x200c)}`)).toBe(false);
  });

  it("refuses four Thai marks on one consonant, and three marks followed by U+200B", () => {
    expect(accepted(cp(0x0e01, 0x0e34, 0x0e48, 0x0e38, 0x0e4c))).toBe(false);
    expect(accepted(cp(0x0e01, 0x0e34, 0x0e48, 0x0e38, 0x200b, 0x0e01))).toBe(false);
  });

  it("refuses long stacks and long invisible runs anywhere in the name", () => {
    expect(accepted(`A${cp(0x0301).repeat(95)}`)).toBe(false);
    expect(accepted(`Admin${cp(0x0336).repeat(90)}`)).toBe(false);
    expect(accepted(`${cp(0x200b).repeat(10)}Admin`)).toBe(false);
    expect(accepted(`Ad${cp(0x200b).repeat(4)}min`)).toBe(false);
  });

  it("counts runs, not totals: many short runs separated by visible characters pass", () => {
    const name = Array.from({ length: 10 }, () => `A${cp(0x0301, 0x0302, 0x0303)}`).join("");
    expect(accepted(name)).toBe(true);
  });
});

describe("signInBodySchema", () => {
  it("accepts any password of 1 to 128 characters and refuses role", () => {
    expect(signInBodySchema.safeParse({ email: valid.email, password: "x" }).success).toBe(true);
    expect(signInBodySchema.safeParse({ email: valid.email, password: "" }).success).toBe(false);
    expect(
      signInBodySchema.safeParse({ email: valid.email, password: "x".repeat(129) }).success,
    ).toBe(false);
    expect(
      signInBodySchema.safeParse({ email: valid.email, password: "x", role: "ADMIN" }).success,
    ).toBe(false);
  });
});

describe("emailRateLimitSubject", () => {
  it("trims, lower-cases, and applies NFKC", () => {
    expect(emailRateLimitSubject("  Somchai@Example.COM ")).toBe("somchai@example.com");
    // Full-width letters fold to ASCII under NFKC.
    expect(emailRateLimitSubject("ｓｏｍｃｈａｉ@example.com")).toBe("somchai@example.com");
  });
});
