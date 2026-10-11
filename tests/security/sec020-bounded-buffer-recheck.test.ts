/**
 * Independent re-check of the fix for SEC-020 (rule SR-05 item 8 in docs/SECURITY.md): the
 * rewritten `readBytesUpTo` in src/server/http.ts copies a body into one buffer that grows up to
 * the limit. Owner: security agent.
 *
 *   it(...)        behaviour that was checked on 2026-10-11 and holds. A failure is a regression.
 *   it.fails(...)  an OPEN finding (SEC-021). The body asserts the SECURE behaviour, which the
 *                  code does not have yet, so the assertion fails and Vitest reports the test as
 *                  passed ("expected fail"). When the owner fixes the code the test turns red;
 *                  the owner may then change `it.fails` to `it` without touching the body, and
 *                  the security agent re-checks. Nobody else may edit an assertion, skip, or
 *                  delete these.
 *
 * The five reproductions of SEC-020 itself are in `sec019-body-limit-recheck.test.ts`. The cases
 * here are the ones a single growing buffer can get wrong: the copy (offsets, growth, the cap at
 * the limit), the exact boundary at every size where the buffer grows, what counts as bytes, and
 * the memory held by many requests at once and over a real connection.
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

import { AppError } from "../../src/server/errors";
import {
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  errorResponse,
  MAX_JSON_BODY_LIMIT_BYTES,
  readJsonBody,
} from "../../src/server/http";
import { createLogger } from "../../src/server/logger";

const REQUEST_ID = "req_security_recheck_20";
const JSON_HEADERS: Record<string, string> = { "content-type": "application/json" };
/** First size of the reader's buffer (src/server/http.ts, `INITIAL_BODY_BUFFER_BYTES`). */
const FIRST_BUFFER_BYTES = 4_096;

// The memory measurements need a forced collection. Resolved at import time, so that a runtime
// without it fails the whole file loudly.
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
  pulls: number;
  cancelled: boolean;
}

/** A request whose body hands over whatever `chunks` yields, one value per read. */
function streamed(
  chunks: Iterable<unknown>,
  headers: Record<string, string> = JSON_HEADERS,
  cancel: () => void | Promise<void> = () => undefined,
): { request: Request; taken: Taken } {
  const iterator = chunks[Symbol.iterator]();
  const taken: Taken = { pulls: 0, cancelled: false };
  const body = new ReadableStream<unknown>(
    {
      pull(controller) {
        taken.pulls += 1;
        const next = iterator.next();
        if (next.done === true) controller.close();
        else controller.enqueue(next.value);
      },
      cancel() {
        taken.cancelled = true;
        return cancel();
      },
    },
    { highWaterMark: 0 },
  );
  return { request: post(body as ReadableStream<Uint8Array>, headers), taken };
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function split(source: Uint8Array, size: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < source.byteLength; at += size) parts.push(source.slice(at, at + size));
  return parts;
}

/** A JSON string document of exactly `bytes` bytes whose content never repeats in step. */
function documentOf(bytes: number): { text: string; value: string } {
  let value = "";
  let state = 0x2545f491;
  while (value.length < bytes - 2) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    value += String.fromCharCode(0x61 + ((state >>> 16) % 26));
  }
  return { text: `"${value}"`, value };
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

