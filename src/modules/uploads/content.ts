/**
 * Content check of an uploaded image by its leading bytes (REQ-S-05; SECURITY.md TM-17). The
 * extension and the declared type are what the client says; the leading bytes are what the file
 * is. Pure; unit-tested.
 *
 *   JPEG  FF D8 FF                                   (SOI marker, then the next marker)
 *   PNG   89 50 4E 47 0D 0A 1A 0A, then the IHDR chunk (length 13, type "IHDR")
 *   WebP  "RIFF" <size> "WEBP" and a first chunk "VP8 ", "VP8L", or "VP8X"
 *
 * Anything else, SVG, HTML, GIF, PDF, and text with an image name included, is not an allowed
 * type. A file can still carry other data after valid leading bytes (a polyglot); it is served
 * only with its recorded image type and `nosniff`, never as anything a browser would run.
 */
import type { UploadContentType } from "./schema";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Length field (13, big-endian) and type of the IHDR chunk that must follow the signature. */
const PNG_IHDR = [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52] as const;

function startsWith(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const WEBP_CHUNKS = [ascii("VP8 "), ascii("VP8L"), ascii("VP8X")];

function isJpeg(bytes: Uint8Array): boolean {
  // SOI, then a marker byte; at least one more byte so a three-byte file is not an image.
  return bytes.length > 3 && startsWith(bytes, 0, [0xff, 0xd8, 0xff]);
}

function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, 0, PNG_SIGNATURE) && startsWith(bytes, 8, PNG_IHDR);
}

function isWebp(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, 0, RIFF) || !startsWith(bytes, 8, WEBP)) return false;
  if (!WEBP_CHUNKS.some((chunk) => startsWith(bytes, 12, chunk))) return false;
  // The RIFF size (little-endian) counts everything after its own field and must fit the file.
  const riffSize =
    (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 24);
  const declared = riffSize >>> 0;
  return declared >= 4 && declared + 8 <= bytes.length;
}

/** The allowed image type the leading bytes show, or null when they show none. */
export function detectImageType(bytes: Uint8Array): UploadContentType | null {
  if (isJpeg(bytes)) return "image/jpeg";
  if (isPng(bytes)) return "image/png";
  if (isWebp(bytes)) return "image/webp";
  return null;
}
