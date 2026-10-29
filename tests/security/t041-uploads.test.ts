/**
 * Security review of T-041 (upload module and file serving; commits d2298d1, c719f83),
 * 2026-10-19. Owner: security. Review: docs/reviews/T-041-security.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040):
 * special characters are built with String.fromCodePoint.
 *
 * No database. The reader, the multipart parser, the content check, the local disk adapter, and
 * the error frame are called in process; the route files are read as text. The database cases
 * (served headers through the real routes, SEC-064, SEC-065) are in t041-uploads.itest.ts.
 *
 *   it(...)        behaviour checked on 2026-10-19 that holds. A failure is a regression.
 *   it.fails(...)  none in this file.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { detectImageType } from "@/modules/uploads/content";
import { isAllowedClientFilename, parseBoundary } from "@/modules/uploads/multipart";
import { readUploadRequest } from "@/modules/uploads/reader";
import {
  isStorageKey,
  MAX_UPLOAD_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  STORAGE_KEY_PATTERN,
} from "@/modules/uploads/schema";
import { generateStorageKey, LocalDiskStorage } from "@/modules/uploads/storage";
import {
  ascii,
  fileBody,
  jpegBytes,
  multipartBody,
  multipartContentType,
  pngBytes,
  TEST_BOUNDARY,
  webpBytes,
} from "@/modules/uploads/test-fixtures";
import { Prisma } from "@/server/db";
import { isAppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { createLogger } from "@/server/logger";

const ROOT = process.cwd();
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const CANARY = "Zq7uploadCanary";

function request(
  body: BodyInit | null,
  headers: Record<string, string> = {},
  init: { duplex?: boolean } = {},
): Request {
  return new Request("https://shop.example.test/api/v1/seller/uploads", {
    method: "POST",
    headers: { "content-type": multipartContentType(), ...headers },
    body,
    ...(init.duplex === false ? {} : { duplex: "half" }),
  } as RequestInit);
}

/** The status, code, and full public JSON of what `readUploadRequest` threw, or "accepted". */
async function outcome(
  req: Request,
): Promise<{ status: number; code: string; text: string } | "accepted"> {
  try {
    await readUploadRequest(req);
    return "accepted";
  } catch (error) {
    if (!isAppError(error)) throw error;
    return { status: error.status, code: error.code, text: JSON.stringify(error.toPublic()) };
  }
}

async function statusOf(req: Request): Promise<number> {
  const result = await outcome(req);
  return result === "accepted" ? 200 : result.status;
}