describe("SEC-020 re-check: the copy into one buffer loses, moves, and adds nothing", () => {
  it("a body comes back unchanged for every way of cutting it around the growth sizes", async () => {
    // Sizes on both sides of every point where the buffer grows from 4,096 up to the limit.
    for (const bytes of [1, 2, 4_095, 4_096, 4_097, 8_191, 8_192, 8_193, 16_385, 70_001, 102_400]) {
      const { text, value } = documentOf(Math.max(bytes, 3));
      const source = encode(text);
      for (const size of [1, 5, 4_095, 4_096, 4_097, 8_192, 50_000, source.byteLength]) {
        if (size === 1 && source.byteLength > 20_000) continue;
        const { request } = streamed(split(source, size));
        expect(await readJsonBody(request), `${bytes} bytes in chunks of ${size}`).toBe(value);
      }
    }
  });

  it("chunks of irregular sizes with empty ones in between come back unchanged", async () => {
    const { text, value } = documentOf(90_000);
    const source = encode(text);
    const chunks: Uint8Array[] = [];
    let state = 7;
    for (let at = 0; at < source.byteLength;) {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      // 0 to 6,000 bytes; about one in six is empty.
      const size = (state >>> 16) % 6 === 0 ? 0 : (state >>> 8) % 6_001;
      chunks.push(source.slice(at, at + size));
      at += size;
    }
    expect(chunks.some((chunk) => chunk.byteLength === 0)).toBe(true);
    expect(await readJsonBody(streamed(chunks).request)).toBe(value);
  });

  it("a source that reuses one chunk object for every read does not corrupt the body", async () => {
    // A pooled buffer: the bytes handed over are overwritten as soon as the next read starts.
    const { text, value } = documentOf(30_000);
    const source = encode(text);
    function* pooled(): Generator<Uint8Array> {
      const pool = new Uint8Array(700);
      for (let at = 0; at < source.byteLength; at += 700) {
        pool.fill(0x58);
        const part = source.subarray(at, at + 700);
        pool.set(part);
        yield pool.subarray(0, part.byteLength);
      }
      pool.fill(0x58);
    }
    expect(await readJsonBody(streamed(pooled()).request)).toBe(value);
  });

  it("a chunk that is a view into a larger buffer is counted and copied as the view only", async () => {
    const backing = encode(`XXXXXXXXXX{"quantity":2}YYYYYYYYYY${"Z".repeat(200_000)}`);
    const view = backing.subarray(10, 24);
    expect(await readJsonBody(streamed([view]).request, { maxBytes: 14 })).toEqual({ quantity: 2 });
    const buffer = Buffer.from(backing.buffer, 10, 14);
    expect(await readJsonBody(streamed([buffer]).request, { maxBytes: 14 })).toEqual({
      quantity: 2,
    });
  });

  it("two bodies read at the same time do not share a buffer", async () => {
    const first = documentOf(50_000);
    const second = { text: `"${"ก".repeat(16_000)}"`, value: "ก".repeat(16_000) };
    const interleaved = await Promise.all([
      readJsonBody(streamed(split(encode(first.text), 333)).request),
      readJsonBody(streamed(split(encode(second.text), 1_000)).request),
      readJsonBody(streamed(split(encode(first.text), 4_096)).request),
    ]);
    expect(interleaved).toEqual([first.value, second.value, first.value]);
  });
});

describe("SEC-020 re-check: the limit is exact wherever the buffer grows or is capped", () => {
  it("a body of exactly the limit passes and one more byte is refused, for every limit", async () => {
    const limits = [
      1,
      2,
      3,
      4_095,
      4_096,
      4_097,
      5_000,
      8_191,
      8_192,
      8_193,
      12_288,
      16_384,
      65_537,
      DEFAULT_JSON_BODY_LIMIT_BYTES,
    ];
    for (const limit of limits) {
      // A number is valid JSON at every length, down to one byte.
      const source = encode("7".repeat(limit));
      for (const size of [1, 2, FIRST_BUFFER_BYTES, FIRST_BUFFER_BYTES + 1, limit - 1, limit]) {
        if (size < 1 || (size <= 2 && limit > 20_000)) continue;
        const label = `limit ${limit}, chunks of ${size}`;
        const exact = streamed(split(source, size));
        const parsed = await readJsonBody(exact.request, { maxBytes: limit });
        expect(typeof parsed, label).toBe("number");
        expect(exact.taken.cancelled, label).toBe(false);
        // One more byte, as a last chunk of its own and as part of the last chunk.
        const separate = streamed([...split(source, size), Uint8Array.of(0x20)]);
        const first = await appError(readJsonBody(separate.request, { maxBytes: limit }));
        expect(first.status, label).toBe(413);
        expect(separate.taken.cancelled, label).toBe(true);
        const joined = streamed(split(encode(`${"7".repeat(limit)} `), size));
        const second = await appError(readJsonBody(joined.request, { maxBytes: limit }));
        expect(second.status, label).toBe(413);
        expect(joined.taken.cancelled, label).toBe(true);
      }
    }
  });

  it("the ceiling is exact in large and in small chunks", async () => {
    const limit = MAX_JSON_BODY_LIMIT_BYTES;
    const { text, value } = documentOf(limit);
    const source = encode(text);
    expect(source.byteLength).toBe(limit);
    for (const size of [3, 4_096, 65_536, 1_000_000, limit]) {
      const exact = streamed(split(source, size));
      expect(await readJsonBody(exact.request, { maxBytes: limit }), `chunks of ${size}`).toBe(
        value,
      );
      const over = streamed([...split(source, size), Uint8Array.of(0x20)]);
      expect((await appError(readJsonBody(over.request, { maxBytes: limit }))).status).toBe(413);
      expect(over.taken.cancelled).toBe(true);
    }
  }, 60_000);

  it("empty chunks do not move the boundary in either direction", async () => {
    const limit = 5_000;
    const empty = (): Uint8Array => new Uint8Array(0);
    const source = encode("7".repeat(limit));
    const padded = [empty(), ...split(source, 999).flatMap((part) => [empty(), part, empty()])];
    expect(typeof (await readJsonBody(streamed(padded).request, { maxBytes: limit }))).toBe(
      "number",
    );
    const over = streamed([...padded, empty(), Uint8Array.of(0x20), empty()]);
    expect((await appError(readJsonBody(over.request, { maxBytes: limit }))).status).toBe(413);
  });

  it("a declared length is still judged first and changes nothing about the count", async () => {
    const limit = 6_000;
    const source = encode("7".repeat(limit));
    // True length: accepted. Understated length with a longer body: refused while reading.
    const honest = streamed(split(source, 1_000), {
      ...JSON_HEADERS,
      "content-length": String(limit),
    });
    expect(typeof (await readJsonBody(honest.request, { maxBytes: limit }))).toBe("number");
    const lying = streamed([...split(source, 1_000), Uint8Array.of(0x20)], {
      ...JSON_HEADERS,
      "content-length": "10",
    });
    expect((await appError(readJsonBody(lying.request, { maxBytes: limit }))).status).toBe(413);
    // Overstated length: refused with nothing pulled.
    const over = streamed(split(source, 1_000), {
      ...JSON_HEADERS,
      "content-length": String(limit + 1),
    });
    expect((await appError(readJsonBody(over.request, { maxBytes: limit }))).status).toBe(413);
    expect(over.taken.pulls).toBe(0);
  });

  it("an oversized body leaves nothing of itself in the refusal, the response, or the log", async () => {
    const marker = "QZXVMARKER";
    // The marker is copied into the buffer before the chunk that goes over the limit arrives.
    const chunks = [encode(`{"note":"${marker}`), new Uint8Array(3_000).fill(0x61)];
    const error = await appError(readJsonBody(streamed(chunks).request, { maxBytes: 2_000 }));
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(Object.values(error).some((held) => held instanceof Uint8Array)).toBe(false);
    const lines: string[] = [];
    const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const response = errorResponse(error, { requestId: REQUEST_ID, logger: log });
    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain(marker);
    expect(lines).toHaveLength(0);
  });
});

