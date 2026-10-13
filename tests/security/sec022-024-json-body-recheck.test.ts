/**
 * Independent re-check of the fixes for SEC-022 (strict UTF-8), SEC-023 (nesting limit), and
 * SEC-024 (a body that breaks off), of the handler pattern of CR-09, and of `conflict(reason)`
 * (CR-02), all in the `src/server` follow-up of 2026-10-12. Rules: SR-05 items 5 and 10 to 12 in
 * docs/SECURITY.md. Owner: security agent.
 *
 *   it(...)        behaviour that was checked on 2026-10-12 and holds. A failure is a regression.
 *   it.fails(...)  an OPEN finding (SEC-027, SEC-028). The body asserts the secure behaviour, so
 *                  the test is reported as an expected failure while the flaw exists and turns
 *                  red when the code is fixed. The owner of the code may then change `it.fails`
 *                  to `it` and nothing else; the security agent re-checks before it is closed.
 *
 * Nobody but the security agent may edit an assertion, a threshold, or a timeout here, or skip
 * or delete a case.
 *
 * `readJsonBody` and `errorResponse` are called directly. No route handler reads a body yet, so
 * nothing here goes through the framework; what the framework does with a dropped connection is
 * not verified by this file.
 *
 * Part of `pnpm test` (project "security"). Run alone with:
 *   pnpm exec vitest run --project security
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ABORTED_BODY_ERROR_CODE,
  AppError,
  conflict,
  ERROR_STATUS,
  isAppError,
  JSON_TOO_DEEP_FIELD_CODE,
  RequestBodyAbortedError,
} from "../../src/server/errors";
import {
  errorResponse,
  MAX_EMPTY_BODY_CHUNKS,
  MAX_JSON_BODY_LIMIT_BYTES,
  MAX_JSON_NESTING_DEPTH,
  readJsonBody,
} from "../../src/server/http";
import { createLogger } from "../../src/server/logger";

const REQUEST_ID = "req_security_recheck_22";
const JSON_HEADERS: Record<string, string> = { "content-type": "application/json" };
const MARKER = "QZXVMARKER";
const CEILING = { maxBytes: MAX_JSON_BODY_LIMIT_BYTES };

/** The whole public answer to a body that is not JSON (docs/API_CONTRACTS.md section 1.1). */
const NOT_JSON = {
  code: "VALIDATION_ERROR",
  message: "The request is invalid.",
  details: {
    fields: [{ path: "", code: "invalid_json", message: "The request body is not valid JSON." }],
  },
};

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function bytesOf(...parts: (string | readonly number[])[]): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") out.push(...encode(part));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}

function post(body: BodyInit | null, headers: Record<string, string> = JSON_HEADERS): Request {
  return new Request("https://shop.example/api/v1/cart", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

/** A request whose body arrives as the given chunks, one per read. */
function chunked(chunks: readonly Uint8Array[]): Request {
  let at = 0;
  return post(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[at];
          at += 1;
          if (chunk === undefined) controller.close();
          else controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 },
    ),
  );
}

function splitEvery(bytes: Uint8Array, size: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < bytes.byteLength; at += size) parts.push(bytes.slice(at, at + size));
  return parts;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("readJsonBody accepted the request");
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await rejection(promise);
  if (error instanceof AppError) return error;
  throw new Error(`expected an AppError, got ${String(error)}`);
}

interface Answer {
  status: number;
  text: string;
  body: { error: { code: string; message: string; details: Record<string, unknown> } };
  lines: Record<string, unknown>[];
  raw: string;
}

/** What a handler would send and log for `error`, with every level of the logger switched on. */
async function answer(error: unknown): Promise<Answer> {
  const written: string[] = [];
  const log = createLogger({ level: "debug", write: (line) => written.push(line) });
  const response = errorResponse(error, { requestId: REQUEST_ID, logger: log });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: JSON.parse(text) as Answer["body"],
    lines: written.map((line) => JSON.parse(line) as Record<string, unknown>),
    raw: written.join("\n"),
  };
}

/** How deep a parsed value nests arrays and objects, measured without recursion. */
function depthOf(value: unknown): number {
  let deepest = 0;
  const stack: [unknown, number][] = [[value, 0]];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const [node, depth] = entry;
    if (typeof node !== "object" || node === null) continue;
    const here = depth + 1;
    if (here > deepest) deepest = here;
    for (const child of Object.values(node)) stack.push([child, here]);
  }
  return deepest;
}

const arrays = (depth: number, inner = ""): string =>
  `${"[".repeat(depth)}${inner}${"]".repeat(depth)}`;
const objects = (depth: number, inner = "1"): string =>
  `${'{"k":'.repeat(depth)}${inner}${"}".repeat(depth)}`;

// ---------------------------------------------------------------------------
// SEC-022: bytes that are not valid UTF-8 are refused, never repaired (SR-05 item 11).
// ---------------------------------------------------------------------------

/** Byte sequences no UTF-8 decoder may accept. None of them contains a quote or a backslash. */
const INVALID_SEQUENCES: [string, number[]][] = [
  ["a byte that never occurs (FF)", [0xff]],
  ["a byte that never occurs (FE)", [0xfe]],
  ["a lone continuation byte (80)", [0x80]],
  ["a lone continuation byte (BF)", [0xbf]],
  ["two continuation bytes", [0x80, 0x80]],
  ["a two-byte lead followed by ASCII", [0xc2, 0x41]],
  ["a three-byte lead with one continuation", [0xe0, 0xa4, 0x41]],
  ["a four-byte lead with two continuations", [0xf0, 0x9f, 0x98, 0x41]],
  ["an overlong NUL (C0 80)", [0xc0, 0x80]],
  ["an overlong slash (C0 AF)", [0xc0, 0xaf]],
  ["an overlong quote (C0 A2)", [0xc0, 0xa2]],
  ["an overlong backslash (C1 9C)", [0xc1, 0x9c]],
  ["an overlong opening bracket (C1 9B)", [0xc1, 0x9b]],
  ["an overlong opening brace (C1 BB)", [0xc1, 0xbb]],
  ["an overlong three-byte slash (E0 80 AF)", [0xe0, 0x80, 0xaf]],
  ["an overlong three-byte form of U+07FF", [0xe0, 0x9f, 0xbf]],
  ["an overlong four-byte slash (F0 80 80 AF)", [0xf0, 0x80, 0x80, 0xaf]],
  ["an overlong four-byte form of U+FFFF", [0xf0, 0x8f, 0xbf, 0xbf]],
  ["a high surrogate written as UTF-8 (ED A0 80)", [0xed, 0xa0, 0x80]],
  ["a low surrogate written as UTF-8 (ED BF BF)", [0xed, 0xbf, 0xbf]],
  ["a surrogate pair written as two sequences", [0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]],
  ["a code point above U+10FFFF (F4 90 80 80)", [0xf4, 0x90, 0x80, 0x80]],
  ["a lead byte above F4 (F5 80 80 80)", [0xf5, 0x80, 0x80, 0x80]],
  ["a five-byte form (F8 88 80 80 80)", [0xf8, 0x88, 0x80, 0x80, 0x80]],
  ["a six-byte form (FC 84 80 80 80 80)", [0xfc, 0x84, 0x80, 0x80, 0x80, 0x80]],
];