/** A raw multipart body from text lines (CRLF added) followed by bytes and the close. */
function rawBody(
  headerLines: string[],
  bytes: Uint8Array,
  boundary = TEST_BOUNDARY,
): Uint8Array<ArrayBuffer> {
  const head = new TextEncoder().encode(`--${boundary}\r\n${headerLines.join("\r\n")}\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.byteLength + bytes.byteLength + tail.byteLength);
  out.set(head, 0);
  out.set(bytes, head.byteLength);
  out.set(tail, head.byteLength + bytes.byteLength);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Route files
// ---------------------------------------------------------------------------------------------

function filesUnder(directory: string, accept: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}
const posix = (path: string): string => relative(ROOT, path).split(sep).join("/");

const UPLOAD_ROUTE = "src/app/api/v1/seller/uploads/route.ts";
const FILE_ROUTE = "src/app/api/files/[key]/route.ts";

describe("T-041 review: route files", () => {
  it("every route file under src/app/api outside v1 is one that a review has listed", () => {
    // The guard in t020-t018-catalog-shell.test.ts covers src/app/api/v1 only; the file route
    // lives outside it. A new route here fails until a review has read it.
    const outsideV1 = filesUnder(join(ROOT, "src", "app", "api"), (p) => p.endsWith("route.ts"))
      .map(posix)
      .filter((p) => !p.startsWith("src/app/api/v1/"))
      .sort();
    expect(outsideV1).toEqual(
      [
        // T-011 health check; reviewed in tests/security/t011-env-health-recheck.test.ts.
        "src/app/api/health/route.ts",
        // T-041 file serving; reviewed here and in t041-uploads.itest.ts.
        FILE_ROUTE,
      ].sort(),
    );
  });

  it("the upload route judges origin, content type, session, role and store, rate limit, then reads", () => {
    const source = readFileSync(join(ROOT, UPLOAD_ROUTE), "utf8");
    const order = [
      "assertSameOrigin(",
      "assertContentType(request, MULTIPART_CONTENT_TYPE)",
      "requireActor(",
      "requireApprovedSeller(actor)",
      "rateLimiter.consume(actor.userId, RATE_LIMITS.UPLOADS)",
      "readUploadRequest(request)",
      "createUpload(actor, image",
    ].map((needle) => source.indexOf(needle));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(source).toMatch(/return handleRequest\(request, async/);
    // No body reader of its own (SR-05 item 1), no database, and no store id from the request.
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob|body)\b/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
    expect(source).not.toMatch(/storeId/);
    expect(source).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE)\b/);
  });

  // Changed by security with the SEC-068 item 1 re-check (2026-10-20): this case asserted that the
  // route reads no session, which encoded the old rule "every registered upload is public". Under
  // the new rule a file that is not public is served only to the owning seller, so the route now
  // hands the session guard `getActor` to `openFile` as a resolver, and only that. Still refused:
  // `requireActor` (a request without a session must never be 401), a session read of its own
  // (`cookies()`, `headers()`), a role or store check in the route (the decision is the service's
  // `mayServe`), and any store id from the request.
  it("the file route is GET only, inside the frame, sets the four protective headers, and reads the session only through the guard passed to openFile", () => {
    const source = readFileSync(join(ROOT, FILE_ROUTE), "utf8");
    expect(source).toMatch(/export async function GET\(/);
    expect(source).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
    expect(source).toMatch(/return handleRequest\(request, async/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
    expect(source).not.toMatch(
      /requireActor|requireRole|requireApprovedSeller|cookies\(|headers\(\)/,
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain('import { getActor } from "@/server/auth/session";');
    // In the code, getActor appears twice: its import and the one resolver handed to openFile.
    expect(code.match(/getActor/g)).toHaveLength(2);
    expect(code).toMatch(/openFile\(key, \{[^}]*\}, \(\) => getActor\(request\)\)/);
    expect(code).not.toMatch(/await getActor|\.role\b|storeId|searchParams|actor/);
    expect(source).toContain('"X-Content-Type-Options": "nosniff"');
    expect(source).toContain(`"Content-Security-Policy": "default-src 'none'; sandbox"`);
    expect(source).toContain('"Content-Type": file.contentType');
    expect(source).toContain('"Cache-Control": FILE_CACHE_CONTROL');
    // The key goes to openFile only, never into a path or a header.
    expect(source).toMatch(/openFile\(key, \{/);
    expect(source).not.toMatch(/\$\{key\}|key\s*\+|\+\s*key/);
    expect(source).not.toMatch(/join\(|resolve\(|readFile|createReadStream/);
  });

  it("no module but storage.ts touches the file system, and the upload module never uses the client name as a path", () => {
    const moduleFiles = filesUnder(
      join(ROOT, "src", "modules", "uploads"),
      (p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p) && !p.endsWith("test-fixtures.ts"),
    );
    for (const path of moduleFiles) {
      const source = readFileSync(path, "utf8");
      if (posix(path).endsWith("/storage.ts")) continue;
      expect(source, posix(path)).not.toMatch(/node:fs|from "fs"/);
    }
    const storage = readFileSync(join(ROOT, "src", "modules", "uploads", "storage.ts"), "utf8");
    expect(storage).not.toMatch(/filename/);
    // Raw SQL in the module is tagged-template only (TM-14).
    for (const path of moduleFiles) {
      expect(readFileSync(path, "utf8"), posix(path)).not.toMatch(/Unsafe|Prisma\.raw/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Keys and the local disk adapter (TM-18)
// ---------------------------------------------------------------------------------------------

describe("T-041 review: storage keys and the local disk adapter", () => {
  let base: string;
  let root: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "t041-sec-"));
    root = join(base, "store");
  });
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const HOSTILE_KEYS = [
    "",
    ".",
    "..",
    "../../etc/passwd",
    "..\\..\\windows\\win.ini",
    "%2e%2e%2f",
    `../${"0".repeat(32)}`,
    `${"0".repeat(32)}/`,
    `${"0".repeat(31)}/`,
    `/${"0".repeat(31)}`,
    `${"0".repeat(32)}\n`,
    `${"0".repeat(32)}${cp(0)}`,
    "0".repeat(33),
    "0".repeat(31),
    "A".repeat(32),
    `${"0".repeat(30)}:x`,
    `C:${"0".repeat(30)}`,
    `${"0".repeat(32)}.jpg`,
    `${"0".repeat(16)}${cp(0xff10)}${"0".repeat(15)}`, // full-width digit zero
    `${"0".repeat(16)}${cp(0x0660)}${"0".repeat(15)}`, // Arabic-Indic digit zero
  ];

  it("the key pattern matches no traversal, separator, dot, control, or look-alike digit", () => {
    for (const key of HOSTILE_KEYS) expect(isStorageKey(key), JSON.stringify(key)).toBe(false);
    expect(STORAGE_KEY_PATTERN.flags).toBe("");
    expect(isStorageKey(["0".repeat(32)])).toBe(false);
    expect(isStorageKey({ toString: () => "0".repeat(32) })).toBe(false);
  });

  it("generated keys are 32 lower-case hex digits from 128 random bits and do not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      const key = generateStorageKey();
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      seen.add(key);
    }
    expect(seen.size).toBe(2_000);
  });

  it("the adapter refuses every hostile key with a TypeError and creates nothing anywhere", async () => {
    const storage = new LocalDiskStorage(root);
    for (const key of HOSTILE_KEYS) {
      await expect(storage.put(key, jpegBytes()), JSON.stringify(key)).rejects.toBeInstanceOf(
        TypeError,
      );
      await expect(storage.get(key)).rejects.toBeInstanceOf(TypeError);
      await expect(storage.delete(key)).rejects.toBeInstanceOf(TypeError);
    }
    expect(await readdir(base)).toEqual([]);
  });

  it("an existing key is never overwritten, and a failed second write leaves the first bytes", async () => {
    const storage = new LocalDiskStorage(root);
    const key = generateStorageKey();
    await storage.put(key, ascii("first"));
    await expect(storage.put(key, ascii("second"))).rejects.toMatchObject({ code: "EEXIST" });
    const object = await storage.get(key);
    expect(object?.sizeBytes).toBe(5);
    const text = await new Response(object?.body).text();
    expect(text).toBe("first");
  });

  it("a relative root is refused, so a working-directory change cannot move the store", () => {
    expect(() => new LocalDiskStorage("uploads")).toThrow(TypeError);
    expect(() => new LocalDiskStorage("")).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------
// The reader: framing, names, type, size (TM-17, SR-05)
// ---------------------------------------------------------------------------------------------

describe("T-041 review: the multipart reader refuses what it should", () => {
  it("content checked by leading bytes: SVG, HTML, GIF, PDF, text, and an empty file are 415 under any image name and type", async () => {
    const payloads: [string, Uint8Array][] = [
      ["svg", ascii("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>")],
      ["svg with BOM", concat(new Uint8Array([0xef, 0xbb, 0xbf]), ascii("<svg/>"))],
      ["html", ascii("<!doctype html><script>alert(1)</script>")],
      ["xml", ascii("<?xml version='1.0'?><svg/>")],
      ["gif", ascii(`GIF89a${cp(1, 0, 1, 0)};`)],
      ["pdf", ascii("%PDF-1.7")],
      ["empty", new Uint8Array(0)],
      ["three jpeg bytes", new Uint8Array([0xff, 0xd8, 0xff])],
      ["png signature without IHDR", pngBytes(16).map((b, i) => (i >= 12 ? 0x41 : b))],
      ["riff without webp", ascii(`RIFF${cp(16, 0, 0, 0)}AVI LIST`)],
    ];
    for (const [name, bytes] of payloads) {
      for (const [filename, type] of [
        ["a.jpg", "image/jpeg"],
        ["a.png", "image/png"],
        ["a.webp", "image/webp"],
      ] as const) {
        expect(
          await statusOf(request(fileBody(bytes, filename, type))),
          `${name} ${filename}`,
        ).toBe(415);
      }
    }
  });

  it("declared type and extension must both name the type the bytes show", async () => {
    const cases: [Uint8Array, string, string, number][] = [
      [jpegBytes(), "a.jpg", "image/jpeg", 200],
      [jpegBytes(), "a.JPEG", "IMAGE/JPEG", 200],
      [jpegBytes(), "a.png", "image/jpeg", 415],
      [jpegBytes(), "a.jpg", "image/png", 415],
      [jpegBytes(), "a.jpg", "image/jpg", 415],
      [jpegBytes(), "a.jpg", "", 415],
      [jpegBytes(), "a.jpg", "application/octet-stream", 415],
      [jpegBytes(), "a.jpg.html", "image/jpeg", 415],
      [jpegBytes(), "a.svg", "image/jpeg", 415],
      [jpegBytes(), "jpg", "image/jpeg", 415],
      [pngBytes(), "a.png", "image/png; charset=utf-8", 200],
      [webpBytes(), "a.webp", "image/webp", 200],
      [webpBytes(), "a.webp", "image/svg+xml", 415],
    ];
    for (const [bytes, filename, type, expected] of cases) {
      expect(await statusOf(request(fileBody(bytes, filename, type))), `${filename} ${type}`).toBe(
        expected,
      );
    }
  });

  it("refuses client names that could be a path, also percent-encoded, with 400, and echoes none of them", async () => {
    const names = [
      `../${CANARY}.jpg`,
      `..${CANARY}.jpg`,
      `a/${CANARY}.jpg`,
      `a\\${CANARY}.jpg`,
      `C:${CANARY}.jpg`,
      `${CANARY}.jpg:stream`,
      `%2e%2e%2f${CANARY}.jpg`,
      `%2E%2E%5C${CANARY}.jpg`,
      `${CANARY}%00.jpg`,
      `${CANARY}${cp(0x85)}.jpg`,
      `${CANARY}${cp(0x7f)}.jpg`,
      `${"a".repeat(252)}${CANARY}.jpg`,
    ];
    for (const name of names) {
      const result = await outcome(request(fileBody(jpegBytes(), name)));
      expect(result, name).not.toBe("accepted");
      if (result === "accepted") continue;
      expect(result.status, name).toBe(400);
      expect(result.text).not.toContain(CANARY);
    }
    // Control characters other than CR and LF go through the header bytes directly.
    for (const code of [0x00, 0x01, 0x09, 0x1b]) {
      const body = rawBody(
        [
          `Content-Disposition: form-data; name="file"; filename="a${cp(code)}b.jpg"`,
          "Content-Type: image/jpeg",
        ],
        jpegBytes(),
      );
      expect(await statusOf(request(body)), `U+${code.toString(16)}`).toBe(400);
    }
    expect(isAllowedClientFilename(".")).toBe(false);
    expect(isAllowedClientFilename("")).toBe(false);
  });

  it("a refused file, field, or framing never repeats any byte of the request in the answer", async () => {
    const bodies = [
      rawBody([`Content-Disposition: form-data; name="${CANARY}"; filename="a.jpg"`], jpegBytes()),
      rawBody(
        [`Content-Disposition: form-data; name="file"; filename*=UTF-8''${CANARY}.jpg`],
        jpegBytes(),
      ),
      rawBody(
        [`X-${CANARY}: 1`, `Content-Disposition: form-data; name="file"; filename="a.jpg"`],
        jpegBytes(),
      ),
      fileBody(ascii(`<html>${CANARY}</html>`), `${CANARY}.jpg`),
    ];
    for (const body of bodies) {
      const result = await outcome(request(body));
      expect(result).not.toBe("accepted");
      if (result !== "accepted") expect(result.text).not.toContain(CANARY);
    }
  });

  it("refuses framing that another reader could read differently", async () => {
    const disposition = 'Content-Disposition: form-data; name="file"; filename="a.jpg"';
    const jpeg = jpegBytes();
    const enc = (text: string) => new TextEncoder().encode(text);
    const cases: [string, Uint8Array<ArrayBuffer>][] = [
      [
        "Content-Transfer-Encoding",
        rawBody(
          [disposition, "Content-Type: image/jpeg", "Content-Transfer-Encoding: base64"],
          jpeg,
        ),
      ],
      [
        "repeated Content-Disposition",
        rawBody([disposition, disposition, "Content-Type: image/jpeg"], jpeg),
      ],
      [
        "repeated Content-Type",
        rawBody([disposition, "Content-Type: image/jpeg", "Content-Type: image/png"], jpeg),
      ],
      [
        "repeated name parameter",
        rawBody(
          [
            'Content-Disposition: form-data; name="x"; name="file"; filename="a.jpg"',
            "Content-Type: image/jpeg",
          ],
          jpeg,
        ),
      ],
      [
        "filename*",
        rawBody(
          [
            "Content-Disposition: form-data; name=\"file\"; filename*=UTF-8''a.jpg",
            "Content-Type: image/jpeg",
          ],
          jpeg,
        ),
      ],
      [
        "folded header",
        rawBody(
          [
            'Content-Disposition: form-data; name="file";',
            ' filename="a.jpg"',
            "Content-Type: image/jpeg",
          ],
          jpeg,
        ),
      ],
      [
        "not form-data",
        rawBody(
          [
            'Content-Disposition: attachment; name="file"; filename="a.jpg"',
            "Content-Type: image/jpeg",
          ],
          jpeg,
        ),
      ],
      [
        "form-dataX",
        rawBody(
          [
            'Content-Disposition: form-dataX; name="file"; filename="a.jpg"',
            "Content-Type: image/jpeg",
          ],
          jpeg,
        ),
      ],
      ["preamble", concat(enc("preamble\r\n"), fileBody(jpeg))],
      ["bare LF framing", enc(`--${TEST_BOUNDARY}\n${disposition}\nContent-Type: image/jpeg\n\n`)],
      [
        "header not UTF-8",
        concat(
          enc(`--${TEST_BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a`),
          new Uint8Array([0xff]),
          enc(`.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
          jpeg,
          enc(`\r\n--${TEST_BOUNDARY}--`),
        ),
      ],
      [
        "oversized part header",
        rawBody([disposition, "Content-Type: image/jpeg", `X-Pad: ${"a".repeat(9_000)}`], jpeg),
      ],
      [
        "not closed",
        concat(
          enc(`--${TEST_BOUNDARY}\r\n${disposition}\r\nContent-Type: image/jpeg\r\n\r\n`),
          jpeg,
        ),
      ],
      [
        "two files",
        multipartBody([
          { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpeg },
          { name: "file", filename: "b.jpg", contentType: "image/jpeg", bytes: jpeg },
        ]),
      ],
      [
        "file then storeId",
        multipartBody([
          { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpeg },
          { name: "storeId", bytes: enc("other") },
        ]),
      ],
      [
        "storeId then file",
        multipartBody([
          { name: "storeId", bytes: enc("other") },
          { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpeg },
        ]),
      ],
      [
        "File (letter case)",
        multipartBody([
          { name: "File", filename: "a.jpg", contentType: "image/jpeg", bytes: jpeg },
        ]),
      ],
      [
        "file without filename",
        multipartBody([{ name: "file", contentType: "image/jpeg", bytes: jpeg }]),
      ],
      ["no parts", enc(`--${TEST_BOUNDARY}--\r\n`)],
      ["empty body", new Uint8Array(0)],
      ["other boundary in body", fileBody(jpeg, "a.jpg", "image/jpeg", "other-boundary")],
    ];
    for (const [name, body] of cases) {
      expect(await statusOf(request(body)), name).toBe(400);
    }
    for (const header of [
      "multipart/form-data",
      "multipart/form-data; boundary=",
      `multipart/form-data; boundary=${TEST_BOUNDARY}; boundary=${TEST_BOUNDARY}`,
      `multipart/form-data; boundary=${"a".repeat(71)}`,
      "multipart/form-data; boundary=a;b",
      "multipart/form-data; =x",
    ]) {
      expect(() => parseBoundary(header), header).toThrow();
    }
    // Content after the closing delimiter is ignored, never read as a second file.
    const epilogue = concat(fileBody(jpeg), fileBody(ascii("<html>")));
    expect(await statusOf(request(epilogue))).toBe(200);
  });

  it("a file that carries the delimiter inside its bytes is cut there and refused, not accepted with the rest", async () => {
    const inner = concat(
      jpegBytes(),
      new TextEncoder().encode(`\r\n--${TEST_BOUNDARY}X`),
      ascii("<html>"),
    );
    expect(await statusOf(request(fileBody(inner)))).toBe(400);
  });
});

