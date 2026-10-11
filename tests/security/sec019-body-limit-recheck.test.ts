/**
 * Independent re-check of the fix for SEC-019 (commit e2a4a7a, rule SR-05 in docs/SECURITY.md)
 * and the reproduction of SEC-020, which the re-check found. Owner: security agent.
 *
 *   it(...)  behaviour that was checked on 2026-10-11 and holds. A failure is a regression.
 *
 * SEC-020 is FIXED (re-checked 2026-10-11). Its five reproductions in the last block were
 * `it.fails` while the finding was open. The owner of the code changed them to `it` with the fix
 * and did not touch a body: the committed file with only `it.fails(` replaced by `it(`, put
 * through Prettier, is this file. They are now regression tests; nobody but the security agent
 * may edit an assertion, a threshold, or a timeout in them, or skip or delete them. The further
 * cases written for the re-check of that fix, and the reproduction of SEC-021, which that
 * re-check found, are in `sec020-bounded-buffer-recheck.test.ts`.
 *
 * Two cases were changed by the security agent on 2026-10-12, with the fixes of SEC-023 and
 * SEC-024, because they pinned the behaviour those findings replaced: "the largest accepted
 * documents do not turn into a server error" and "a body that breaks off is a client error
 * below 500 that carries nothing of the body". Each says in its body what it required before.
 * The further cases of that re-check are in `sec022-024-json-body-recheck.test.ts`.
 *
 * `readJsonBody` is called directly, and once behind a plain `node:http` server on the loopback
 * interface. No route handler exists, so nothing here goes through the framework.
 *
 * Part of `pnpm test` (project "security"). Run alone with:
 *   pnpm exec vitest run --project security
 */
import { createServer } from "node:http";
import { connect } from "node:net";
import { Readable } from "node:stream";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  ABORTED_BODY_ERROR_CODE,
  AppError,
  ERROR_STATUS,
  JSON_TOO_DEEP_FIELD_CODE,
  RequestBodyAbortedError,
} from "../../src/server/errors";
import {
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  errorResponse,
  MAX_JSON_BODY_LIMIT_BYTES,
  MAX_JSON_NESTING_DEPTH,
  readJsonBody,
} from "../../src/server/http";
import { createLogger } from "../../src/server/logger";
import { REQUEST_ID_HEADER } from "../../src/server/request-id";

const REQUEST_ID = "req_security_recheck_19";
const JSON_HEADERS: Record<string, string> = { "content-type": "application/json" };
const TOO_LARGE = {
  code: "PAYLOAD_TOO_LARGE",
  message: "The request body is too large.",
  details: {},
};

// The memory measurements need a forced collection. Resolved here, at import time, so that a
// runtime without it fails the whole file loudly instead of letting an `it.fails` test "pass"
// for the wrong reason.
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;
if (typeof collectGarbage !== "function") throw new Error("gc is not available");

/** Bytes that are still reachable: JavaScript heap plus the memory behind typed arrays. */
function liveBytes(): number {
  collectGarbage();
  collectGarbage();
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
}

function post(body: BodyInit | null, headers: Record<string, string> = JSON_HEADERS): Request {
  return new Request("https://shop.example/api/v1/cart", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

interface Taken {
  bytes: number;
  pulls: number;
  cancelled: boolean;
}

/**
 * A request whose body is produced one chunk per read, with a record of what the reader took.
 * `highWaterMark: 0` means nothing is produced ahead of a read.
 */
function streamed(
  chunks: Iterable<Uint8Array>,
  headers: Record<string, string> = JSON_HEADERS,
  cancel: () => void | Promise<void> = () => undefined,
): { request: Request; taken: Taken } {
  const iterator = chunks[Symbol.iterator]();
  const taken: Taken = { bytes: 0, pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        taken.pulls += 1;
        const next = iterator.next();
        if (next.done === true) {
          controller.close();
          return;
        }
        taken.bytes += next.value.byteLength;
        controller.enqueue(next.value);
      },
      cancel() {
        taken.cancelled = true;
        return cancel();
      },
    },
    { highWaterMark: 0 },
  );
  return { request: post(body, headers), taken };
}