/** Starts of a character with the rest missing: invalid at the very end of a body. */
const TRUNCATED_AT_END: [string, number[]][] = [
  ["a two-byte lead alone", [0xc2]],
  ["a three-byte lead alone", [0xe0]],
  ["a three-byte lead with one continuation", [0xe0, 0xb8]],
  ["a four-byte lead alone", [0xf0]],
  ["a four-byte lead with two continuations", [0xf0, 0x9f, 0x98]],
];

describe("SEC-022 re-check: a body that is not valid UTF-8 is refused, whatever its shape", () => {
  async function expectRefused(request: Request, label: string): Promise<void> {
    const error = await appError(readJsonBody(request));
    expect(error.toPublic(), label).toEqual(NOT_JSON);
    expect(error.cause, label).toBeUndefined();
    const sent = await answer(error);
    expect(sent.status, label).toBe(400);
    expect(sent.body.error, label).toMatchObject(NOT_JSON);
    expect(sent.text, label).not.toContain(MARKER);
    expect(sent.text, label).not.toContain("�");
    // An ordinary client error: nothing is logged, at any level.
    expect(sent.lines, label).toHaveLength(0);
  }

  it("every invalid sequence inside a string value is refused, also when a lenient decoder would parse it", async () => {
    for (const [name, sequence] of INVALID_SEQUENCES) {
      const body = bytesOf(`{"note":"${MARKER}`, sequence, '"}');
      // The control under test is the only thing between this body and a parsed value.
      const repaired = JSON.parse(new TextDecoder().decode(body)) as { note: string };
      expect(repaired.note, name).toContain("�");
      await expectRefused(post(body), name);
    }
  });

  it("the same sequences are refused in a key, between tokens, at the start, and as the whole body", async () => {
    for (const [name, sequence] of INVALID_SEQUENCES) {
      await expectRefused(post(bytesOf('{"', sequence, `":"${MARKER}"}`)), `${name}, key`);
      await expectRefused(post(bytesOf("[1,", sequence, "2]")), `${name}, between tokens`);
      await expectRefused(post(bytesOf(sequence, "{}")), `${name}, start`);
      await expectRefused(post(bytesOf("{}", sequence)), `${name}, end`);
      await expectRefused(post(Uint8Array.from(sequence)), `${name}, whole body`);
    }
  });

  it("a character cut off at the end of the body is refused, not completed or dropped", async () => {
    for (const [name, sequence] of TRUNCATED_AT_END) {
      await expectRefused(post(bytesOf(`"${MARKER}`, sequence)), `${name}, unterminated`);
      await expectRefused(post(bytesOf("1", sequence)), `${name}, after a complete value`);
      await expectRefused(post(bytesOf('"a', sequence, '"')), `${name}, before the closing quote`);
    }
  });

  it("the way the bytes are split into chunks changes nothing", async () => {
    const thai = "กุ้งแม่น้ำ \u{1F600} ราคา ๑๒๓";
    const valid = bytesOf(JSON.stringify({ note: thai }));
    for (const size of [1, 2, 3, 4, 5, 7]) {
      // A valid body split in the middle of its multi-byte characters is still the same body.
      expect(await readJsonBody(chunked(splitEvery(valid, size))), `valid, ${size}`).toEqual({
        note: thai,
      });
    }
    for (const [name, sequence] of [...INVALID_SEQUENCES, ...TRUNCATED_AT_END]) {
      const body = bytesOf(`{"note":"${MARKER}`, sequence, '"}');
      for (const size of [1, 2, 3]) {
        await expectRefused(chunked(splitEvery(body, size)), `${name}, chunks of ${size}`);
      }
      // The invalid bytes alone in a chunk of their own, and each byte in its own chunk.
      const head = bytesOf(`{"note":"${MARKER}`);
      const tail = bytesOf('"}');
      await expectRefused(chunked([head, Uint8Array.from(sequence), tail]), `${name}, own chunk`);
      await expectRefused(
        chunked([head, ...sequence.map((byte) => Uint8Array.of(byte)), tail]),
        `${name}, one byte per chunk`,
      );
    }
  });

  it("two bodies that differ only in their invalid bytes never become the same value", async () => {
    // Before the fix both were accepted as the same string, U+FFFD.
    const first = post(bytesOf('{"sku":"A', [0xff], '"}'));
    const second = post(bytesOf('{"sku":"A', [0xfe], '"}'));
    expect((await appError(readJsonBody(first))).status).toBe(400);
    expect((await appError(readJsonBody(second))).status).toBe(400);
    // A replacement character the client really sent is ordinary text and stays what it is.
    expect(await readJsonBody(post(bytesOf('{"sku":"A', [0xef, 0xbf, 0xbd], '"}')))).toEqual({
      sku: "A�",
    });
  });

  it("a byte order mark is removed once, at the start only, and other encodings are refused", async () => {
    const mark = [0xef, 0xbb, 0xbf];
    expect(await readJsonBody(post(bytesOf(mark, '{"a":1}')))).toEqual({ a: 1 });
    // Split over chunks, the mark is still a mark.
    expect(
      await readJsonBody(
        chunked([Uint8Array.of(0xef), Uint8Array.of(0xbb), Uint8Array.of(0xbf), encode("[1]")]),
      ),
    ).toEqual([1]);
    // Inside a string it is a character the client sent, and it is kept.
    expect(await readJsonBody(post(bytesOf('"a', mark, 'b"')))).toBe("a\ufeffb");
    // A mark is not a document, a second mark is not blank space, and a mark is not a separator.
    await expectRefused(post(Uint8Array.from(mark)), "mark alone");
    await expectRefused(post(bytesOf(mark, mark, "{}")), "two marks");
    await expectRefused(post(bytesOf("{}", mark)), "mark at the end");
    await expectRefused(post(bytesOf("[1", mark, ",2]")), "mark between tokens");
    await expectRefused(post(bytesOf([0xef, 0xbb], "{}")), "two thirds of a mark");
    // UTF-16 and UTF-32, with and without their marks.
    const utf16le = [0x7b, 0x00, 0x7d, 0x00];
    const utf16be = [0x00, 0x7b, 0x00, 0x7d];
    await expectRefused(post(bytesOf([0xff, 0xfe], utf16le)), "UTF-16LE with mark");
    await expectRefused(post(bytesOf([0xfe, 0xff], utf16be)), "UTF-16BE with mark");
    await expectRefused(post(Uint8Array.from(utf16le)), "UTF-16LE without mark");
    await expectRefused(post(Uint8Array.from(utf16be)), "UTF-16BE without mark");
    await expectRefused(
      post(bytesOf([0xff, 0xfe, 0x00, 0x00], [0x7b, 0, 0, 0, 0x7d, 0, 0, 0])),
      "UTF-32LE with mark",
    );
  });

  it("a charset parameter does not select another decoder", async () => {
    for (const contentType of [
      "application/json; charset=utf-16",
      "application/json; charset=iso-8859-1",
      "application/json; charset=windows-874",
      "application/json;charset=utf-7",
    ]) {
      // Thai in windows-874 and Latin-1 bytes are not UTF-8: refused, not transcoded.
      const request = post(bytesOf('{"note":"', [0xa1, 0xd8, 0xe9, 0xa7], '"}'), {
        "content-type": contentType,
      });
      await expectRefused(request, contentType);
    }
  });

  it("the boundaries of valid UTF-8 are still accepted and come back unchanged", async () => {
    const edges: [string, number[], string][] = [
      ["U+007F", [0x7f], "\u007f"],
      ["U+0080", [0xc2, 0x80], "\u0080"],
      ["U+07FF", [0xdf, 0xbf], "߿"],
      ["U+0800", [0xe0, 0xa0, 0x80], "ࠀ"],
      ["U+D7FF", [0xed, 0x9f, 0xbf], "\ud7ff"],
      ["U+E000", [0xee, 0x80, 0x80], "\ue000"],
      ["U+FFFD", [0xef, 0xbf, 0xbd], "�"],
      ["U+FFFF", [0xef, 0xbf, 0xbf], "\uffff"],
      ["U+10000", [0xf0, 0x90, 0x80, 0x80], "\u{10000}"],
      ["U+10FFFF", [0xf4, 0x8f, 0xbf, 0xbf], "\u{10FFFF}"],
    ];
    for (const [name, sequence, expected] of edges) {
      expect(await readJsonBody(post(bytesOf('"', sequence, '"'))), name).toBe(expected);
    }
  });

  it("an invalid byte in a body that is also too large or too deep changes no other answer", async () => {
    // Too large wins: the bytes are never decoded (413 before 400, SR-05 item 5 step 6).
    const large = bytesOf('"', [0xff], "a".repeat(200), '"');
    expect((await appError(readJsonBody(post(large), { maxBytes: 100 }))).status).toBe(413);
    // Too deep and not UTF-8: one 400, with nothing of the body in it.
    const deep = bytesOf("[".repeat(40), '"', MARKER, [0xff], '"', "]".repeat(40));
    await expectRefused(post(deep), "deep and invalid");
  });
});