describe("SEC-020 re-check: only bytes are read", () => {
  const MARKER = "QZXVMARKER";
  const notBytes: [string, () => unknown][] = [
    ["a string", () => `${MARKER}${"a".repeat(1_000)}`],
    ["an ArrayBuffer", () => encode(MARKER).buffer],
    ["a SharedArrayBuffer", () => new SharedArrayBuffer(8)],
    ["a DataView", () => new DataView(encode(MARKER).buffer)],
    ["a Uint8ClampedArray", () => new Uint8ClampedArray(encode(MARKER))],
    ["an Int8Array", () => new Int8Array(encode(MARKER))],
    ["a Uint16Array", () => new Uint16Array(8)],
    ["a Float64Array", () => new Float64Array(8)],
    ["an array of numbers", () => [49, 50]],
    ["an object shaped like bytes", () => ({ byteLength: 1, length: 1, 0: 49, note: MARKER })],
    ["a number", () => 49],
    ["a bigint", () => BigInt(49)],
    ["true", () => true],
    ["null", () => null],
    ["undefined", () => undefined],
    ["a function", () => () => MARKER],
    ["a Blob", () => new Blob([MARKER])],
    // Fails closed: bytes made in another realm are not this realm's Uint8Array.
    ["a Uint8Array of another realm", () => runInNewContext("new Uint8Array([49])") as unknown],
  ];

  it.each(notBytes)(
    "%s is refused at once as a server fault, with nothing read after it",
    async (_name, make) => {
      // Valid bytes first, so that the fault arrives while a body is already held.
      const good = encode(`"${MARKER}`);
      const { request, taken } = streamed([good, make(), ...split(encode(`${MARKER}"`), 2)]);
      const error = await rejection(readJsonBody(request, { maxBytes: 10_000 }));
      expect(error).toBeInstanceOf(TypeError);
      expect(error).not.toBeInstanceOf(AppError);
      expect(String(error)).not.toContain(MARKER);
      expect((error as Error).cause).toBeUndefined();
      expect(taken).toEqual({ pulls: 2, cancelled: true });
      // Nothing more is asked of the source afterwards.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(taken.pulls).toBe(2);
      const lines: string[] = [];
      const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
      const response = errorResponse(error, { requestId: REQUEST_ID, logger: log });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(MARKER);
      expect(lines).toHaveLength(1);
      expect(lines.join("\n")).not.toContain(MARKER);
    },
  );

  it("text chunks never reach the limit arithmetic, whatever their length", async () => {
    // Before the fix a text chunk made the count not a number and the limit never triggered.
    for (const text of ["", "a", "a".repeat(20_000)]) {
      const { request, taken } = streamed([text, text, text, text]);
      expect(await rejection(readJsonBody(request, { maxBytes: 10 }))).toBeInstanceOf(TypeError);
      expect(taken.pulls).toBe(1);
    }
  });

  it("the server fault does not wait for, or depend on, the cancellation", async () => {
    const hanging = streamed(["text"], JSON_HEADERS, () => new Promise(() => undefined));
    const pending = readJsonBody(hanging.request);
    pending.catch(() => undefined);
    expect(await settlesWithin(pending, 1_000)).toBe("settled");
    expect(await rejection(pending)).toBeInstanceOf(TypeError);
    expect(hanging.taken.cancelled).toBe(true);

    const throwing = streamed(["text"], JSON_HEADERS, () => {
      throw new Error(`cancel refused ${MARKER}`);
    });
    const error = await rejection(readJsonBody(throwing.request));
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain(MARKER);

    const rejecting = streamed(endless(4_096), JSON_HEADERS, () =>
      Promise.reject(new Error("cancel refused later")),
    );
    expect((await appError(readJsonBody(rejecting.request, { maxBytes: 1_000 }))).status).toBe(413);
    // A rejected cancellation must not surface as an unhandled rejection either.
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => void unhandled.push(reason);
    process.on("unhandledRejection", record);
    await new Promise((resolve) => setTimeout(resolve, 30));
    process.off("unhandledRejection", record);
    expect(unhandled).toHaveLength(0);
  });

  it("Buffer and plain Uint8Array chunks are bytes", async () => {
    const chunks = [Buffer.from('{"quantity"'), encode(":"), Buffer.from("2}")];
    expect(await readJsonBody(streamed(chunks).request)).toEqual({ quantity: 2 });
  });
});