describe("T-041 review: size and streaming (SR-05 items 3, 6, 8, 9)", () => {
  it("a declared length over the body limit is 413 before a byte is pulled", async () => {
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(jpegBytes());
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    for (const length of [
      String(MAX_UPLOAD_BODY_BYTES + 1),
      "1e9",
      "-1",
      "0x10",
      "5 5",
      "99999999999999",
    ]) {
      const req = request(stream, { "content-length": length });
      expect(await statusOf(req), length).toBe(413);
    }
    expect(pulled).toBe(false);
  });

  it("a body without a length, sent in small chunks past the limit, is 413 and read at most one chunk past it", async () => {
    const chunk = new Uint8Array(65_536).fill(0x41);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 },
    );
    expect(await statusOf(request(stream))).toBe(413);
    expect(pulls * chunk.byteLength).toBeLessThanOrEqual(
      MAX_UPLOAD_BODY_BYTES + 2 * chunk.byteLength,
    );
  });

  it("a file one byte over 4 MiB inside a body under the body limit is 413; exactly 4 MiB is accepted", async () => {
    expect(await statusOf(request(fileBody(jpegBytes(MAX_UPLOAD_FILE_BYTES + 1))))).toBe(413);
    expect(await statusOf(request(fileBody(jpegBytes(MAX_UPLOAD_FILE_BYTES))))).toBe(200);
  });

  it("a body that breaks off is a client error below 500", async () => {
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(fileBody(jpegBytes()).subarray(0, 100));
          return;
        }
        controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
      },
    });
    const status = await statusOf(request(stream));
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it("parsing the largest body is cheap, also when it is full of near-delimiters", async () => {
    const near = new TextEncoder().encode(`\r\n--${TEST_BOUNDARY.slice(0, -1)}`);
    const filler = new Uint8Array(MAX_UPLOAD_FILE_BYTES - 64);
    for (let i = 0; i + near.byteLength <= filler.byteLength; i += near.byteLength)
      filler.set(near, i);
    const body = fileBody(concat(jpegBytes(64), filler));
    expect(body.byteLength).toBeLessThanOrEqual(MAX_UPLOAD_BODY_BYTES);
    const started = performance.now();
    expect(await statusOf(request(body))).toBe(200);
    expect(performance.now() - started).toBeLessThan(2_000);

    const crlfs = new Uint8Array(MAX_UPLOAD_BODY_BYTES - 200).fill(0x0d);
    const header = new TextEncoder().encode(`--${TEST_BOUNDARY}\r\nContent-Disposition: form-data`);
    const started2 = performance.now();
    expect(await statusOf(request(concat(header, crlfs)))).toBe(400);
    expect(performance.now() - started2).toBeLessThan(2_000);
  });
});

