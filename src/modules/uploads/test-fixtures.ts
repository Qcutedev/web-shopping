/**
 * Test helpers of the upload module: generated image bytes and multipart bodies. Used by the
 * unit tests here and by tests/integration/uploads. Not imported by application code. Fixture
 * files are generated, never committed binaries (docs/TEST_STRATEGY.md, "Uploads").
 */

/** Leading bytes of a JPEG (SOI, APP0 "JFIF"), padded with zeros to `size` bytes. */
export function jpegBytes(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(size, 12));
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  return bytes;
}

/** PNG signature and an IHDR chunk header, padded to `size` bytes. */
export function pngBytes(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(size, 16));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  return bytes;
}

/** `RIFF <size> WEBP VP8 `, with a RIFF size that matches `size`. */
export function webpBytes(size = 64): Uint8Array<ArrayBuffer> {
  const total = Math.max(size, 20);
  const bytes = new Uint8Array(total);
  bytes.set(ascii("RIFF"));
  new DataView(bytes.buffer).setUint32(4, total - 8, true);
  bytes.set(ascii("WEBP"), 8);
  bytes.set(ascii("VP8 "), 12);
  return bytes;
}

export function ascii(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

export const TEST_BOUNDARY = "----TestBoundary7MA4YWxkTrZu0gW";

export interface FormPart {
  name: string;
  /** Omitted: a plain value, not a file. */
  filename?: string;
  /** Omitted: no Content-Type header. */
  contentType?: string;
  /** Extra raw header lines, without CRLF. */
  extraHeaders?: string[];
  /** The raw Content-Disposition value, replacing the one built from name and filename. */
  disposition?: string;
  bytes: Uint8Array;
}

/** A `multipart/form-data` body with the given parts, as a browser frames it. */
export function multipartBody(
  parts: FormPart[],
  boundary = TEST_BOUNDARY,
): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const part of parts) {
    const disposition =
      part.disposition ??
      `form-data; name="${part.name}"` +
        (part.filename === undefined ? "" : `; filename="${part.filename}"`);
    const lines = [`--${boundary}`, `Content-Disposition: ${disposition}`];
    if (part.contentType !== undefined) lines.push(`Content-Type: ${part.contentType}`);
    lines.push(...(part.extraHeaders ?? []));
    chunks.push(
      encoder.encode(`${lines.join("\r\n")}\r\n\r\n`),
      part.bytes,
      encoder.encode("\r\n"),
    );
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** The body of a single-file upload. */
export function fileBody(
  bytes: Uint8Array,
  filename = "photo.jpg",
  contentType = "image/jpeg",
  boundary = TEST_BOUNDARY,
): Uint8Array<ArrayBuffer> {
  return multipartBody([{ name: "file", filename, contentType, bytes }], boundary);
}

export function multipartContentType(boundary = TEST_BOUNDARY): string {
  return `multipart/form-data; boundary=${boundary}`;
}
