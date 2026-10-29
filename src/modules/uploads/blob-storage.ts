/**
 * The Vercel Blob adapter of `StorageProvider` (D-051), for a host without a persistent disk.
 *
 * Design, the same as the local disk adapter's from the caller's side:
 *
 *   - **Private objects.** Every object is written with `access: "private"`: it has no public URL
 *     and is read only with the read-write token. Files are still served only through the file
 *     endpoint (`openFile`), which applies the access rules (SEC-068) and streams the bytes; no
 *     Blob URL ever reaches a client.
 *   - **Keys.** The object name is `uploads/<key>`, built only from a key that matched
 *     STORAGE_KEY_PATTERN (`assertKey`, a TypeError otherwise, before any request), so no request
 *     value is ever part of an object name (TM-18).
 *   - **Written once.** `put` sends `allowOverwrite: false` and `addRandomSuffix: false`: the store
 *     refuses a name that exists, and `put` rejects. A failed `put` deletes nothing, because the
 *     object it collided with is someone else's; a Blob write is all or nothing, so no partial
 *     object of its own is left.
 *   - **Missing is not an error.** `get` resolves null when there is no object; `delete` resolves
 *     false when there was none (a metadata request first, because the store's delete does not
 *     say), true when one was removed.
 *   - **SEC-073 marker.** The store root gets the marker object `uploads/.marketplace-uploads`
 *     before the first upload, as the local root gets its marker file. `assertReady` passes only
 *     when the marker is there, so a wrong token, another store, or an emptied store makes the
 *     orphan cleanup refuse to delete any row.
 *
 * The token is passed explicitly to every call, so the library never falls back to another
 * credential from the environment, and it is kept in a private field, so it is not part of
 * `JSON.stringify` or an inspected object. Library errors are passed on as they are; their
 * messages hold no token. Requests that write or look up metadata are bounded by
 * BLOB_REQUEST_TIMEOUT_MS so a slow store cannot hold the upload transaction (15 s) open to its
 * end; a read is not, because its stream is the response body and lasts as long as the client
 * takes to read it.
 */
import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

import { BLOB_READ_WRITE_TOKEN_PATTERN } from "@/server/env";

import {
  assertKey,
  type StorageProvider,
  type StoredObject,
  UPLOAD_ROOT_MARKER,
  UploadStorageNotReadyError,
} from "./storage";

/** Prefix of every object name this adapter writes. */
export const BLOB_PATH_PREFIX = "uploads/";

/** The SEC-073 marker object. */
export const BLOB_MARKER_PATHNAME = `${BLOB_PATH_PREFIX}${UPLOAD_ROOT_MARKER}`;

/** Upper bound of one write, delete, or metadata request, retries included. */
export const BLOB_REQUEST_TIMEOUT_MS = 10_000;

/** What the marker object holds. Its content is never read; only its presence counts. */
const MARKER_CONTENT = "marketplace uploads root marker (SEC-073)\n";

/** The type every object is stored with. The served type is the `Upload` row's, never this. */
const STORED_CONTENT_TYPE = "application/octet-stream";

export class VercelBlobStorage implements StorageProvider {
  readonly #token: string;
  /** True once the marker is known to exist in this store, so later uploads skip the check. */
  #markerKnown = false;

  constructor(token: string) {
    if (!BLOB_READ_WRITE_TOKEN_PATTERN.test(token)) {
      // The message names no part of the value: it may be a secret.
      throw new TypeError("VercelBlobStorage: the token is not a Vercel Blob read-write token.");
    }
    this.#token = token;
  }

  private pathnameOf(key: string): string {
    assertKey(key);
    return `${BLOB_PATH_PREFIX}${key}`;
  }

  /** True when an object exists under `pathname`, false when the store says it does not. */
  private async exists(pathname: string): Promise<boolean> {
    try {
      await head(pathname, {
        token: this.#token,
        abortSignal: AbortSignal.timeout(BLOB_REQUEST_TIMEOUT_MS),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw error;
    }
  }

  /**
   * Writes the SEC-073 marker when the store does not hold it yet. A marker written by another
   * instance at the same moment makes this write fail; the marker is then looked up once more and
   * its presence is enough.
   */
  async prepareRoot(): Promise<void> {
    if (this.#markerKnown) return;
    if (!(await this.exists(BLOB_MARKER_PATHNAME))) {
      try {
        await put(BLOB_MARKER_PATHNAME, MARKER_CONTENT, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "text/plain",
          token: this.#token,
          abortSignal: AbortSignal.timeout(BLOB_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (!(await this.exists(BLOB_MARKER_PATHNAME))) throw error;
      }
    }
    this.#markerKnown = true;
  }

  /** Throws UploadStorageNotReadyError unless the store holds the marker; any failure counts. */
  async assertReady(): Promise<void> {
    let ready = false;
    try {
      ready = await this.exists(BLOB_MARKER_PATHNAME);
    } catch {
      // Unreachable, refused, or timed out: the same answer, with nothing of the store in it.
    }
    if (!ready) throw new UploadStorageNotReadyError();
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const pathname = this.pathnameOf(key);
    await this.prepareRoot();
    await put(pathname, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: STORED_CONTENT_TYPE,
      token: this.#token,
      abortSignal: AbortSignal.timeout(BLOB_REQUEST_TIMEOUT_MS),
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    const pathname = this.pathnameOf(key);
    const result = await get(pathname, {
      access: "private",
      token: this.#token,
      // The length below is the `content-length` of the response. An encoded (compressed)
      // response would report the encoded length, which the service compares with the row.
      headers: { "accept-encoding": "identity" },
    });
    if (result === null) return null;
    if (result.statusCode !== 200) {
      // Only a conditional request can answer 304, and none is sent.
      throw new Error("VercelBlobStorage: the store answered a read without a body.");
    }
    return { body: result.stream, sizeBytes: result.blob.size };
  }

  async delete(key: string): Promise<boolean> {
    const pathname = this.pathnameOf(key);
    if (!(await this.exists(pathname))) return false;
    await del(pathname, {
      token: this.#token,
      abortSignal: AbortSignal.timeout(BLOB_REQUEST_TIMEOUT_MS),
    });
    return true;
  }
}