// ---------------------------------------------------------------------------
// SEC-023: a JSON body nests at most 32 levels deep (SR-05 item 12).
// ---------------------------------------------------------------------------

describe("SEC-023 re-check: the nesting limit cannot be passed, and costs nothing to enforce", () => {
  async function expectTooDeep(request: Request, label: string, options = {}): Promise<void> {
    const error = await appError(readJsonBody(request, options));
    expect(error.status, label).toBe(400);
    expect(error.code, label).toBe("VALIDATION_ERROR");
    expect(error.cause, label).toBeUndefined();
    // Exactly one field error. Its `code` is provisional (docs/API_CONTRACTS.md item 8.2-12);
    // whatever is ruled, it is the one constant, and it is a fixed lower-case word.
    expect(error.details, label).toEqual({
      fields: [
        {
          path: "",
          code: JSON_TOO_DEEP_FIELD_CODE,
          message: "The request body nests arrays and objects more than 32 levels deep.",
        },
      ],
    });
    const sent = await answer(error);
    expect(sent.status, label).toBe(400);
    expect(sent.text, label).not.toContain(MARKER);
    expect(sent.lines, label).toHaveLength(0);
  }

  it("the number is 32, and the field code is one fixed word", () => {
    // Changing the number is a change of SR-05 item 12, decided in docs/SECURITY.md first.
    expect(MAX_JSON_NESTING_DEPTH).toBe(32);
    expect(JSON_TOO_DEEP_FIELD_CODE).toMatch(/^[a-z][a-z_]{2,40}$/);
  });

  it("depth 32 is accepted and depth 33 is refused, for arrays, objects, and both mixed", async () => {
    const mixed = (depth: number): string => {
      let text = `"${MARKER}"`;
      for (let level = 0; level < depth; level += 1) {
        text = level % 2 === 0 ? `[${text}]` : `{"k":${text}}`;
      }
      return text;
    };
    for (const [name, build] of [
      ["arrays", (depth: number) => arrays(depth)],
      ["arrays around a value", (depth: number) => arrays(depth, `"${MARKER}"`)],
      ["objects", (depth: number) => objects(depth)],
      ["mixed", mixed],
    ] as const) {
      const accepted = await readJsonBody(post(build(32)));
      expect(depthOf(accepted), name).toBe(32);
      await expectTooDeep(post(build(33)), `${name}, 33`);
      await expectTooDeep(post(build(34)), `${name}, 34`);
      await expectTooDeep(post(build(1_000)), `${name}, 1000`);
    }
    // Depth 0 and 1.
    expect(await readJsonBody(post("7"))).toBe(7);
    expect(await readJsonBody(post("[]"))).toEqual([]);
  });

  it("the deepest point counts, wherever it is in the document", async () => {
    const leaf32 = arrays(31);
    const leaf33 = arrays(32);
    // Siblings of depth 32 next to one another are depth 32.
    const wide = `[${Array.from({ length: 200 }, () => leaf32).join(",")}]`;
    expect(depthOf(await readJsonBody(post(wide)))).toBe(32);
    // One sibling one level deeper, first, last, or in the middle.
    for (const at of [0, 100, 199]) {
      const parts = Array.from({ length: 200 }, (_, index) => (index === at ? leaf33 : leaf32));
      await expectTooDeep(post(`[${parts.join(",")}]`), `deep sibling at ${at}`);
    }
    // Deep under a key that comes after many shallow ones.
    const keys = Array.from({ length: 500 }, (_, index) => `"k${index}":[[1]]`).join(",");
    await expectTooDeep(post(`{${keys},"last":${arrays(32)}}`), "deep under the last key");
    expect(depthOf(await readJsonBody(post(`{${keys},"last":${arrays(31)}}`)))).toBe(32);
  });

  it("brackets, quotes, and escapes inside strings neither count nor hide a bracket", async () => {
    const accepted: [string, string][] = [
      ["brackets in a value", JSON.stringify("[".repeat(5_000))],
      ["braces in a value", JSON.stringify("{".repeat(5_000))],
      ["brackets in a key", `{${JSON.stringify("[{".repeat(500))}:1}`],
      ["escaped brackets", `"${"\\u005b".repeat(500)}${"\\u007b".repeat(500)}"`],
      ["escaped quotes between brackets", `"${'\\"['.repeat(1_000)}"`],
      ["escaped backslashes before the closing quote", `["${"\\\\".repeat(999)}"]`],
      ["a backslash-u that spells a quote", `"${"\\u0022[".repeat(1_000)}"`],
      ["every simple escape", `"\\"\\\\\\/\\b\\f\\n\\r\\t[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[["`],
      ["closers in strings at depth 32", arrays(32, `"${"]".repeat(100)}","${"}".repeat(100)}"`)],
      ["openers in strings at depth 32", arrays(32, `"${"[".repeat(100)}"`)],
    ];
    for (const [name, text] of accepted) {
      const value = await readJsonBody(post(text));
      expect(depthOf(value), name).toBeLessThanOrEqual(32);
      expect(value, name).toEqual(JSON.parse(text));
    }
    // A string that ends in an escaped backslash really ends: what follows is counted.
    await expectTooDeep(post(`["\\\\",${arrays(32)}]`), "after an escaped backslash");
    await expectTooDeep(post(`["\\\\\\\\",${arrays(32)}]`), "after two escaped backslashes");
    // A string with an escaped quote does not end early or late.
    await expectTooDeep(post(`["\\"",${arrays(32)}]`), "after an escaped quote");
    await expectTooDeep(post(`{"]]]]]]]]":${arrays(32)}}`), "closers in a key do not lower it");
    await expectTooDeep(
      post(arrays(32, `"${"]".repeat(40)}",[1]`)),
      "closers in a string do not lower it",
    );
    // Blank space of every kind JSON allows, and line ends, between the brackets.
    await expectTooDeep(post(`${"[ \t\r\n".repeat(33)}${"]\n".repeat(33)}`), "blank space");
    const padded = `${" ".repeat(50_000)}${arrays(32)}${"\n".repeat(50_000)}`;
    expect(depthOf(await readJsonBody(post(padded, JSON_HEADERS), CEILING))).toBe(32);
  });

  it("no document that is handed out is deeper than 32: randomly built documents", async () => {
    // Documents built with a known depth from the characters the scanner has to tell apart.
    let seed = 0x5ec023;
    const random = (below: number): number => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return (seed >>> 8) % below;
    };
    const alphabet = ["[", "]", "{", "}", '"', "\\", "u", "0", "5", "b", ",", ":", " ", "ก"];
    const text = (): string =>
      Array.from({ length: random(12) }, () => alphabet[random(alphabet.length)] ?? "").join("");
    const build = (depth: number): unknown => {
      if (depth === 0) return random(2) === 0 ? text() : random(100);
      const inner = build(depth - 1);
      if (random(2) === 0) return [text(), inner, text()];
      return { [text()]: text(), [`${text()}!`]: inner };
    };
    let accepted = 0;
    let refused = 0;
    for (let round = 0; round < 1_500; round += 1) {
      const depth = 28 + random(9);
      const value = build(depth);
      const body = random(3) === 0 ? JSON.stringify(value, null, 1) : JSON.stringify(value);
      expect(depthOf(value)).toBe(depth);
      const outcome = await readJsonBody(post(body), CEILING).then(
        (parsed) => ({ parsed }),
        (error: unknown) => ({ error }),
      );
      if (depth <= 32) {
        expect("parsed" in outcome && outcome.parsed, body).toEqual(value);
        accepted += 1;
      } else {
        expect("error" in outcome && isAppError(outcome.error) && outcome.error.status, body).toBe(
          400,
        );
        refused += 1;
      }
    }
    // Both sides of the limit were exercised.
    expect(accepted).toBeGreaterThan(400);
    expect(refused).toBeGreaterThan(400);
  });

  it("a text that is too deep and also not JSON gets one 400, decided before the parser", async () => {
    // Depth is judged on the brackets as written, so these never reach the parser.
    await expectTooDeep(post("[".repeat(33)), "unclosed");
    await expectTooDeep(post(`${"[".repeat(33)}${MARKER}`), "garbage inside");
    await expectTooDeep(post(`${"{".repeat(33)}`), "braces without keys");
    await expectTooDeep(post(`${"[".repeat(33)}${"}".repeat(33)}`), "wrong closers");
    await expectTooDeep(post(`${"]".repeat(500)}${"[".repeat(33)}`), "closers first");
    // Not too deep and not JSON: the ordinary answer.
    for (const text of [
      "[".repeat(32),
      `${"[".repeat(32)}${"}".repeat(32)}`,
      `"${"[".repeat(5_000)}`,
      `${"]".repeat(500)}`,
      `${arrays(32)}${arrays(32)}`,
    ]) {
      expect((await appError(readJsonBody(post(text)))).toPublic()).toEqual(NOT_JSON);
    }
  });

  it("413 comes first: a body over the size limit is never judged for its depth", async () => {
    const deep = arrays(600);
    expect((await appError(readJsonBody(post(deep), { maxBytes: 1_000 }))).status).toBe(413);
    const declared = post(arrays(40), { ...JSON_HEADERS, "content-length": "999999999" });
    expect((await appError(readJsonBody(declared))).status).toBe(413);
    // At the limit exactly, it is read and then refused for its depth.
    await expectTooDeep(post(deep), "exactly the limit", { maxBytes: 1_200 });
  });

  it("the largest documents an endpoint can receive are answered, never a server error", async () => {
    const megabyte = MAX_JSON_BODY_LIMIT_BYTES;
    // The shapes that used to parse (524,288 levels) or to cost the parser a deep descent.
    await expectTooDeep(post(arrays(megabyte / 2)), "524,288 arrays", CEILING);
    await expectTooDeep(post("[".repeat(megabyte)), "a megabyte of openers", CEILING);
    await expectTooDeep(post('{"k":'.repeat(200_000)), "200,000 objects", CEILING);
    // The largest accepted documents: flat, at the limit of depth, and one long string.
    const flat = `[${"0,".repeat((megabyte - 4) / 2)}0]`;
    expect(encode(flat).byteLength).toBe(megabyte - 1);
    expect(await readJsonBody(post(flat), CEILING)).toHaveLength((megabyte - 2) / 2);
    const comb = `[${Array.from({ length: 16_000 }, () => arrays(31)).join(",")}]`;
    expect(encode(comb).byteLength).toBeLessThanOrEqual(megabyte);
    expect(depthOf(await readJsonBody(post(comb), CEILING))).toBe(32);
    const brackets = `"${"[".repeat(megabyte - 2)}"`;
    expect(await readJsonBody(post(brackets), CEILING)).toHaveLength(megabyte - 2);
    // Strings that never end, or that are all escapes, at full size.
    for (const text of [
      `"${"\\".repeat(megabyte - 1)}`,
      `"${'\\"'.repeat((megabyte - 2) / 2)}`,
      '"'.repeat(megabyte),
      `${'"\\'.repeat(megabyte / 2)}`,
    ]) {
      const error = await appError(readJsonBody(post(text), CEILING));
      expect(error.toPublic()).toEqual(NOT_JSON);
    }
  });

  it("the check is one pass: its time follows the length of the body, for every shape", async () => {
    const megabyte = MAX_JSON_BODY_LIMIT_BYTES;
    const shapes: [string, (bytes: number) => string][] = [
      ["openers in a string", (bytes) => `"${"[".repeat(bytes - 2)}"`],
      ["escaped quotes", (bytes) => `"${'\\"'.repeat((bytes - 2) / 2)}"`],
      ["empty arrays", (bytes) => `[${"[],".repeat((bytes - 4) / 3)}[]]`],
      ["open and close at depth 32", (bytes) => arrays(31, "[],".repeat((bytes - 70) / 3) + "1")],
      ["short strings", (bytes) => `[${'"[",'.repeat((bytes - 4) / 4)}1]`],
      ["unclosed string after openers", (bytes) => `${"[".repeat(32)}"${"[".repeat(bytes - 40)}`],
    ];
    for (const [name, build] of shapes) {
      const time = async (bytes: number): Promise<number> => {
        const request = post(build(bytes));
        const started = performance.now();
        await readJsonBody(request, CEILING).catch(() => undefined);
        return performance.now() - started;
      };
      await time(megabyte / 16);
      const full = Math.min(await time(megabyte), await time(megabyte));
      // A megabyte is read, scanned, and parsed in well under a second on any machine.
      expect(full, name).toBeLessThan(1_500);
    }
  }, 60_000);

  it("a document refused for its depth is refused at the first bracket too many", async () => {
    // A megabyte whose 33rd opener is at the start costs no more than a short one.
    const started = performance.now();
    for (let round = 0; round < 20; round += 1) {
      await expectTooDeep(
        post(`${"[".repeat(33)}${" ".repeat(1_000_000)}`),
        "early refusal",
        CEILING,
      );
    }
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// SEC-024: a body that stops arriving is the client's doing (SR-05 item 10).
// ---------------------------------------------------------------------------

/** A request whose body delivers `before` chunks that carry the marker and then fails. */
function breaksOff(failure: unknown, before = 2): { request: Request; reads: () => number } {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads += 1;
        if (reads > before) controller.error(failure);
        else controller.enqueue(encode(`"${MARKER}`));
      },
    },
    { highWaterMark: 0 },
  );
  return { request: post(body), reads: () => reads };
}