function* endless(chunkBytes: number): Generator<Uint8Array> {
  for (;;) yield new Uint8Array(chunkBytes).fill(0x61);
}

describe("SEC-020 re-check: memory is in proportion to the limit", () => {
  /**
   * Starts `requests` bodies of `count` chunks of `chunkBytes` bytes each, lets every one stall
   * before its last chunk, and returns the bytes reachable at that moment beyond the baseline.
   */
  async function heldByStalled(
    requests: number,
    count: number,
    chunkBytes: number,
    maxBytes: number,
  ): Promise<number> {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stalls: Promise<void>[] = [];
    const bodies: ReadableStream<Uint8Array>[] = [];
    for (let index = 0; index < requests; index += 1) {
      let sent = 0;
      let reached: () => void = () => undefined;
      stalls.push(
        new Promise<void>((resolve) => {
          reached = resolve;
        }),
      );
      bodies.push(
        new ReadableStream<Uint8Array>(
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
        ),
      );
    }
    const before = liveBytes();
    const pending = bodies.map((body) => readJsonBody(post(body), { maxBytes }));
    await Promise.all(stalls);
    const held = liveBytes() - before;
    release();
    expect(await Promise.all(pending)).toEqual(bodies.map(() => 1));
    return held;
  }

  it("twenty stalled default-size bodies in one-byte chunks hold about twenty bodies", async () => {
    // 20 x 102,399 one-byte chunks. Before the fix: about 24 MB each, 480 MB together.
    const held = await heldByStalled(
      20,
      DEFAULT_JSON_BODY_LIMIT_BYTES - 1,
      1,
      DEFAULT_JSON_BODY_LIMIT_BYTES,
    );
    // 20 buffers of at most the limit are 2 MB; the rest is room for the measurement.
    expect(held).toBeLessThan(8 * 1024 * 1024);
  }, 120_000);

  it("a stalled ceiling-size body holds at most the limit whatever the chunk size", async () => {
    for (const chunkBytes of [1_000, 4_096, 65_536, 524_287]) {
      const count = Math.floor((MAX_JSON_BODY_LIMIT_BYTES - 1) / chunkBytes);
      const held = await heldByStalled(1, count, chunkBytes, MAX_JSON_BODY_LIMIT_BYTES);
      // One buffer of at most 1 MiB, plus room for the measurement.
      expect(held, `chunks of ${chunkBytes}`).toBeLessThan(3 * 1024 * 1024);
    }
  }, 60_000);

  it("a small body under a large limit holds a small buffer, not the limit", async () => {
    // 2,000 one-byte chunks under the 1 MiB ceiling, 50 requests at once.
    const held = await heldByStalled(50, 2_000, 1, MAX_JSON_BODY_LIMIT_BYTES);
    // 50 first buffers of 4,096 bytes are 0.2 MB; allocating the limit up front would be 50 MiB.
    expect(held).toBeLessThan(4 * 1024 * 1024);
  }, 60_000);

  it("a default-size body in one-byte chunks over a real connection holds little", async () => {
    // What a sender on the network can do: one byte per HTTP chunk, then stop before the end.
    const bodyBytes = DEFAULT_JSON_BODY_LIMIT_BYTES - 1;
    let received = 0;
    let chunksSeen = 0;
    let arrived: () => void = () => undefined;
    const allArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let outcome: Promise<unknown> | undefined;
    const server = createServer((incoming, response) => {
      incoming.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        chunksSeen += 1;
        if (received >= bodyBytes) arrived();
      });
      const request = post(Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
      outcome = readJsonBody(request).then(
        (value) => {
          response.end("ok");
          return value;
        },
        (error: unknown) => {
          response.end("failed");
          return error;
        },
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const socket = connect(address.port, "127.0.0.1");
    socket.on("error", () => undefined);
    socket.on("data", () => undefined);
    try {
      const before = liveBytes();
      socket.write(
        "POST /x HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n" +
          "Transfer-Encoding: chunked\r\n\r\n",
      );
      // In pieces, so that the sender's own copy is not what is measured.
      const piece = "1\r\n \r\n".repeat(1_000);
      for (let sent = 0; sent < bodyBytes; sent += 1_000) {
        const count = Math.min(1_000, bodyBytes - sent);
        socket.write(count === 1_000 ? piece : "1\r\n \r\n".repeat(count));
      }
      expect(await settlesWithin(allArrived, 20_000)).toBe("settled");
      // Let the reader take what the connection delivered.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const held = liveBytes() - before;
      // The sender really did reach the reader as tens of thousands of separate chunks.
      expect(chunksSeen).toBeGreaterThan(50_000);
      // Before the fix: about 24 MB.
      expect(held).toBeLessThan(4 * 1024 * 1024);
      socket.write("1\r\n1\r\n0\r\n\r\n");
      if (outcome === undefined) throw new Error("the server saw no request");
      expect(await settlesWithin(outcome, 10_000)).toBe("settled");
      expect(await outcome).toBe(1);
    } finally {
      socket.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// OPEN finding registered by the re-check of the SEC-020 fix. Owner of the code: backend-api.
// ---------------------------------------------------------------------------

describe("SEC-021 a body can be read without end when its chunks add nothing to the count", () => {
  it.fails(
    "a long run of empty chunks is refused instead of being read for ever",
    async () => {
      // 500,000 chunks of no bytes, then a valid one-byte document. A body of at most 102,400
      // bytes never needs more chunks than that; the run stands for one that does not end.
      const run = 500_000;
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            if (pulls > run) {
              controller.enqueue(encode("1"));
              controller.close();
            } else controller.enqueue(new Uint8Array(0));
          },
        },
        { highWaterMark: 0 },
      );
      // Secure: the read is refused long before the run ends. Any bound up to twice the byte
      // limit satisfies this test.
      await rejection(readJsonBody(post(body)));
      expect(pulls).toBeLessThanOrEqual(2 * DEFAULT_JSON_BODY_LIMIT_BYTES);
    },
    60_000,
  );

  it.fails(
    "a chunk whose reported length is not a number does not switch the limit off",
    async () => {
      // A subclass passes `instanceof Uint8Array` and reports its own `byteLength`.
      class Uncounted extends Uint8Array {
        override get byteLength(): number {
          return Number.NaN;
        }
      }
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            if (pulls > 400) controller.close();
            else controller.enqueue(new Uncounted(1_000).fill(0x20));
          },
        },
        { highWaterMark: 0 },
      );
      // 400,000 bytes against a limit of 10,000.
      await rejection(readJsonBody(post(body), { maxBytes: 10_000 }));
      // Secure: stop at the first chunk that cannot be counted, or at the latest at the limit.
      expect(pulls).toBeLessThanOrEqual(11);
    },
  );
});