describe("T-041 review: polyglot images (documented behaviour, not a finding)", () => {
  it("valid leading bytes followed by HTML or script are accepted as the image type; the served headers are the control", async () => {
    // TM-17 accepts this by design: the content check reads the leading bytes only. The file
    // route serves the recorded image type with nosniff and a sandbox CSP (itest checks it).
    const html = ascii("<html><script>alert(document.domain)</script></html>");
    for (const [bytes, filename, type] of [
      [concat(jpegBytes(16), html), "a.jpg", "image/jpeg"],
      [concat(pngBytes(16), html), "a.png", "image/png"],
    ] as const) {
      expect(await statusOf(request(fileBody(bytes, filename, type)))).toBe(200);
      expect(detectImageType(bytes)).toBe(type);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// CR-T040-07: does the 500 handler log Prisma `meta`?
// ---------------------------------------------------------------------------------------------

describe("CR-T040-07: a raw Prisma unique violation reaching the 500 handler", () => {
  const SLUG = "zq7-slug-canary";
  function slugViolation(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the constraint: \`Store_slug_key\` ${SLUG}`,
      {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: {
          modelName: "Store",
          driverAdapterError: {
            name: "DriverAdapterError",
            cause: {
              originalCode: "23505",
              originalMessage: `duplicate key value violates unique constraint "Store_slug_key" DETAIL: Key (slug)=(${SLUG}) already exists.`,
              kind: "UniqueConstraintViolation",
              constraint: { index: "Store_slug_key" },
            },
          },
        },
      },
    );
  }

  it("logs class name and code only, never meta, DETAIL, the message, or the slug; the client gets the generic 500", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const response = errorResponse(slugViolation(), { requestId: "req_cr_t040_07", logger });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(SLUG);
    expect(text).not.toMatch(/meta|Store_slug_key|P2002/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SLUG);
    expect(lines[0]).not.toMatch(/meta|DETAIL|driverAdapterError|Store_slug_key|duplicate key/);
    const line = JSON.parse(lines[0] ?? "{}") as { level: string; err: Record<string, unknown> };
    expect(line.level).toBe("error");
    expect(line.err).toEqual({ errorClass: "PrismaClientKnownRequestError", code: "P2002" });
  });

  it("the same when the error is wrapped as the cause of an AppError, or of a 4xx", async () => {
    const { conflict, internalError } = await import("@/server/errors");
    for (const wrapped of [
      internalError(slugViolation()),
      conflict("STORE_NAME_TAKEN", { cause: slugViolation() }),
    ]) {
      const lines: string[] = [];
      const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
      errorResponse(wrapped, { requestId: "req_cr_t040_07b", logger });
      expect(lines).toHaveLength(1);
      for (const line of lines) {
        expect(line).not.toContain(SLUG);
        expect(line).not.toMatch(/meta|DETAIL|driverAdapterError/);
      }
    }
  });

  it("no application file hands a raw error object to the logger (the logger itself would write meta and message)", () => {
    // Measured 2026-10-19: createLogger().error("x", { err: prismaError }) writes the error's
    // message, stack, and `meta`, DETAIL included. The control is errorResponse and the call
    // sites, which log labels only (describeErrorForLog, labelOf, errorLabel). This pins that.
    const sources = filesUnder(
      join(ROOT, "src"),
      (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p),
    );
    const offenders: string[] = [];
    const probes = [
      'log.error("x", { err: error });',
      'logger.warn("x", {\n  error,\n});',
      'context.logger?.error("x", { cause: e })',
    ];
    for (const path of [...sources, ...probes.map((_, i) => `probe-${i}`)]) {
      const index = path.startsWith("probe-") ? Number(path.slice(6)) : -1;
      const text = index >= 0 ? (probes[index] ?? "") : readFileSync(path, "utf8");
      for (const call of text.matchAll(
        /\b(?:log|logger|context\.logger)\??\.(?:error|warn|info|debug)\(/g,
      )) {
        const start = call.index ?? 0;
        const window = text.slice(start, start + 400);
        const name = index >= 0 ? path : posix(path);
        if (/\b(?:err|error|cause)\s*:\s*(?:error|err|e|caught)\s*[,}\n]/.test(window)) {
          offenders.push(`${name} at offset ${start}`);
        } else if (/\{\s*(?:error|err)\s*[,}]/.test(window)) {
          offenders.push(`${name} at offset ${start} (shorthand)`);
        }
      }
    }
    // The three probes prove the pattern sees the shapes; no application file may add a fourth.
    expect(offenders).toEqual([
      "probe-0 at offset 0",
      "probe-1 at offset 0 (shorthand)",
      "probe-2 at offset 0",
    ]);
  });
});
