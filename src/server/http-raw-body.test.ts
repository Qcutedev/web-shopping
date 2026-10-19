/**
 * `readRawBodyBytes` (src/server/http.ts): the byte reader of the upload module, held to the same
 * rules as `readJsonBody` (SECURITY.md SR-05 items 3, 8, 9, and 10).
 */
import { describe, expect, it } from "vitest";

import { RequestBodyAbortedError } from "./errors";
import { MAX_EMPTY_BODY_CHUNKS, MAX_RAW_BODY_LIMIT_BYTES, readRawBodyBytes } from "./http";

function requestWith(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/upload", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

function streamOf(chunks: unknown[], failAtEnd?: unknown): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk as Uint8Array);
      if (failAtEnd === undefined) controller.close();
      else controller.error(failAtEnd);
    },
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("readRawBodyBytes", () => {
  it("returns the exact bytes of a body within the limit, and of a body exactly at it", async () => {
    const body = Uint8Array.from([0, 1, 2, 255]);
    expect(Array.from(await readRawBodyBytes(requestWith(body), 4))).toEqual([0, 1, 2, 255]);
  });

  it("returns zero bytes for a request without a body", async () => {
    expect(await readRawBodyBytes(requestWith(null), 10)).toHaveLength(0);
  });

  it("refuses a Content-Length over the limit, or not a plain number, before reading", async () => {
    // (Headers trims surrounding blanks itself, so " 5" would arrive as "5".)
    for (const length of ["11", "1e3", "-1", "5 5", "0x10", "99999999"]) {
      const stream = streamOf([new Uint8Array(1)]);
      const error = await rejection(
        readRawBodyBytes(requestWith(stream, { "content-length": length }), 10),
      );
      expect(error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
      expect(stream.locked).toBe(false); // nothing was read
    }
  });

  it("refuses a streamed body as soon as it passes the limit", async () => {
    const error = await rejection(
      readRawBodyBytes(requestWith(streamOf([new Uint8Array(6), new Uint8Array(6)])), 10),
    );
    expect(error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
  });

  it("answers a body that stops arriving as a client error", async () => {
    const error = await rejection(
      readRawBodyBytes(requestWith(streamOf([new Uint8Array(2)], new Error("reset"))), 10),
    );
    expect(error).toBeInstanceOf(RequestBodyAbortedError);
    expect((error as RequestBodyAbortedError).status).toBeLessThan(500);
  });

  it("keeps the reader's own refusals as server faults (too many empty chunks)", async () => {
    const empties = Array.from({ length: MAX_EMPTY_BODY_CHUNKS + 1 }, () => new Uint8Array(0));
    const error = await rejection(readRawBodyBytes(requestWith(streamOf(empties)), 10));
    expect(error).toBeInstanceOf(TypeError);
  });

  it("throws a TypeError for a limit outside 1 to MAX_RAW_BODY_LIMIT_BYTES", async () => {
    for (const limit of [0, -1, 1.5, Number.NaN, MAX_RAW_BODY_LIMIT_BYTES + 1]) {
      await expect(readRawBodyBytes(requestWith(new Uint8Array(1)), limit)).rejects.toBeInstanceOf(
        TypeError,
      );
    }
  });

  it("refuses a body that was already read, as a server fault", async () => {
    const request = requestWith(new Uint8Array(1));
    await request.arrayBuffer();
    await expect(readRawBodyBytes(request, 10)).rejects.toBeInstanceOf(TypeError);
  });

  it("allows the 8 MiB ceiling, which fits the seven digits Content-Length is compared in", () => {
    expect(String(MAX_RAW_BODY_LIMIT_BYTES)).toHaveLength(7);
  });
});
