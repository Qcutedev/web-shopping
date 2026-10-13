/**
 * Re-check of SEC-037 (invisible, line-breaking, and blank-looking names; fix 20ee58d) and of the
 * call sites of the SEC-038 cookie filter (fix dea1fa6). Owner: security. Review:
 * docs/reviews/SEC-037-038-recheck.md. Pure: no database. The cookie behaviour through the
 * library is in sec038-cookie-recheck.itest.ts.
 *
 * Every character outside ASCII is written as an escape, so this source holds no invisible or
 * format character; the last describe block checks that for every file under tests/security.
 *
 * An `it.fails` case states the secure behaviour of an open finding (SEC-039, SEC-040): it is
 * reported as an expected failure while the flaw exists and turns red when the code is fixed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NAME_ALLOWED_TEXT, signUpBodySchema } from "@/modules/auth/schema";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const nameSchema = signUpBodySchema.shape.name;

function accepted(name: string): boolean {
  return nameSchema.safeParse(name).success;
}

function hex(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Consecutive code points as "U+XXXX" or "U+XXXX-U+YYYY". */
function ranges(codes: readonly number[]): string[] {
  const out: string[] = [];
  let start: number | undefined;
  let previous = -2;
  for (const code of codes) {
    if (start !== undefined && code === previous + 1) {
      previous = code;
      continue;
    }
    if (start !== undefined)
      out.push(start === previous ? hex(start) : `${hex(start)}-${hex(previous)}`);
    start = code;
    previous = code;
  }
  if (start !== undefined)
    out.push(start === previous ? hex(start) : `${hex(start)}-${hex(previous)}`);
  return out;
}

/** Every scalar value whose one-character string matches `property`. */
function scalarsWith(property: RegExp): number[] {
  const found: number[] = [];
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (property.test(String.fromCodePoint(code))) found.push(code);
  }
  return found;
}

const KEPT_ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d]);

describe("SEC-037 re-check: the fix holds", () => {
  it("no Cc, Cf, Zl, Zp scalar value except U+200B to U+200D survives at the start, middle, or end", () => {
    // Accepted only if trimming removed it first (tab, line feed, U+FEFF, U+2028 at an end):
    // the stored name is the parsed value, so what counts is whether the character is in it.
    const kept: string[] = [];
    for (const code of scalarsWith(/^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u)) {
      if (KEPT_ZERO_WIDTH.has(code)) continue;
      const char = String.fromCodePoint(code);
      for (const name of [`${char}Admin`, `Ad${char}min`, `Admin${char}`]) {
        const result = nameSchema.safeParse(name);
        if (result.success && result.data.includes(char)) {
          kept.push(`${hex(code)} in ${JSON.stringify(name)}`);
        }
      }
    }
    expect(kept).toEqual([]);
  });

  it("a lone high or low surrogate is refused anywhere", () => {
    for (const surrogate of ["\ud800", "\udbff", "\udc00", "\udfff"]) {
      expect(accepted(`Admin${surrogate}`)).toBe(false);
      expect(accepted(`${surrogate}Admin`)).toBe(false);
      expect(accepted(`Ad${surrogate}min`)).toBe(false);
    }
  });

  it("no single invisible character makes a name, alone or with the kept zero-width characters", () => {
    // Space separators, combining marks, default-ignorable code points, and the fillers.
    const invisible = scalarsWith(
      /^[\p{Zs}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}\u115f\u1160\u3164\uffa0\u2800]$/u,
    );
    const passed: string[] = [];
    for (const code of invisible) {
      const char = String.fromCodePoint(code);
      for (const name of [char, `${char}\u200b`, `\u200c${char}\u200d`, `${char}${char}`]) {
        if (accepted(name)) passed.push(`${hex(code)} in ${JSON.stringify(name)}`);
      }
    }
    expect(passed).toEqual([]);
  });

  it("the pattern is anchored, Unicode-aware, and has no partial match", () => {
    expect(NAME_ALLOWED_TEXT.flags).toContain("u");
    expect(NAME_ALLOWED_TEXT.source.startsWith("^")).toBe(true);
    expect(NAME_ALLOWED_TEXT.source.endsWith("$")).toBe(true);
    expect(NAME_ALLOWED_TEXT.test("Admin\u2028")).toBe(false);
    expect(NAME_ALLOWED_TEXT.test("\u2028Admin")).toBe(false);
    expect(NAME_ALLOWED_TEXT.test(`${"A".repeat(99)}\u2029`)).toBe(false);
  });

  it("legitimate names stay accepted: Thai with marks and zero-width characters, emoji sequences, keycaps, flags", () => {
    for (const name of [
      "\u0e2a\u0e21\u0e0a\u0e32\u0e22 \u0e43\u0e08\u0e14\u0e35",
      "\u0e23\u0e49\u0e32\u0e19\u200b\u0e04\u0e49\u0e32",
      "\u0e19\u0e49\u0e33",
      "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}",
      "\u2764\ufe0f",
      "1\ufe0f\u20e3 shop",
      "\u{1f1f9}\u{1f1ed}",
      "O'Brien-Smith",
      "Jos\u00e9",
    ]) {
      expect(accepted(name), JSON.stringify(name)).toBe(true);
    }
  });
});

