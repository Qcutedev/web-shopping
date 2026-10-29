/**
 * Which storage the upload module uses, from the environment (D-051):
 *
 *   - `BLOB_READ_WRITE_TOKEN` set: Vercel Blob with private objects (`VercelBlobStorage`);
 *   - otherwise `UPLOAD_DIR`: the local disk (`LocalDiskStorage`);
 *   - both set, neither set, or a malformed value: UploadStorageNotConfiguredError.
 *
 * **Interim.** src/server/env.ts is the one place meant to read the environment, and it validates
 * both variables with the same rules at start-up (`UPLOAD_DIR` absolute and not blank;
 * `BLOB_READ_WRITE_TOKEN` matching BLOB_READ_WRITE_TOKEN_PATTERN; not both). Until
 * `getUploadStorage` reads `getEnv()` instead, these readers read the variables themselves with
 * the same rules env.ts follows: no value is ever logged or put into an error, and a missing or
 * invalid value fails closed.
 *
 * No default directory is assumed, because where files live on a server is the operator's choice
 * and a guessed directory could be one that is not persistent.
 */
import { isAbsolute } from "node:path";

import { BLOB_READ_WRITE_TOKEN_PATTERN } from "@/server/env";

import { VercelBlobStorage } from "./blob-storage";
import { LocalDiskStorage, type StorageProvider } from "./storage";

export const UPLOAD_DIR_VARIABLE = "UPLOAD_DIR";
export const BLOB_TOKEN_VARIABLE = "BLOB_READ_WRITE_TOKEN";

const NOT_CONFIGURED_MESSAGES = {
  "upload-dir": `${UPLOAD_DIR_VARIABLE} must be set to an absolute directory path, or ${BLOB_TOKEN_VARIABLE} to a Vercel Blob read-write token.`,
  "blob-token": `${BLOB_TOKEN_VARIABLE} must be a Vercel Blob read-write token.`,
  both: `Set only one of ${UPLOAD_DIR_VARIABLE} and ${BLOB_TOKEN_VARIABLE}.`,
} as const;

export type UploadStorageConfigProblem = keyof typeof NOT_CONFIGURED_MESSAGES;

/** The upload storage is not configured. The message names variables, never a value. */
export class UploadStorageNotConfiguredError extends Error {
  readonly problem: UploadStorageConfigProblem;

  constructor(problem: UploadStorageConfigProblem = "upload-dir") {
    super(NOT_CONFIGURED_MESSAGES[problem]);
    this.name = "UploadStorageNotConfiguredError";
    this.problem = problem;
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readUploadDir(source: EnvSource = process.env): string {
  const value = source[UPLOAD_DIR_VARIABLE];
  if (value === undefined || value.trim() === "" || !isAbsolute(value)) {
    throw new UploadStorageNotConfiguredError("upload-dir");
  }
  return value;
}

/**
 * The Blob token, or undefined when the variable is not set or empty (as env.ts counts it).
 * Throws UploadStorageNotConfiguredError for a value of the wrong form.
 */
export function readBlobToken(source: EnvSource = process.env): string | undefined {
  const value = source[BLOB_TOKEN_VARIABLE];
  if (value === undefined || value === "") return undefined;
  if (!BLOB_READ_WRITE_TOKEN_PATTERN.test(value)) {
    throw new UploadStorageNotConfiguredError("blob-token");
  }
  return value;
}

/**
 * One Blob adapter per token and process, so the marker check of its first upload (SEC-073) is
 * not repeated on every request. A different token (a test, a rotated token after a restart) gets
 * a new adapter.
 */
let blobStorage: { token: string; storage: VercelBlobStorage } | undefined;

function blobStorageFor(token: string): VercelBlobStorage {
  if (blobStorage?.token !== token) {
    blobStorage = { token, storage: new VercelBlobStorage(token) };
  }
  return blobStorage.storage;
}

/**
 * The storage the upload endpoint, the file endpoint, and the orphan cleanup use. The local disk
 * adapter holds no state and is built on every call, so a configuration change in a test takes
 * effect at once. Throws UploadStorageNotConfiguredError when the configuration is missing,
 * malformed, or names both storages, which is a 500 with nothing disclosed.
 */
export function getUploadStorage(source: EnvSource = process.env): StorageProvider {
  const token = readBlobToken(source);
  if (token !== undefined) {
    const uploadDir = source[UPLOAD_DIR_VARIABLE];
    if (uploadDir !== undefined && uploadDir !== "") {
      throw new UploadStorageNotConfiguredError("both");
    }
    return blobStorageFor(token);
  }
  return new LocalDiskStorage(readUploadDir(source));
}