/** Everything reachable from `value` through own properties, as text, for a marker search. */
function everythingIn(value: object): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") parts.push(node);
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    for (const key of Reflect.ownKeys(node)) {
      parts.push(String(key));
      visit((node as Record<PropertyKey, unknown>)[key]);
    }
  };
  visit(value);
  return parts.join("\n");
}

describe("SEC-024 re-check: a body that breaks off is a client error that keeps nothing", () => {
  const SECRET = "QZXVSOURCESECRET";

  function loudError(): Error {
    const inner = new Error(`inner ${SECRET} postgresql://user:${SECRET}@db.internal/shop`);
    const error = new Error(`socket hang up ${SECRET}`, { cause: inner });
    error.stack = `Error: ${SECRET}\n    at ${SECRET} (/srv/app/${SECRET}.js:1:1)`;
    Object.assign(error, {
      code: "ECONNRESET",
      errno: -4077,
      syscall: "read",
      address: `10.0.0.${SECRET}`,
      body: `{"password":"${SECRET}"}`,
      headers: { cookie: SECRET },
    });
    return error;
  }

  it("the status is a client error below 500 and the code is the one provisional constant", () => {
    // Provisional (docs/API_CONTRACTS.md item 8.2-13). Whatever is ruled: never a server error.
    const status = ERROR_STATUS[ABORTED_BODY_ERROR_CODE];
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    expect(ABORTED_BODY_ERROR_CODE).not.toBe("INTERNAL_ERROR");
  });

  it("the source's error is dropped: no message, stack, cause, or property of it is kept", async () => {
    const source = loudError();
    const { request, reads } = breaksOff(source);
    const error = await rejection(readJsonBody(request));
    expect(error).toBeInstanceOf(RequestBodyAbortedError);
    const aborted = error as RequestBodyAbortedError;
    expect(aborted).not.toBe(source);
    expect(aborted.status).toBe(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]);
    expect(aborted.code).toBe(ABORTED_BODY_ERROR_CODE);
    expect(aborted.cause).toBeUndefined();
    // Nothing reachable from the error is the source, a part of it, or a part of the body.
    for (const key of Reflect.ownKeys(aborted)) {
      const value = (aborted as unknown as Record<PropertyKey, unknown>)[key];
      expect(value, String(key)).not.toBe(source);
      expect(value, String(key)).not.toBe(source.cause);
    }
    const everything = `${everythingIn(aborted)}\n${String(aborted)}\n${JSON.stringify(aborted)}`;
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(MARKER);
    expect(everything).not.toContain("socket hang up");
    // Only the two labels were copied.
    expect(aborted.sourceErrorName).toBe("Error");
    expect(aborted.sourceErrorCode).toBe("ECONNRESET");
    // Nothing is read after the failure.
    expect(reads()).toBe(3);
  });

  it("the answer is below 500 and carries nothing of the body or of the source", async () => {
    const { request } = breaksOff(loudError());
    const error = await rejection(readJsonBody(request));
    const sent = await answer(error);
    expect(sent.status).toBe(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]);
    expect(sent.status).toBeLessThan(500);
    expect(sent.body.error.code).toBe(ABORTED_BODY_ERROR_CODE);
    expect(sent.body.error.code).not.toBe("INTERNAL_ERROR");
    expect(sent.text).not.toContain(SECRET);
    expect(sent.text).not.toContain(MARKER);
    expect(sent.text).not.toContain("ECONNRESET");
    expect(sent.text).not.toContain("sourceError");
    expect(sent.text).not.toContain("stack");
    // The public object has the three keys of the envelope and the request id, nothing more.
    expect(Object.keys(sent.body.error).sort()).toEqual([
      "code",
      "details",
      "message",
      "requestId",
    ]);
  });

  it("the log gets exactly one warn line: fixed message, two labels, no stack, no address", async () => {
    const { request } = breaksOff(loudError());
    const sent = await answer(await rejection(readJsonBody(request)));
    expect(sent.lines).toHaveLength(1);
    const line = sent.lines[0] ?? {};
    expect(line.level).toBe("warn");
    expect(line.message).toBe("Request body was not received completely");
    expect(line.sourceError).toBe("Error");
    expect(line.sourceCode).toBe("ECONNRESET");
    expect(line.code).toBe(ABORTED_BODY_ERROR_CODE);
    expect(line.status).toBe(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]);
    // No key beyond those, the time, the level, the message, and the request id.
    const allowed = new Set([
      "level",
      "time",
      "timestamp",
      "message",
      "msg",
      "requestId",
      "code",
      "status",
      "sourceError",
      "sourceCode",
    ]);
    expect(Object.keys(line).filter((key) => !allowed.has(key))).toEqual([]);
    expect(sent.raw).not.toContain(SECRET);
    expect(sent.raw).not.toContain(MARKER);
    expect(sent.raw).not.toContain("socket hang up");
    expect(sent.raw).not.toMatch(/stack|clientIp|\bat \S+ \(|db\.internal|cookie/);
  });

  it("nothing a client can cause by dropping the connection is logged at error level", async () => {
    const failures: unknown[] = [
      loudError(),
      new TypeError("terminated", { cause: Object.assign(new Error(SECRET), { code: "UND_ERR" }) }),
      new DOMException(`The operation was aborted ${SECRET}`, "AbortError"),
      new RangeError(SECRET),
      SECRET,
      42,
      null,
      undefined,
      { message: SECRET, stack: SECRET },
      Object.create(null),
      Symbol(SECRET),
      () => SECRET,
    ];
    for (const failure of failures) {
      for (const before of [0, 1, 5]) {
        const { request, reads } = breaksOff(failure, before);
        const error = await rejection(readJsonBody(request));
        expect(error).toBeInstanceOf(RequestBodyAbortedError);
        expect(reads()).toBe(before + 1);
        const sent = await answer(error);
        expect(sent.status).toBeLessThan(500);
        expect(sent.lines).toHaveLength(1);
        expect(sent.lines[0]?.level).toBe("warn");
        expect(`${sent.text}\n${sent.raw}`).not.toContain(SECRET);
        expect(`${sent.text}\n${sent.raw}`).not.toContain(MARKER);
      }
    }
  });

  it("a source error that fights back cannot make the read a server error or run twice", async () => {
    let nameReads = 0;
    const hostile: unknown[] = [
      Object.defineProperties(new Error("x"), {
        name: {
          get() {
            nameReads += 1;
            throw new Error(SECRET);
          },
        },
        code: {
          get() {
            throw new Error(SECRET);
          },
        },
      }),
      new Proxy(new Error("x"), {
        get() {
          throw new RangeError(SECRET);
        },
      }),
      Object.assign(new Error("x"), { name: 12, code: { toString: () => SECRET } }),
      Object.assign(new Error("x"), { name: "", code: "" }),
      Object.assign(new Error("x"), { code: Number.NaN }),
      Object.assign(new Error("x"), { code: Number.POSITIVE_INFINITY }),
    ];
    for (const failure of hostile) {
      const { request } = breaksOff(failure);
      const error = await rejection(readJsonBody(request));
      expect(error).toBeInstanceOf(RequestBodyAbortedError);
      const sent = await answer(error);
      expect(sent.status).toBeLessThan(500);
      expect(sent.lines).toHaveLength(1);
      expect(sent.lines[0]?.level).toBe("warn");
      expect(`${sent.text}\n${sent.raw}`).not.toContain(SECRET);
    }
    expect(nameReads).toBe(1);
  });

  it("labels are short, and what the logger knows as a secret is masked in them", async () => {
    const long = "N".repeat(5_000);
    const { request } = breaksOff(Object.assign(new Error("x"), { name: long, code: long }));
    const sent = await answer(await rejection(readJsonBody(request)));
    const line = sent.lines[0] ?? {};
    expect(String(line.sourceError).length).toBeLessThanOrEqual(64);
    expect(String(line.sourceCode).length).toBeLessThanOrEqual(64);
    expect(sent.raw.length).toBeLessThan(600);
    // A numeric code is written as its digits.
    const numeric = breaksOff(Object.assign(new Error("x"), { code: -4077 }));
    const numericLine = (await answer(await rejection(readJsonBody(numeric.request)))).lines[0];
    expect(numericLine?.sourceCode).toBe("-4077");
    // Shapes the logger masks stay masked under these keys; a line end cannot start a new line.
    for (const label of [
      `password=${SECRET}`,
      `https://user:${SECRET}@host.example/`,
      `Bearer ${SECRET}${SECRET}`,
      `${SECRET.toLowerCase()}@example.com`,
    ]) {
      const probe = breaksOff(Object.assign(new Error("x"), { name: label, code: label }));
      const raw = (await answer(await rejection(readJsonBody(probe.request)))).raw;
      expect(raw.toLowerCase(), label).not.toContain(SECRET.toLowerCase());
    }
    const split = breaksOff(Object.assign(new Error("x"), { name: 'a\n{"level":"error"}\u2028b' }));
    const splitRaw = (await answer(await rejection(readJsonBody(split.request)))).raw;
    expect(splitRaw.split("\n")).toHaveLength(1);
    expect(splitRaw).not.toContain("\u2028");
  });

  // SEC-027 (OPEN, Low). The two labels are whatever strings the source's error carries, cut to
  // 64 characters; nothing checks that they have the form of a class name or an error code. The
  // runtime sets both today, so no caller can choose them from the network; the helper itself
  // does not enforce that, and it is the reader the upload task will reuse.
  it("SEC-027 a label that is not a class name or an error code is not written", async () => {
    const text = `${MARKER} free text, 0812345678, 12 Sukhumvit Road`;
    const { request } = breaksOff(Object.assign(new Error("x"), { name: text, code: text }));
    const sent = await answer(await rejection(readJsonBody(request)));
    expect(sent.lines).toHaveLength(1);
    expect(sent.raw).not.toContain(MARKER);
    expect(sent.raw).not.toContain("Sukhumvit");
  });

  it("the reader's own refusals stay server faults at error level", async () => {
    // A chunk that is not bytes (SR-05 item 8).
    const text = post(
      new ReadableStream<unknown>({
        start(controller) {
          controller.enqueue(`"${MARKER}"`);
          controller.close();
        },
      }) as ReadableStream<Uint8Array>,
    );
    // More empty chunks than the allowance (SR-05 item 9).
    let pulls = 0;
    const empty = post(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(new Uint8Array(0));
          },
        },
        { highWaterMark: 0 },
      ),
    );
    // A body that was read before.
    const used = post("{}");
    await used.text();
    for (const [name, request] of [
      ["not bytes", text],
      ["empty chunks", empty],
      ["already read", used],
    ] as const) {
      const error = await rejection(readJsonBody(request));
      expect(error, name).toBeInstanceOf(TypeError);
      expect(error, name).not.toBeInstanceOf(AppError);
      const sent = await answer(error);
      expect(sent.status, name).toBe(500);
      expect(sent.body.error.code, name).toBe("INTERNAL_ERROR");
      expect(sent.lines, name).toHaveLength(1);
      expect(sent.lines[0]?.level, name).toBe("error");
      expect(`${sent.text}\n${sent.raw}`, name).not.toContain(MARKER);
    }
    expect(pulls).toBe(MAX_EMPTY_BODY_CHUNKS + 1);
  }, 30_000);

  it("a body that only ends early is judged as what arrived, and other refusals are unchanged", async () => {
    // The stream closes in the middle of a document without failing: not JSON, no log line.
    const error = await appError(readJsonBody(chunked([encode(`{"note":"${MARKER}`)])));
    expect(error).not.toBeInstanceOf(RequestBodyAbortedError);
    expect(error.toPublic()).toEqual(NOT_JSON);
    expect((await answer(error)).lines).toHaveLength(0);
    // A failure after the limit was passed is never reached: 413 comes first, with no line.
    let reads = 0;
    const large = post(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads += 1;
            if (reads > 3) controller.error(new Error(SECRET));
            else controller.enqueue(new Uint8Array(600).fill(0x20));
          },
        },
        { highWaterMark: 0 },
      ),
    );
    const tooLarge = await appError(readJsonBody(large, { maxBytes: 1_000 }));
    expect(tooLarge.status).toBe(413);
    expect((await answer(tooLarge)).lines).toHaveLength(0);
    // An error class of the same name built by a caller gets no special treatment.
    const lookAlike = Object.assign(new Error(SECRET), { name: "RequestBodyAbortedError" });
    const sent = await answer(lookAlike);
    expect(sent.status).toBe(500);
    expect(sent.lines[0]?.level).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Adjacent to SEC-022: text that no UTF-8 body can carry still arrives through an escape.
