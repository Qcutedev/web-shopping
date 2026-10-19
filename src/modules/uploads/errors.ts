/**
 * Upload errors (docs/API_CONTRACTS.md sections 2.3 and 5.8). Messages are developer-facing and
 * never repeat anything of the request: no file name, no field name, no byte of the file.
 *
 * - A multipart body whose framing cannot be read: `400 VALIDATION_ERROR`, one field error at the
 *   root with the provisional code `invalid_multipart`.
 * - A form field other than `file` (provisional, item 8.2-8): `400`, path `""`, code
 *   `unrecognized_keys`, as an unknown key of a JSON body.
 * - No file in `file`, a `file` that is a plain value, or more than one: `400`, path `file`.
 * - A client file name that could name a path (separators, `..`, control characters, encoded
 *   separators) or is empty or longer than 255 characters: `400`, path `file`, code
 *   `invalid_format`. The name is never used either way; refusing it keeps such names out of
 *   every log and every later consumer.
 * - A file over 5 MB: `413 PAYLOAD_TOO_LARGE`.
 * - A declared type, an extension, or leading bytes that are not one allowed type, or that do not
 *   agree with each other: `415 UNSUPPORTED_MEDIA_TYPE`.
 * - The store is not `APPROVED` when the row is written: `403 SELLER_NOT_APPROVED`.
 * - The store holds MAX_UNATTACHED_UPLOADS_PER_STORE uploads nothing references (SEC-065):
 *   `409 CONFLICT`, reason `UPLOAD_LIMIT` (provisional).
 * - A file key that does not match the pattern, has no upload, has no bytes, or belongs to an
 *   orphan past the grace period: `404 NOT_FOUND`.
 */
import {
  type AppError,
  conflict,
  notFound,
  payloadTooLarge,
  sellerNotApproved,
  unsupportedMediaType,
  validationError,
} from "@/server/errors";

import { INVALID_MULTIPART_FIELD_CODE, UPLOAD_FIELD_NAME, UPLOAD_LIMIT_REASON } from "./schema";

export function malformedMultipart(message: string): AppError {
  return validationError([{ path: "", code: INVALID_MULTIPART_FIELD_CODE, message }]);
}

export function unknownFormField(): AppError {
  return validationError([
    {
      path: "",
      code: "unrecognized_keys",
      message: `The form may hold only the field ${UPLOAD_FIELD_NAME}.`,
    },
  ]);
}

export function fileMissing(): AppError {
  return validationError([
    {
      path: UPLOAD_FIELD_NAME,
      code: "invalid_type",
      message: `The field ${UPLOAD_FIELD_NAME} must hold exactly one file.`,
    },
  ]);
}

export function invalidClientFilename(): AppError {
  return validationError([
    { path: UPLOAD_FIELD_NAME, code: "invalid_format", message: "The file name is not allowed." },
  ]);
}

export function fileTooLarge(): AppError {
  // The generic message, as for a body over its limit (section 1.1).
  return payloadTooLarge();
}

export function unsupportedImage(): AppError {
  return unsupportedMediaType({ message: "The file must be a JPEG, PNG, or WebP image." });
}

export function uploadStoreNotApproved(): AppError {
  return sellerNotApproved();
}

/**
 * The store already holds MAX_UNATTACHED_UPLOADS_PER_STORE uploads that nothing references
 * (SEC-065): `409 CONFLICT`, reason UPLOAD_LIMIT_REASON (provisional). Says nothing of the count.
 */
export function uploadLimitReached(): AppError {
  return conflict(UPLOAD_LIMIT_REASON);
}

export function fileNotFound(): AppError {
  return notFound();
}
