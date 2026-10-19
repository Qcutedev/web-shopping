/**
 * Reads and checks the body of `POST /seller/uploads` (docs/API_CONTRACTS.md sections 1.8 and
 * 5.8; SECURITY.md SR-05, TM-17). The only reader of a multipart body in the application
 * (SR-05 item 1). Called by the handler after steps 1 to 5, never before: a caller who is going
 * to be refused never gets a byte of the body read.
 *
 * Order, the first failure gives the answer:
 *
 *   1. the body is read under MAX_UPLOAD_BODY_BYTES (one 5 MB file plus 16 KiB of framing), by
 *      `Content-Length` first and then on the bytes as they arrive: 413. A body that stops
 *      arriving is a client error (provisional, item 8.2-13);
 *   2. the framing: the boundary of the content type, the delimiters, the part headers, exactly
 *      one part, named `file`, holding a file whose client name is acceptable: 400;
 *   3. the file's size, at most MAX_UPLOAD_FILE_BYTES: 413;
 *   4. the type: the leading bytes must show an allowed type, and the declared `Content-Type` and
 *      the file name's extension must name that same type: 415.
 *
 * Nothing is stored here, and nothing of the body is logged.
 */
import { readRawBodyBytes } from "@/server/http";

import { detectImageType } from "./content";
import { fileTooLarge, unsupportedImage } from "./errors";
import { parseBoundary, parseSingleFilePart } from "./multipart";
import {
  isUploadContentType,
  MAX_UPLOAD_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  UPLOAD_EXTENSIONS,
  type ValidatedImage,
} from "./schema";

/** The extension of a client file name, lower-cased, or "" when it has none. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * The checks of steps 3 and 4 on a parsed file. Exported for unit tests; the handler calls
 * `readUploadRequest`.
 */
export function checkImage(file: {
  filename: string;
  declaredType: string;
  bytes: Uint8Array;
}): ValidatedImage {
  if (file.bytes.byteLength > MAX_UPLOAD_FILE_BYTES) throw fileTooLarge();
  const detected = detectImageType(file.bytes);
  if (detected === null) throw unsupportedImage();
  if (!isUploadContentType(file.declaredType) || file.declaredType !== detected) {
    throw unsupportedImage();
  }
  if (!UPLOAD_EXTENSIONS[detected].includes(extensionOf(file.filename))) throw unsupportedImage();
  return { contentType: detected, bytes: file.bytes };
}

export async function readUploadRequest(request: Request): Promise<ValidatedImage> {
  const body = await readRawBodyBytes(request, MAX_UPLOAD_BODY_BYTES);
  const boundary = parseBoundary(request.headers.get("content-type"));
  return checkImage(parseSingleFilePart(body, boundary));
}