// ---------------------------------------------------------------------------

describe("SEC-028 a string that is not well-formed Unicode reaches the caller through an escape", () => {
  it("the bytes of such a body are valid UTF-8, so the strict decoder is not what stops it", () => {
    const body = '{"note":"A\\ud83dB"}';
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(encode(body))).not.toThrow();
    // What a database driver or a file would then store is a different text: U+FFFD.
    const parsed = JSON.parse(body) as { note: string };
    expect(Array.from(encode(parsed.note))).toEqual([0x41, 0xef, 0xbf, 0xbd, 0x42]);
  });

  // SEC-028 (OPEN, Low). `"\ud83d"` is valid JSON for half of a surrogate pair. The value handed
  // out is then a string that cannot be written as UTF-8: whatever encodes it (the database
  // driver, a file, a hash) replaces the half by U+FFFD, so two different bodies become one
  // stored value, which is what SR-05 item 11 exists to prevent.
  it("SEC-028 a lone surrogate escape is refused or never handed out", async () => {
    for (const body of [
      '{"note":"A\\ud83dB"}',
      '{"note":"\\udc00"}',
      '{"A\\ud800":1}',
      '["\\ud83d\\ud83d"]',
      '"\\udc00\\ud800"',
    ]) {
      const outcome = await readJsonBody(post(body)).then(
        (value) => JSON.stringify(value),
        (error: unknown) => (isAppError(error) && error.status === 400 ? "refused" : "fault"),
      );
      expect(outcome, body).not.toBe("fault");
      if (outcome !== "refused") expect(outcome.isWellFormed(), body).toBe(true);
      expect(outcome === "refused" || !/\\ud[89a-f]/i.test(outcome), body).toBe(true);
    }
    // A complete pair written as two escapes is ordinary text and stays accepted.
    expect(await readJsonBody(post('"\\ud83d\\ude00"'))).toBe("\u{1F600}");
  });
});

