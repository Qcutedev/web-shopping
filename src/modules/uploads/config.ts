/**
 * Where the local disk adapter keeps files: the `UPLOAD_DIR` variable (docs/DEPLOYMENT.md,
 * "Variables not validated yet").
 *
 * **Interim.** src/server/env.ts is the one place meant to read the environment, and it belongs
 * to devops, who adds `UPLOAD_DIR` to it and to `.env.example` (requested in the T-041 report).
 * Until then this function reads the one variable itself, with the same rules env.ts follows: the
 * value is never logged or put into an error, and a missing or invalid value fails closed. When
 * env.ts has it, `getUploadStorage` reads `getEnv().uploadDir` instead and this reader goes.
 *
 * The value must be an absolute path; no default is assumed, because where files live on a server
 * is the operator's choice and a guessed directory could be one that is not persistent.
 */
import { isAbsolute } from "node:path";

import { LocalDiskStorage, type StorageProvider } from "./storage";

export const UPLOAD_DIR_VARIABLE = "UPLOAD_DIR";

/** The upload directory is not configured. The message names the variable, never a value. */
export class UploadStorageNotConfiguredError extends Error {
  constructor() {
    super(`${UPLOAD_DIR_VARIABLE} must be set to an absolute directory path.`);
    this.name = "UploadStorageNotConfiguredError";
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readUploadDir(source: EnvSource = process.env): string {
  const value = source[UPLOAD_DIR_VARIABLE];
  if (value === undefined || value.trim() === "" || !isAbsolute(value)) {
    throw new UploadStorageNotConfiguredError();
  }
  return value;
}

/**
 * The storage the upload endpoint and the file endpoint use. Built on every call (it holds no
 * state), so a configuration change in a test takes effect at once. Throws
 * UploadStorageNotConfiguredError when `UPLOAD_DIR` is missing, which is a 500 with nothing
 * disclosed.
 */
export function getUploadStorage(source: EnvSource = process.env): StorageProvider {
  return new LocalDiskStorage(readUploadDir(source));
}