/**
 * SEC-039 (new, Low): the fix refuses the categories its remediation named (Cf, Zl, Zp), but
 * unassigned code points (Cn), private-use characters (Co), noncharacters, and default-ignorable
 * combining marks pass. Several are invisible, and the 256 variation selectors carry one hidden
 * byte each, the same hidden-text channel as the tag characters SEC-037 closed.
 */
describe("SEC-039 names accept unassigned, private-use, and default-ignorable characters", () => {
  /** "hi!" as variation selectors: a byte b is U+FE00+b below 16, else U+E0100+(b-16). */
  const hiddenHi = "\u{e0158}\u{e0159}\u{e0111}";

  const cases: readonly (readonly [string, string])[] = [
    ["U+2065 (unassigned, default ignorable, between U+2064 and U+2066)", "Admin\u2065"],
    ["U+FFF0 to U+FFF8 (unassigned specials, default ignorable)", "Admin\ufff0\ufff8"],
    [
      "U+E0000, U+E0002 to U+E001F, U+E0080 to U+E0FFF (unassigned, default ignorable)",
      "Admin\u{e0000}\u{e0002}\u{e0080}\u{e0fff}",
    ],
    ["noncharacters U+FDD0, U+FFFE, U+FFFF, U+10FFFF", "Admin\ufdd0\ufffe\uffff\u{10ffff}"],
    ["private-use characters U+E000, U+F8FF, U+F0000", "Admin\ue000\uf8ff\u{f0000}"],
    ["variation selectors used as hidden bytes (U+E0100 to U+E01EF)", `Admin${hiddenHi}`],
    ["variation selectors U+FE00 to U+FE0D after a Latin letter", "Admin\ufe00\ufe0d"],
    [
      "default-ignorable combining marks U+034F, U+17B4, U+17B5, U+180B to U+180D, U+180F",
      "Ad\u034fmin\u17b4\u17b5\u180b\u180f",
    ],
    ["a name of U+1D159 musical null notehead alone (a blank glyph)", "\u{1d159}"],
  ];

  for (const [label, name] of cases) {
    it.fails(`${label} is refused`, () => {
      expect(accepted(name)).toBe(false);
    });
  }

  it.fails(
    "no Default_Ignorable_Code_Point other than U+200B to U+200D, U+FE0E, U+FE0F is accepted after a letter",
    () => {
      const keep = new Set([0x200b, 0x200c, 0x200d, 0xfe0e, 0xfe0f]);
      const passed = scalarsWith(/^\p{Default_Ignorable_Code_Point}$/u).filter(
        (code) => !keep.has(code) && NAME_ALLOWED_TEXT.test(`A${String.fromCodePoint(code)}`),
      );
      expect(ranges(passed)).toEqual([]);
    },
  );

  it.fails("no unassigned or private-use code point is accepted after a letter", () => {
    const passed = scalarsWith(/^[\p{Cn}\p{Co}]$/u).filter((code) =>
      NAME_ALLOWED_TEXT.test(`A${String.fromCodePoint(code)}`),
    );
    expect(passed.length).toBe(0);
  });
});

