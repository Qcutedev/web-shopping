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