function* endless(chunkBytes: number): Generator<Uint8Array> {
  for (;;) yield new Uint8Array(chunkBytes).fill(0x61);
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

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

/** "settled" when the promise settles within `ms`, "pending" otherwise. */
async function settlesWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<"settled" | "pending"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), ms);
  });
  const settled = promise.then(
    () => "settled" as const,
    () => "settled" as const,
  );
  const outcome = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return outcome;
}

describe("SEC-019 re-check: the declared length is judged before any of the body is read", () => {
  it("a declared length over the limit pulls nothing from an endless body", async () => {
    for (const [declared, maxBytes] of [
      ["102401", undefined],
      ["1048577", MAX_JSON_BODY_LIMIT_BYTES],
      ["2147483648", undefined],
      ["18446744073709551616", MAX_JSON_BODY_LIMIT_BYTES],
      ["65", 64],
    ] as const) {
      const { request, taken } = streamed(endless(4_096), {
        ...JSON_HEADERS,
        "content-length": declared,
      });
      const options = maxBytes === undefined ? {} : { maxBytes };
      const error = await appError(readJsonBody(request, options));
      expect(error.toPublic()).toEqual(TOO_LARGE);
      expect(taken).toEqual({ bytes: 0, pulls: 0, cancelled: false });
      expect(request.bodyUsed).toBe(false);
    }
  });

  it("a declared length that is not a plain decimal number is refused, never interpreted", async () => {
    // Spellings that `Number()` or `parseInt()` would read as a small number.
    for (const declared of [
      "0x1",
      "0b1",
      "0o1",
      "1_0",
      "1e0",
      "1.0",
      "-0",
      "+1",
      "1,1",
      "1 1",
      "1\t1",
      "²",
      "1 ",
      "0x",
      "null",
      "true",
      "[1]",
      "1n",
      "1;q=1",
    ]) {
      const { request, taken } = streamed(endless(1_024));
      request.headers.set("content-length", declared);
      const error = await appError(readJsonBody(request));
      expect(error.status, JSON.stringify(declared)).toBe(413);
      expect(taken.pulls, JSON.stringify(declared)).toBe(0);
    }
  });
});

describe("SEC-019 re-check: a missing or untrue length cannot get more than the limit read", () => {
  it("an endless body that declares a small length is cut off at the limit plus one chunk", async () => {
    // Every declared value is within the limit, so only the running count can refuse.
    for (const declared of [null, "0", "2", "20000"]) {
      for (const chunkBytes of [1, 1_000, 16_384]) {
        const limit = 20_000;
        const headers =
          declared === null ? JSON_HEADERS : { ...JSON_HEADERS, "content-length": declared };
        const { request, taken } = streamed(endless(chunkBytes), headers);
        const error = await appError(readJsonBody(request, { maxBytes: limit }));
        expect(error.toPublic()).toEqual(TOO_LARGE);
        expect(taken.bytes).toBeGreaterThan(limit);
        expect(taken.bytes).toBeLessThanOrEqual(limit + chunkBytes);
        expect(taken.cancelled).toBe(true);
        // Nothing more is asked of the source after the refusal.
        const pullsAtRefusal = taken.pulls;
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(taken.pulls).toBe(pullsAtRefusal);
      }
    }
  });

  it("a first chunk that is already over the limit is refused without a second read", async () => {
    const { request, taken } = streamed(endless(8 * 1024 * 1024));
    const error = await appError(readJsonBody(request));
    expect(error.status).toBe(413);
    expect(taken.pulls).toBe(1);
    expect(taken.cancelled).toBe(true);
  });

  it("the boundary is exact across chunks: the limit passes, one more byte does not", async () => {
    const limit = 3_000;
    const text = `"${"a".repeat(limit - 2)}"`;
    const bytes = encode(text);
    const split = (source: Uint8Array, size: number): Uint8Array[] => {
      const parts: Uint8Array[] = [];
      for (let at = 0; at < source.byteLength; at += size) parts.push(source.slice(at, at + size));
      return parts;
    };
    for (const size of [1, 7, 1_000, 2_999, 3_000]) {
      const exact = streamed(split(bytes, size));
      expect(await readJsonBody(exact.request, { maxBytes: limit })).toHaveLength(limit - 2);
      // The same body followed by a single blank, which is still valid JSON.
      const over = streamed([...split(bytes, size), Uint8Array.of(0x20)]);
      const error = await appError(readJsonBody(over.request, { maxBytes: limit }));
      expect(error.status).toBe(413);
      expect(over.taken.cancelled).toBe(true);
    }
  });

  it("the default limit applies when no option is passed, and the ceiling cannot be raised", async () => {
    const { request, taken } = streamed(endless(1_024));
    expect((await appError(readJsonBody(request))).status).toBe(413);
    expect(taken.bytes).toBe(DEFAULT_JSON_BODY_LIMIT_BYTES + 1_024);
    for (const maxBytes of [MAX_JSON_BODY_LIMIT_BYTES + 1, Number.MAX_SAFE_INTEGER, Infinity]) {
      const probe = streamed(endless(1_024));
      const error = await rejection(readJsonBody(probe.request, { maxBytes }));
      expect(error).toBeInstanceOf(TypeError);
      expect(probe.taken.pulls).toBe(0);
    }
  });
});