function sourceFiles(directory: string, keep: (path: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path, keep));
    else if (/\.(ts|tsx|mts)$/.test(entry.name) && keep(path)) found.push(path);
  }
  return found;
}

const isTestFile = (path: string): boolean => /\.(test|itest)\.(ts|tsx|mts)$/.test(path);

/** Calls of the auth library's API: `<anything>.api.<method>(...)`, with the full argument text. */
function apiCalls(source: string): { method: string; text: string }[] {
  const calls: { method: string; text: string }[] = [];
  const start = /\.api\.([A-Za-z]+)\s*\(/g;
  for (const match of source.matchAll(start)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0) break;
    }
    calls.push({ method: match[1] ?? "", text: source.slice(open, end + 1) });
  }
  return calls;
}

describe("SEC-038 re-check: every hand-over of request headers to the library is filtered", () => {
  const files = sourceFiles(join(ROOT, "src"), (path) => !isTestFile(path));

  it("every auth.api call under src that passes headers passes headersForAuthLibrary(...)", () => {
    const unfiltered: string[] = [];
    const seen: string[] = [];
    for (const file of files) {
      for (const call of apiCalls(readFileSync(file, "utf8"))) {
        const where = `${relative(ROOT, file).replaceAll("\\", "/")} ${call.method}`;
        seen.push(where);
        if (
          /\bheaders\b/.test(call.text) &&
          !/headers:\s*headersForAuthLibrary\(/.test(call.text)
        ) {
          unfiltered.push(where);
        }
        // Passing the whole request would let the library read its headers unfiltered.
        if (/\brequest\s*[:,}]/.test(call.text)) unfiltered.push(`${where} (request)`);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(unfiltered).toEqual([]);
  });

  it("the library's HTTP handler is not mounted or called anywhere under src", () => {
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (
        /toNextJsHandler|better-auth\/next-js|\bauth\.handler\b|\.handler\(\s*request/.test(source)
      ) {
        found.push(relative(ROOT, file));
      }
    }
    expect(found).toEqual([]);
  });

  it("no file under src reads cookies with a parser of the library directly", () => {
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (
        /\b(parseCookies|getSessionCookie|getCookieCache|parseSetCookieHeader)\s*\(|from "better-call/.test(
          source,
        )
      ) {
        found.push(relative(ROOT, file));
      }
    }
    expect(found).toEqual([]);
  });
});

/** Literal characters a reader cannot see, or sees as a plain space. */
const INVISIBLE_SOURCE_CHAR =
  /[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u115f\u1160\u3164\uffa0\u2800]/u;

function filesWithInvisible(paths: readonly string[]): string[] {
  const found: string[] = [];
  for (const path of paths) {
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const match = INVISIBLE_SOURCE_CHAR.exec(line);
        if (match !== null) {
          found.push(
            `${relative(ROOT, path).replaceAll("\\", "/")}:${String(index + 1)} ${hex(match[0].codePointAt(0) ?? 0)}`,
          );
        }
      });
  }
  return found;
}

describe("Source hygiene: no literal invisible characters (SEC-040)", () => {
  it("no file under tests/security holds one", () => {
    expect(filesWithInvisible(sourceFiles(join(ROOT, "tests/security"), () => true))).toEqual([]);
  });

  it.fails(
    "no non-test source file under src holds one (the name rule is written with escapes only)",
    () => {
      expect(
        filesWithInvisible(sourceFiles(join(ROOT, "src"), (path) => !isTestFile(path))),
      ).toEqual([]);
    },
  );
});
