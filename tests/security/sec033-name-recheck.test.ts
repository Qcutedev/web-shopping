/**
 * Re-check of SEC-033 (bidirectional formatting characters in names), fix 6bd3542. Owner:
 * security. Review: docs/reviews/SEC-033-035-recheck.md.
 *
 * Pure: the schema alone, no database. The sign-up route and the bootstrap both validate the
 * name with `signUpBodySchema.shape.name` (routes.ts `parseInput`, bootstrap-admin.ts
 * `readBootstrapInput`); the route-level cases are in t015-t016-auth.itest.ts.
 *
 * Every character outside ASCII, except the visible Thai, Arabic, and Hebrew sample text, is
 * written as an escape, so the source holds no invisible or format character.
 *
 * An `it.fails` case states the secure behaviour of an open finding (SEC-037): it is reported as
 * an expected failure while the flaw exists and turns red when the code is fixed.
 */
import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_ENV,
  BootstrapInputError,
  readBootstrapInput,
} from "@/modules/auth/bootstrap-admin";
import { NAME_ALLOWED_TEXT, signUpBodySchema } from "@/modules/auth/schema";

const nameSchema = signUpBodySchema.shape.name;

function accepted(name: string): boolean {
  return nameSchema.safeParse(name).success;
}

function hex(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Every code point that has the given Unicode property in this engine's Unicode data. */
function codePointsWith(property: RegExp): number[] {
  const found: number[] = [];
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (property.test(String.fromCodePoint(code))) found.push(code);
  }
  return found;
}

const BIDI_CONTROLS = codePointsWith(/^\p{Bidi_Control}$/u);
const THAI = "ร้านค้า";

describe("SEC-033 re-check: the refused set is the whole Bidi_Control property", () => {
  it("the engine's Unicode data lists exactly the twelve code points of the finding", () => {
    expect(BIDI_CONTROLS.map(hex)).toEqual([
      "U+061C",
      "U+200E",
      "U+200F",
      "U+202A",
      "U+202B",
      "U+202C",
      "U+202D",
      "U+202E",
      "U+2066",
      "U+2067",
      "U+2068",
      "U+2069",
    ]);
  });

  it("each Bidi_Control code point is refused at the start, in the middle, at the end, and alone", () => {
    const passed: string[] = [];
    for (const code of BIDI_CONTROLS) {
      const char = String.fromCodePoint(code);
      for (const name of [`${char}Admin`, `Ad${char}min`, `Admin${char}`, char, ` ${char} `]) {
        if (accepted(name)) passed.push(`${hex(code)} in ${JSON.stringify(name)}`);
      }
    }
    expect(passed).toEqual([]);
  });

  it("refused after surrounding whitespace is trimmed, and among Thai text", () => {
    for (const code of BIDI_CONTROLS) {
      const char = String.fromCodePoint(code);
      expect(accepted(`\u00a0\ufeff ${THAI}${char}nimdA \u3000`)).toBe(false);
      expect(accepted(`${THAI}\u200b${char}\u200c${THAI}`)).toBe(false);
    }
  });

  it("the bootstrap admin name refuses them too, without echoing the value", () => {
    for (const code of BIDI_CONTROLS) {
      const value = `Root${String.fromCodePoint(code)}Q9bidicanary`;
      let thrown: unknown;
      try {
        readBootstrapInput({
          [BOOTSTRAP_ENV.email]: "root@example.com",
          [BOOTSTRAP_ENV.password]: "a long enough passphrase",
          [BOOTSTRAP_ENV.name]: value,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BootstrapInputError);
      const error = thrown as BootstrapInputError;
      expect(error.issues.map((issue) => issue.variable)).toEqual([BOOTSTRAP_ENV.name]);
      expect(error.message.toLowerCase()).not.toContain("q9bidicanary");
    }
  });

  it("no Unicode normalization or case mapping turns an accepted name into one with a Bidi_Control", () => {
    // If a later layer normalised or case-mapped a stored name, it must not create one of the
    // refused characters. Checked for every scalar value, one at a time.
    const bidi = /\p{Bidi_Control}/u;
    const created: string[] = [];
    for (let code = 0; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = String.fromCodePoint(code);
      if (bidi.test(char)) continue;
      for (const form of ["NFC", "NFD", "NFKC", "NFKD"] as const) {
        if (bidi.test(char.normalize(form))) created.push(`${hex(code)} ${form}`);
      }
      if (bidi.test(char.toUpperCase()) || bidi.test(char.toLowerCase())) {
        created.push(`${hex(code)} case`);
      }
    }
    expect(created).toEqual([]);
  });

  it("the exported pattern is anchored and Unicode-aware (no partial or code-unit match)", () => {
    expect(NAME_ALLOWED_TEXT.flags).toContain("u");
    expect(NAME_ALLOWED_TEXT.source.startsWith("^")).toBe(true);
    expect(NAME_ALLOWED_TEXT.source.endsWith("$")).toBe(true);
    expect(NAME_ALLOWED_TEXT.test(`ok\u{1f600}\u202e\u{1f600}`)).toBe(false);
    expect(NAME_ALLOWED_TEXT.test(`\u202e`.repeat(100))).toBe(false);
  });

  it("Thai text with U+200B and U+200C, emoji sequences, and Latin names stay accepted", () => {
    for (const name of [
      THAI,
      `${THAI}\u200b${THAI}`,
      `${THAI}\u200c${THAI}`,
      "Somchai Jaidee",
      "\u{1f469}\u200d\u{1f4bb} shop",
      "\u2764\ufe0f",
      "محمد",
      "דוד",
    ]) {
      expect(accepted(name)).toBe(true);
    }
  });
});

/**
 * SEC-037 (new, Low): characters outside the Bidi_Control set that still change how a name is
 * laid out or make it look blank. Not part of SEC-033's remediation; registered separately.
 */
describe("SEC-037 names accept line separators, invisible format characters, and blank-looking names", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["U+2028 line separator (UAX #14 class BK, a mandatory break)", "Admin\u2028Verified seller"],
    ["U+2029 paragraph separator (class BK)", "Admin\u2029Verified seller"],
    ["U+FEFF zero-width no-break space inside the name", "Ad\ufeffmin"],
    ["U+2060 word joiner", "Ad\u2060min"],
    ["U+2061 to U+2064 invisible operators", "Ad\u2061\u2062\u2063\u2064min"],
    [
      "U+206A to U+206F deprecated format characters (symmetric swapping, shaping)",
      "Ad\u206a\u206bmin",
    ],
    ["U+FFF9 to U+FFFB interlinear annotation", "Admin\ufff9hidden\ufffa\ufffb"],
    [
      "U+E0001 and U+E0020 to U+E007F tag characters (ASCII smuggling)",
      "Admin\u{e0001}\u{e0068}\u{e0069}",
    ],
    ["U+180E Mongolian vowel separator", "Ad\u180emin"],
    ["a name of U+200B alone (looks blank)", "\u200b"],
    ["a name of U+3164 Hangul filler alone (looks blank)", "\u3164"],
    ["a name of U+115F U+1160 Hangul fillers (looks blank)", "\u115f\u1160"],
    ["a name of U+2800 braille blank alone (looks blank)", "\u2800"],
    ["a name of U+00AD soft hyphens alone (looks blank)", "\u00ad\u00ad"],
  ];

  for (const [label, name] of cases) {
    it.fails(`${label} is refused`, () => {
      expect(accepted(name)).toBe(false);
    });
  }
});
