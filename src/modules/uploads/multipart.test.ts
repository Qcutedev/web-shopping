import { describe, expect, it } from "vitest";

import type { AppError } from "@/server/errors";

import { isAllowedClientFilename, parseBoundary, parseSingleFilePart } from "./multipart";
import { INVALID_MULTIPART_FIELD_CODE, MAX_PART_HEADER_BYTES } from "./schema";
import { ascii, fileBody, jpegBytes, multipartBody, TEST_BOUNDARY } from "./test-fixtures";

function caught(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

function fieldOf(error: AppError): { path: string; code: string } {
  const fields = error.details["fields"] as { path: string; code: string }[];
  expect(fields).toHaveLength(1);
  return { path: fields[0]?.path ?? "?", code: fields[0]?.code ?? "?" };
}

describe("parseBoundary", () => {
  it("reads a plain and a quoted boundary", () => {
    expect(parseBoundary(`multipart/form-data; boundary=${TEST_BOUNDARY}`)).toBe(TEST_BOUNDARY);
    expect(parseBoundary('multipart/form-data; charset=utf-8; BOUNDARY="a b"')).toBe("a b");
  });

  it.each([
    ["no boundary", "multipart/form-data"],
    ["an empty boundary", "multipart/form-data; boundary="],
    ["a boundary of 71 characters", `multipart/form-data; boundary=${"a".repeat(71)}`],
    ["a boundary ending in a space", 'multipart/form-data; boundary="ab "'],
    ["a boundary with a character outside bchars", "multipart/form-data; boundary=a<b"],
    ["two boundaries", "multipart/form-data; boundary=a; boundary=b"],
    ["a parameter without a value", "multipart/form-data; boundary"],
    ["no header at all", null],
  ])("refuses %s with 400 invalid_multipart", (_name, header) => {
    const error = caught(() => parseBoundary(header));
    expect(error.status).toBe(400);
    expect(fieldOf(error)).toEqual({ path: "", code: INVALID_MULTIPART_FIELD_CODE });
  });
});

describe("isAllowedClientFilename", () => {
  it.each(["photo.jpg", "รูปสินค้า.png", "a b (1).webp", ".jpg", "x..y.jpeg", "50%.jpg"])(
    "accepts %s",
    (name) => {
      expect(isAllowedClientFilename(name)).toBe(true);
    },
  );

  it.each([
    ["empty", ""],
    ["parent traversal", "../../x.jpg"],
    ["a bare ..", ".."],
    ["a bare .", "."],
    ["an absolute POSIX path", "/etc/passwd.jpg"],
    ["a Windows path", "C:\\Windows\\x.jpg"],
    ["backslash traversal", "..\\..\\x.jpg"],
    ["a drive letter", "C:x.jpg"],
    ["a NUL byte", "x.jpg\u0000.png"],
    ["a line feed", "x\n.jpg"],
    ["DEL", "x\u007f.jpg"],
    ["a C1 control", "x\u0085.jpg"],
    ["an encoded slash", "..%2f..%2fx.jpg"],
    ["an encoded backslash", "..%5Cx.jpg"],
    ["encoded dots", "%2e%2e.jpg"],
    ["an encoded NUL", "x%00.jpg"],
    ["256 characters", `${"a".repeat(252)}.jpg`],
  ])("refuses %s", (_name, name) => {
    expect(isAllowedClientFilename(name)).toBe(false);
  });

  it("accepts exactly 255 characters", () => {
    expect(isAllowedClientFilename(`${"a".repeat(251)}.jpg`)).toBe(true);
  });
});

describe("parseSingleFilePart", () => {
  it("returns the one file with its client name, declared type, and exact bytes", () => {
    const bytes = jpegBytes(100);
    bytes[50] = 0x0d; // CR LF inside the content is content, not framing
    bytes[51] = 0x0a;
    const file = parseSingleFilePart(fileBody(bytes, "รูป.jpg", "Image/JPEG; q=1"), TEST_BOUNDARY);
    expect(file.filename).toBe("รูป.jpg");
    expect(file.declaredType).toBe("image/jpeg");
    expect(Array.from(file.bytes)).toEqual(Array.from(bytes));
  });

  it("ignores whatever follows the closing delimiter", () => {
    const body = fileBody(jpegBytes());
    const withEpilogue = new Uint8Array(body.byteLength + 5);
    withEpilogue.set(body);
    withEpilogue.set(ascii("junk!"), body.byteLength);
    expect(parseSingleFilePart(withEpilogue, TEST_BOUNDARY).bytes.byteLength).toBe(64);
  });

  it("gives an empty declared type when the part has no Content-Type", () => {
    const body = multipartBody([{ name: "file", filename: "a.jpg", bytes: jpegBytes() }]);
    expect(parseSingleFilePart(body, TEST_BOUNDARY).declaredType).toBe("");
  });

  it("refuses a field other than file (an extra storeId too) with 400 unrecognized_keys", () => {
    for (const parts of [
      [{ name: "storeId", bytes: ascii("other-store") }],
      [
        { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpegBytes() },
        { name: "storeId", bytes: ascii("other-store") },
      ],
      [
        { name: "storeId", bytes: ascii("other-store") },
        { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpegBytes() },
      ],
    ]) {
      const error = caught(() => parseSingleFilePart(multipartBody(parts), TEST_BOUNDARY));
      expect(error.status).toBe(400);
      expect(fieldOf(error)).toEqual({ path: "", code: "unrecognized_keys" });
      expect(JSON.stringify(error.toPublic())).not.toContain("storeId");
    }
  });

  it("refuses two files, a plain value in file, and a form with no part", () => {
    const one = { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpegBytes() };
    for (const body of [
      multipartBody([one, one]),
      multipartBody([{ name: "file", bytes: ascii("not a file") }]),
      ascii(`--${TEST_BOUNDARY}--\r\n`),
    ]) {
      const error = caught(() => parseSingleFilePart(body, TEST_BOUNDARY));
      expect(error.status).toBe(400);
      expect(fieldOf(error)).toEqual({ path: "file", code: "invalid_type" });
    }
  });

  it("refuses a traversal file name with 400 invalid_format and does not echo it", () => {
    for (const filename of ["../../x.jpg", "/abs/x.jpg", "..\\x.jpg", `${"a".repeat(300)}.jpg`]) {
      const error = caught(() =>
        parseSingleFilePart(fileBody(jpegBytes(), filename), TEST_BOUNDARY),
      );
      expect(error.status).toBe(400);
      expect(fieldOf(error)).toEqual({ path: "file", code: "invalid_format" });
      expect(JSON.stringify(error.toPublic())).not.toContain("x.jpg");
    }
  });

  it.each([
    ["a preamble", (b: Uint8Array) => concat(ascii("preamble\r\n"), b)],
    ["another boundary", (b: Uint8Array) => b, "OtherBoundary"],
    ["no closing delimiter", (b: Uint8Array) => b.slice(0, b.byteLength - 30)],
    ["a truncated body", (b: Uint8Array) => b.slice(0, 40)],
  ])("refuses %s with 400 invalid_multipart", (_name, mutate, boundary = TEST_BOUNDARY) => {
    const error = caught(() => parseSingleFilePart(mutate(fileBody(jpegBytes())), boundary));
    expect(error.status).toBe(400);
    expect(fieldOf(error)).toEqual({ path: "", code: INVALID_MULTIPART_FIELD_CODE });
  });

  it.each([
    ["Content-Transfer-Encoding", { extraHeaders: ["Content-Transfer-Encoding: base64"] }],
    ["a repeated Content-Type", { extraHeaders: ["Content-Type: image/png"] }],
    ["a header line without a colon", { extraHeaders: ["garbage"] }],
    ["filename*", { disposition: `form-data; name="file"; filename*=UTF-8''a.jpg` }],
    ["a repeated name", { disposition: 'form-data; name="file"; name="x"; filename="a.jpg"' }],
    ["no name", { disposition: 'form-data; filename="a.jpg"' }],
    ["not form-data", { disposition: 'attachment; name="file"; filename="a.jpg"' }],
    ["an unclosed quote", { disposition: 'form-data; name="file; filename="a.jpg' }],
  ])("refuses %s with 400 invalid_multipart", (_name, extra) => {
    const body = multipartBody([
      { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpegBytes(), ...extra },
    ]);
    const error = caught(() => parseSingleFilePart(body, TEST_BOUNDARY));
    expect(error.status).toBe(400);
    expect(fieldOf(error)).toEqual({ path: "", code: INVALID_MULTIPART_FIELD_CODE });
  });

  it("refuses a header block longer than the limit", () => {
    const body = multipartBody([
      {
        name: "file",
        filename: "a.jpg",
        contentType: "image/jpeg",
        extraHeaders: [`X-Pad: ${"a".repeat(MAX_PART_HEADER_BYTES)}`],
        bytes: jpegBytes(),
      },
    ]);
    const error = caught(() => parseSingleFilePart(body, TEST_BOUNDARY));
    expect(fieldOf(error)).toEqual({ path: "", code: INVALID_MULTIPART_FIELD_CODE });
  });

  it("refuses header bytes that are not valid UTF-8", () => {
    const body = fileBody(jpegBytes(), "aXb.jpg");
    const index = body.indexOf("X".charCodeAt(0));
    body[index] = 0xff;
    const error = caught(() => parseSingleFilePart(body, TEST_BOUNDARY));
    expect(fieldOf(error)).toEqual({ path: "", code: INVALID_MULTIPART_FIELD_CODE });
  });

  it("accepts an unquoted token name", () => {
    const body = multipartBody([
      {
        name: "file",
        disposition: 'form-data; name=file; filename="a.jpg"',
        contentType: "image/jpeg",
        bytes: jpegBytes(),
      },
    ]);
    expect(parseSingleFilePart(body, TEST_BOUNDARY).filename).toBe("a.jpg");
  });
});

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}