describe("SEC-019 re-check: the limit counts bytes, not characters", () => {
  it("Thai text that fits the limit in characters but not in bytes is refused", async () => {
    // 40,000 Thai characters: 40,002 characters of JSON, 120,002 bytes.
    const thai = "ก".repeat(40_000);
    const body = JSON.stringify(thai);
    expect(body.length).toBeLessThan(DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect(encode(body).byteLength).toBe(120_002);
    expect((await appError(readJsonBody(post(body)))).toPublic()).toEqual(TOO_LARGE);
    // Declaring the length in characters does not help.
    const lying = post(body, { ...JSON_HEADERS, "content-length": String(body.length) });
    expect((await appError(readJsonBody(lying))).status).toBe(413);
    // Streamed without a length, it is cut off rather than read to the end.
    const { request, taken } = streamed(
      (function* () {
        const bytes = encode(body);
        for (let at = 0; at < bytes.byteLength; at += 3_000) yield bytes.slice(at, at + 3_000);
      })(),
    );
    expect((await appError(readJsonBody(request))).status).toBe(413);
    expect(taken.bytes).toBeLessThanOrEqual(DEFAULT_JSON_BODY_LIMIT_BYTES + 3_000);
    expect(taken.bytes).toBeLessThan(120_002);
  });

  it("Thai text of exactly the limit in bytes passes and comes back unchanged", async () => {
    // 34,132 characters of three bytes, two quotes, and two blanks: 102,400 bytes.
    const thai = "กุ้ง".repeat(8_533);
    const body = `${JSON.stringify(thai)}  `;
    expect(encode(body).byteLength).toBe(DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect(await readJsonBody(post(body))).toBe(thai);
    expect((await appError(readJsonBody(post(`${body} `)))).status).toBe(413);
  });

  it("four-byte characters and a byte order mark are counted as the bytes they are", async () => {
    // U+1F600 is two UTF-16 units and four UTF-8 bytes.
    const emoji = "\u{1F600}".repeat(10);
    const body = JSON.stringify(emoji);
    expect(body).toHaveLength(22);
    expect(encode(body).byteLength).toBe(42);
    expect(await readJsonBody(post(body), { maxBytes: 42 })).toBe(emoji);
    for (const maxBytes of [41, 22, 12, 10]) {
      expect((await appError(readJsonBody(post(body), { maxBytes }))).status).toBe(413);
    }
    // A byte order mark is three more bytes and is not part of the parsed value.
    const withMark = new Uint8Array([0xef, 0xbb, 0xbf, ...encode("{}")]);
    expect(await readJsonBody(post(withMark), { maxBytes: 5 })).toEqual({});
    expect((await appError(readJsonBody(post(withMark), { maxBytes: 4 }))).status).toBe(413);
  });
});

describe("SEC-019 re-check: the refusal is a 413 in the standard envelope", () => {
  it("both refusals give the same response and write no log line and nothing of the body", async () => {
    const marker = "QZXVMARKER";
    const body = `{"note":"${marker}${"a".repeat(200_000)}"}`;
    const refusedByLength = post(body, { ...JSON_HEADERS, "content-length": "200021" });
    const refusedWhileReading = streamed([encode(body)]).request;
    for (const request of [refusedByLength, refusedWhileReading]) {
      const error = await appError(readJsonBody(request));
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain(marker);
      const lines: string[] = [];
      const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
      const response = errorResponse(error, { requestId: REQUEST_ID, logger: log });
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get(REQUEST_ID_HEADER)).toBe(REQUEST_ID);
      expect(response.headers.get("content-type")).toContain("application/json");
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: { ...TOO_LARGE, requestId: REQUEST_ID } });
      expect(text).not.toContain(marker);
      expect(lines).toHaveLength(0);
    }
  });

  it("the largest accepted documents do not turn into a server error", async () => {
    // Changed on 2026-10-12 with the fix of SEC-023 (SR-05 item 12). Until then this case
    // required 524,288 nested arrays at the ceiling to parse. Such a document is now refused:
    // the answer is still never a server error, and it is the exact refusal of the nesting limit.
    const options = { maxBytes: MAX_JSON_BODY_LIMIT_BYTES };
    const nested = (depth: number): string => `${"[".repeat(depth)}${"]".repeat(depth)}`;
    const tooDeep = {
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      details: {
        fields: [
          {
            path: "",
            // Provisional (docs/API_CONTRACTS.md item 8.2-12): the one constant, whatever is ruled.
            code: JSON_TOO_DEEP_FIELD_CODE,
            message: "The request body nests arrays and objects more than 32 levels deep.",
          },
        ],
      },
    };
    for (const depth of [524_288, 51_200, 33]) {
      const error = await appError(readJsonBody(post(nested(depth)), options));
      expect(error.status, String(depth)).toBe(400);
      expect(error.toPublic(), String(depth)).toEqual(tooDeep);
      expect(error.cause, String(depth)).toBeUndefined();
      const lines: string[] = [];
      const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
      const response = errorResponse(error, { requestId: REQUEST_ID, logger: log });
      expect(response.status, String(depth)).toBe(400);
      expect(lines, String(depth)).toHaveLength(0);
    }
    // The limit itself: 32 levels are accepted, at the default limit and at the ceiling.
    expect(MAX_JSON_NESTING_DEPTH).toBe(32);
    let deepest: unknown = await readJsonBody(post(nested(32)));
    let levels = 0;
    while (Array.isArray(deepest)) {
      levels += 1;
      deepest = deepest[0];
    }
    expect(levels).toBe(32);
    expect(Array.isArray(await readJsonBody(post(nested(32)), options))).toBe(true);
    // The largest documents that are accepted at the ceiling are answered, not a server error:
    // a flat array of 524,287 numbers, and 16,000 arrays of depth 31 inside one array.
    const flat = `[${"0,".repeat(524_286)}0]`;
    expect(encode(flat).byteLength).toBe(MAX_JSON_BODY_LIMIT_BYTES - 1);
    expect(await readJsonBody(post(flat), options)).toHaveLength(524_287);
    const comb = `[${Array.from({ length: 16_000 }, () => nested(31)).join(",")}]`;
    expect(encode(comb).byteLength).toBeLessThanOrEqual(MAX_JSON_BODY_LIMIT_BYTES);
    expect(await readJsonBody(post(comb), options)).toHaveLength(16_000);
    // A megabyte of opening brackets: refused for its depth before the parser sees it.
    const unclosed = "[".repeat(MAX_JSON_BODY_LIMIT_BYTES);
    const unclosedError = await appError(readJsonBody(post(unclosed), options));
    expect(unclosedError.status).toBe(400);
    expect(unclosedError.toPublic()).toEqual(tooDeep);
  });
});

