/**
 * How a stored picture is named in a response: `{ key, url }` (docs/API_CONTRACTS.md section 4),
 * where `url` is the file endpoint `GET /api/files/{key}` of section 5.8.
 *
 * The key is percent-encoded into the path, so a key can never change the path it is put in.
 * The file endpoint itself, and the key pattern it checks, come with T-041.
 */
import type { ImageRef } from "./schema";

export const FILES_PATH_PREFIX = "/api/files/";

export function imageRef(storageKey: string): ImageRef {
  return { key: storageKey, url: `${FILES_PATH_PREFIX}${encodeURIComponent(storageKey)}` };
}