// ---------------------------------------------------------------------------
// CR-09: the handler pattern against docs/API_CONTRACTS.md section 1.8 (SR-05 item 5).
// ---------------------------------------------------------------------------

describe("CR-09 re-check: the documented handler pattern is the order of refusals of section 1.8", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const source = readFileSync(join(root, "src/server/http.ts"), "utf8");
  const comment = source.slice(0, source.indexOf("\nimport "));
  const contract = readFileSync(join(root, "docs/API_CONTRACTS.md"), "utf8");

  /** Step number to the refusal cell of the table in section 1.8. */
  function contractSteps(): Map<number, string> {
    const start = contract.indexOf("**The order of refusals**");
    const table = contract.slice(start, contract.indexOf("- **Steps 1 to 5", start));
    const steps = new Map<number, string>();
    for (const row of table.split("\n")) {
      const cells = row.split("|").map((cell) => cell.trim());
      const step = Number(cells[1]);
      if (Number.isInteger(step) && step > 0) steps.set(step, cells[3] ?? "");
    }
    return steps;
  }

  it("the contract still has the ten steps this check was written against", () => {
    const steps = contractSteps();
    expect([...steps.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(steps.get(1)).toContain("403 FORBIDDEN");
    expect(steps.get(2)).toContain("415 UNSUPPORTED_MEDIA_TYPE");
    expect(steps.get(3)).toContain("401 UNAUTHENTICATED");
    expect(steps.get(4)).toMatch(/403 FORBIDDEN.*403 SELLER_NOT_APPROVED/);
    expect(steps.get(5)).toContain("429 RATE_LIMITED");
    expect(steps.get(6)).toContain("413 PAYLOAD_TOO_LARGE");
    expect(steps.get(7)).toContain("400 VALIDATION_ERROR");
    expect(steps.get(8)).toContain("403 SELLER_NOT_APPROVED");
    expect(steps.get(9)).toContain("404 NOT_FOUND");
  });

  it("each line of the pattern names the step and the refusal the contract gives that step", () => {
    const steps = contractSteps();
    const lines: [string, number, string][] = [
      ["assertSameOrigin(request, appOrigin)", 1, "403 FORBIDDEN"],
      ["assertContentType(request, JSON_CONTENT_TYPE)", 2, "415 UNSUPPORTED_MEDIA_TYPE"],
      ["await requireActor(request)", 3, "401 UNAUTHENTICATED"],
      ['assertRole(actor, "SELLER")', 4, "403 FORBIDDEN"],
      ["assertStoreApproved(actor)", 4, "403 SELLER_NOT_APPROVED"],
      ["rateLimiter.consume(actor.userId", 5, ""],
      ["throw rateLimited(limit.retryAfterSeconds)", 5, "429 RATE_LIMITED"],
      ["await readJsonBody(request)", 6, "413"],
      ["parseInput(bodySchema, body)", 7, "400 VALIDATION_ERROR"],
      ["await service(actor, input)", 8, ""],
    ];
    let last = -1;
    let lastStep = 0;
    for (const [call, step, refusal] of lines) {
      const at = comment.indexOf(call);
      expect(at, call).toBeGreaterThan(last);
      last = at;
      expect(step, call).toBeGreaterThanOrEqual(lastStep);
      lastStep = step;
      const line = comment.slice(at, comment.indexOf("\n", at));
      if (line.includes("step")) expect(line, call).toMatch(new RegExp(`steps? ${step}\\b`));
      expect(line, call).toContain(refusal);
      if (refusal !== "") {
        expect(steps.get(step), call).toContain(refusal.split(" ")[0] ?? "");
        const code = refusal.split(" ")[1];
        if (code !== undefined) expect(steps.get(step), call).toContain(code);
      }
    }
    // The role is judged before the store status, and both before the rate limit (D-032 point 1).
    expect(comment.indexOf("assertRole(")).toBeLessThan(comment.indexOf("assertStoreApproved("));
    expect(comment.indexOf("assertStoreApproved(")).toBeLessThan(
      comment.indexOf("rateLimiter.consume("),
    );
    // Everything from the origin check on is inside the `try` that ends in `errorResponse`.
    expect(comment.indexOf("try {")).toBeLessThan(comment.indexOf("assertSameOrigin(request"));
    expect(comment.indexOf("} catch (error)")).toBeGreaterThan(comment.indexOf("await service("));
  });

  it("nothing in the pattern touches the body before step 6, and the withdrawn order is gone", () => {
    const pattern = comment.slice(
      comment.indexOf("const requestId = resolveRequestId"),
      comment.indexOf("What the pattern fixes"),
    );
    const beforeBody = pattern.slice(0, pattern.indexOf("const body = await readJsonBody"));
    expect(beforeBody.length).toBeGreaterThan(400);
    expect(beforeBody).not.toMatch(/\bbody\b|\.json\(|\.text\(|\.formData\(|parseInput/);
    // The limit is counted on the user from the session, never on something the request names.
    expect(beforeBody).toContain("rateLimiter.consume(actor.userId,");
    expect(comment).not.toContain("requireUser");
    expect(comment).not.toContain("origin check, content-type check, size-limited read");
    // The pattern never reads the environment itself.
    expect(pattern).not.toContain("process.env");
  });

  it("no route handler reads a body by itself (SR-05 item 1)", () => {
    const handlers: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/^route\.tsx?$/.test(entry.name)) handlers.push(path);
      }
    };
    walk(join(root, "src/app"));
    // The health endpoint exists; the check must not pass because it found no file.
    expect(handlers.length).toBeGreaterThan(0);
    for (const path of handlers) {
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, path).not.toMatch(
        /\b(?:request|req)\s*\.\s*(?:json|text|formData|arrayBuffer|blob|bytes)\s*\(/,
      );
      expect(code, path).not.toMatch(/\b(?:request|req)\s*\.\s*body\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// CR-02: conflict(reason).
// ---------------------------------------------------------------------------

describe("CR-02 re-check: a CONFLICT reason is a fixed word, never text from a request", () => {
  it("a reason that is not an upper-case word is a programming error that names nothing of it", () => {
    const hostile: unknown[] = [
      `${MARKER} sku 'A-1' already exists`,
      "duplicate_sku",
      "DUPLICATE SKU",
      "DUPLICATE_SKU\n",
      "\nDUPLICATE_SKU",
      "DUPLICATE__SKU",
      "_DUPLICATE",
      "DUPLICATE_",
      "1DUPLICATE",
      "DUPLICATE-SKU",
      "DUPLICATE_SKU\u2028",
      "ＤＵＰＬＩＣＡＴＥ",
      `A${"_A".repeat(40)}`,
      "",
      undefined,
      null,
      42,
      { toString: () => "DUPLICATE_SKU" },
      ["DUPLICATE_SKU"],
    ];
    for (const reason of hostile) {
      let thrown: unknown;
      try {
        conflict(reason as string);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, String(reason)).toBeInstanceOf(TypeError);
      expect(thrown, String(reason)).not.toBeInstanceOf(AppError);
      expect(String(thrown)).not.toContain(MARKER);
    }
  });

  it("the details are the reason alone, whatever the options carry, and the cause stays inside", async () => {
    const options = {
      details: { reason: MARKER, fields: [MARKER], sku: MARKER },
      cause: new Error(`unique constraint ${MARKER}`),
    } as unknown as { cause: unknown };
    const error = conflict("DUPLICATE_SKU", options);
    expect(error.status).toBe(409);
    expect(error.toPublic()).toEqual({
      code: "CONFLICT",
      message: "The request conflicts with existing data.",
      details: { reason: "DUPLICATE_SKU" },
    });
    const sent = await answer(error);
    expect(sent.status).toBe(409);
    expect(sent.text).not.toContain(MARKER);
    // The cause is for the operator: one warn line, never an error-level one.
    expect(sent.lines).toHaveLength(1);
    expect(sent.lines[0]?.level).toBe("warn");
  });
});