describe("SEC-019 re-check: failure and abort while reading", () => {
  it("a source that rejects the cancellation still gets the 413", async () => {
    const { request, taken } = streamed(endless(4_096), JSON_HEADERS, () => {
      throw new Error("cancel refused");
    });
    expect((await appError(readJsonBody(request, { maxBytes: 1_000 }))).status).toBe(413);
    expect(taken.cancelled).toBe(true);
  });

  it("a body that breaks off is a client error below 500 that carries nothing of the body", async () => {
    // Changed on 2026-10-12 with the fix of SEC-024 (SR-05 item 10). Until then this case
    // required a server-side error and a 500. The half that checks that nothing of the body is
    // kept is unchanged; the other half now requires the opposite of what it did.
    const marker = "QZXVMARKER";
    const sourceMarker = "QZXVSOURCE";
    let reads = 0;
    const source = new Error(`aborted ${sourceMarker}`, { cause: new Error(sourceMarker) });
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads += 1;
          if (reads === 3) controller.error(source);
          else controller.enqueue(encode(`"${marker}`));
        },
      },
      { highWaterMark: 0 },
    );
    const error = await rejection(readJsonBody(post(body)));
    // The client's doing: a client error of its own class, not the source's error passed on.
    expect(error).toBeInstanceOf(RequestBodyAbortedError);
    expect(error).not.toBe(source);
    const aborted = error as RequestBodyAbortedError;
    // Provisional (docs/API_CONTRACTS.md item 8.2-13): the one constant, and never a 5xx.
    expect(aborted.code).toBe(ABORTED_BODY_ERROR_CODE);
    expect(aborted.status).toBe(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]);
    expect(aborted.status).toBeGreaterThanOrEqual(400);
    expect(aborted.status).toBeLessThan(500);
    expect(aborted.cause).toBeUndefined();
    for (const text of [String(error), JSON.stringify(error), String(aborted.stack)]) {
      expect(text).not.toContain(marker);
      expect(text).not.toContain(sourceMarker);
    }
    const lines: string[] = [];
    const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const response = errorResponse(error, { requestId: REQUEST_ID, logger: log });
    expect(response.status).toBe(aborted.status);
    expect(response.status).not.toBe(500);
    const text = await response.text();
    expect((JSON.parse(text) as { error: { code: string } }).error.code).not.toBe("INTERNAL_ERROR");
    expect(text).not.toContain(marker);
    expect(text).not.toContain(sourceMarker);
    // One line, at warn level, with no stack and nothing of the body or of the source's message.
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] ?? "{}") as { level?: string }).level).toBe("warn");
    expect(lines.join("\n")).not.toContain(marker);
    expect(lines.join("\n")).not.toContain(sourceMarker);
    expect(lines.join("\n")).not.toMatch(/"stack"|\bat \S+ \(/);
    // Nothing is read after the failure.
    expect(reads).toBe(3);
  });

  it("an endless chunked body sent over a real connection is cut off at the limit", async () => {
    const seen = { bytes: 0 };
    let outcome: unknown;
    let finished: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const server = createServer((incoming) => {
      incoming.on("data", (chunk: Buffer) => {
        seen.bytes += chunk.byteLength;
      });
      incoming.on("error", () => undefined);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const request = post(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
        "content-type": headers.get("content-type") ?? "",
      });
      void readJsonBody(request)
        .then(
          () => "accepted",
          (error: unknown) => error,
        )
        .then((result) => {
          outcome = result;
          finished();
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");

    const socket = connect(address.port, "127.0.0.1");
    socket.on("error", () => undefined);
    let sent = 0;
    const chunk = `1000\r\n${"a".repeat(4_096)}\r\n`;
    socket.write(
      "POST /x HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n" +
        "Transfer-Encoding: chunked\r\n\r\n",
    );
    const timer = setInterval(() => {
      if (socket.destroyed || sent >= 8 * 1024 * 1024) return;
      socket.write(chunk);
      sent += 4_096;
    }, 1);
    try {
      expect(await settlesWithin(done, 10_000)).toBe("settled");
      expect(outcome).toBeInstanceOf(AppError);
      expect((outcome as AppError).status).toBe(413);
      const atRefusal = seen.bytes;
      expect(atRefusal).toBeGreaterThan(DEFAULT_JSON_BODY_LIMIT_BYTES);
      // One network read is at most 64 KiB.
      expect(atRefusal).toBeLessThanOrEqual(DEFAULT_JSON_BODY_LIMIT_BYTES + 65_536);
      // The sender keeps going; the server takes no more of it.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(seen.bytes).toBe(atRefusal);
    } finally {
      clearInterval(timer);
      socket.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20_000);
});

// ---------------------------------------------------------------------------
// Finding registered by the re-check of 2026-10-11 and FIXED the same day (re-checked). These
// five were its reproductions and are now regression tests. Owner of the code: backend-api.
// The comments "Observed on 2026-10-11" inside them give the numbers measured before the fix.
// ---------------------------------------------------------------------------

describe("SEC-020 the memory held while reading a body grows with the number of chunks", () => {
  /**
   * Reads a body made of `count` chunks of `chunkBytes` bytes that stalls before its last chunk,
   * as a slow client would, and returns how many bytes were reachable at that moment beyond
   * what was reachable before the request.
   */
  async function heldWhileStalled(
    count: number,
    chunkBytes: number,
    maxBytes: number,
  ): Promise<number> {
    let sent = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => undefined;
    const stalled = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          if (sent === count) {
            reached();
            await gate;
            controller.enqueue(encode("1"));
            controller.close();
            return;
          }
          sent += 1;
          controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
        },
      },
      { highWaterMark: 0 },
    );
    const before = liveBytes();
    const pending = readJsonBody(post(body), { maxBytes });
    await stalled;
    const held = liveBytes() - before;
    release();
    expect(await pending).toBe(1);
    return held;
  }

  it("a default-size body in one-byte chunks holds little more than its own size", async () => {
    // 102,399 one-byte chunks. Observed on 2026-10-11: about 24 MB held, 240 times the body.
    const held = await heldWhileStalled(
      DEFAULT_JSON_BODY_LIMIT_BYTES - 1,
      1,
      DEFAULT_JSON_BODY_LIMIT_BYTES,
    );
    expect(held).toBeLessThan(4 * 1024 * 1024);
  });

  it("a ceiling-size body in one-byte chunks holds little more than its own size", async () => {
    // 1,048,575 one-byte chunks. Observed on 2026-10-11: about 245 MB held for one request.
    const held = await heldWhileStalled(
      MAX_JSON_BODY_LIMIT_BYTES - 1,
      1,
      MAX_JSON_BODY_LIMIT_BYTES,
    );
    expect(held).toBeLessThan(8 * 1024 * 1024);
  }, 60_000);

  it("empty chunks are not kept: they never count towards the limit", async () => {
    // 200,000 chunks of no bytes at all are far below every limit and are all retained.
    const held = await heldWhileStalled(200_000, 0, DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect(held).toBeLessThan(4 * 1024 * 1024);
  }, 60_000);

  it("chunks that are not bytes are refused instead of being read without a count", async () => {
    // 400 chunks of 1,000 characters against a limit of 10,000 bytes.
    let pulls = 0;
    const body = new ReadableStream<unknown>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls > 400) controller.close();
          else controller.enqueue("a".repeat(1_000));
        },
      },
      { highWaterMark: 0 },
    );
    const request = post(body as ReadableStream<Uint8Array>);
    await rejection(readJsonBody(request, { maxBytes: 10_000 }));
    // Secure: stop at the first chunk that is not bytes, or at the latest at the limit.
    expect(pulls).toBeLessThanOrEqual(11);
  });

  it("the 413 does not wait for a source that never confirms the cancellation", async () => {
    const { request } = streamed(endless(4_096), JSON_HEADERS, () => new Promise(() => undefined));
    const pending = readJsonBody(request, { maxBytes: 1_000 });
    pending.catch(() => undefined);
    expect(await settlesWithin(pending, 1_000)).toBe("settled");
  });
});
