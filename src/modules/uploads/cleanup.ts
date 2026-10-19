/**
 * The orphan cleanup of section 5.8 "Lifetime" (docs/API_CONTRACTS.md; DATA_MODEL.md section 8;
 * SECURITY.md SEC-065). No request reaches it.
 *
 *   - `cleanUpExpiredOrphans({ storage })` deletes every upload that nothing references and that is
 *     older than ORPHAN_GRACE_PERIOD_SECONDS: in batches of ORPHAN_CLEANUP_BATCH_SIZE rows, each
 *     batch one transaction (`deleteExpiredOrphans`), at most ORPHAN_CLEANUP_MAX_BATCHES batches
 *     per run. The rows go first; the bytes of each deleted row are deleted after its batch
 *     committed. A file whose deletion fails stays without a row: it is never served (`openFile`
 *     needs the row) and one warn line names its key, so an operator can remove it.
 *   - `runUploadCleanup()` is one run with its log line; never throws.
 *   - `startUploadCleanupSchedule()` runs it once at start and then every
 *     ORPHAN_CLEANUP_INTERVAL_MS, one schedule per process (a `Symbol.for` key on `globalThis`,
 *     as the payment timeout sweep), never overlapping, the timer unref'd.
 *
 * **Not wired.** Nothing calls `startUploadCleanupSchedule` yet: the start-up hook
 * (src/instrumentation.ts) belongs to devops, who adds it beside the payment timeout sweep, outside
 * NODE_ENV=test (SEC-065 remediation item 1). Until then orphans past the grace period are no
 * longer served but their rows and bytes stay, and they keep counting against the store's cap
 * (MAX_UNATTACHED_UPLOADS_PER_STORE), which bounds the disk one store can fill.
 *
 * Several processes may run it at once: `FOR UPDATE ... SKIP LOCKED` gives each row to one of
 * them. Log lines hold counts and storage keys only (a key is a public identifier), never a store,
 * a user, or a file's bytes.
 */
import { describeErrorForLog } from "@/server/errors";
import { logger as defaultLogger, type Logger } from "@/server/logger";

import { getUploadStorage } from "./config";
import { deleteExpiredOrphans } from "./repository";
import { ORPHAN_GRACE_PERIOD_SECONDS } from "./schema";
import type { StorageProvider } from "./storage";

/** **Provisional (SEC-065).** Rows deleted per transaction. */
export const ORPHAN_CLEANUP_BATCH_SIZE = 100;
/** **Provisional (SEC-065).** Batches per run, so one run is bounded (1,000 rows). */
export const ORPHAN_CLEANUP_MAX_BATCHES = 10;
/** **Provisional (SEC-065).** One run an hour. */
export const ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

export interface CleanupResult {
  /** `Upload` rows deleted. */
  rowsDeleted: number;
  /** Their stored files deleted (a file already missing counts as deleted). */
  filesDeleted: number;
  /** Files whose deletion failed; each has one warn line with its key. */
  filesFailed: number;
}

export interface CleanupDependencies {
  storage: StorageProvider;
  log?: Pick<Logger, "warn">;
  graceSeconds?: number;
  batchSize?: number;
  maxBatches?: number;
  /** The row deletion; tests replace it. Default `deleteExpiredOrphans`. */
  deleteRows?: (graceSeconds: number, limit: number) => Promise<string[]>;
}

/** Deletes expired orphans, rows first, then their bytes. Throws only when a row batch fails. */
export async function cleanUpExpiredOrphans(deps: CleanupDependencies): Promise<CleanupResult> {
  const graceSeconds = deps.graceSeconds ?? ORPHAN_GRACE_PERIOD_SECONDS;
  const batchSize = deps.batchSize ?? ORPHAN_CLEANUP_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? ORPHAN_CLEANUP_MAX_BATCHES;
  const deleteRows = deps.deleteRows ?? deleteExpiredOrphans;
  const result: CleanupResult = { rowsDeleted: 0, filesDeleted: 0, filesFailed: 0 };
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const keys = await deleteRows(graceSeconds, batchSize);
    result.rowsDeleted += keys.length;
    for (const key of keys) {
      try {
        await deps.storage.delete(key);
        result.filesDeleted += 1;
      } catch {
        result.filesFailed += 1;
        deps.log?.warn("Stored bytes of a deleted orphan upload could not be deleted", {
          storageKey: key,
        });
      }
    }
    if (keys.length < batchSize) break;
  }
  return result;
}

/** One run with its log line: `info` with the counts, or `error` with the error's class and code. */
export async function runUploadCleanup(
  log: Logger = defaultLogger,
  run: () => Promise<CleanupResult> = () =>
    cleanUpExpiredOrphans({ storage: getUploadStorage(), log }),
): Promise<CleanupResult | undefined> {
  try {
    const result = await run();
    log.info("Upload orphan cleanup ran", { component: "upload-cleanup", ...result });
    return result;
  } catch (error) {
    const { errorClass, code } = describeErrorForLog(error);
    log.error("Upload orphan cleanup failed", {
      component: "upload-cleanup",
      errorClass,
      ...(code === undefined ? {} : { errorCode: code }),
    });
    return undefined;
  }
}

const SCHEDULE_KEY = Symbol.for("marketplace.uploads.orphanCleanupSchedule");

interface ScheduleState {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
}

type GlobalWithSchedule = typeof globalThis & { [SCHEDULE_KEY]?: ScheduleState };

export interface CleanupScheduleOptions {
  intervalMs?: number;
  logger?: Logger;
  run?: () => Promise<CleanupResult>;
}

/**
 * Starts the schedule of this process, once: a second call returns false and starts nothing.
 * Runs the cleanup at once and then every `intervalMs`.
 */
export function startUploadCleanupSchedule(options: CleanupScheduleOptions = {}): boolean {
  const holder = globalThis as GlobalWithSchedule;
  if (holder[SCHEDULE_KEY] !== undefined) return false;
  const intervalMs = options.intervalMs ?? ORPHAN_CLEANUP_INTERVAL_MS;
  const log = options.logger ?? defaultLogger;

  const tick = (): void => {
    const state = holder[SCHEDULE_KEY];
    if (state === undefined || state.running) return;
    state.running = true;
    void runUploadCleanup(log, options.run).finally(() => {
      state.running = false;
    });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  holder[SCHEDULE_KEY] = { timer, running: false };
  tick();
  return true;
}

/** Stops the schedule of this process (for tests and an orderly shutdown). */
export function stopUploadCleanupSchedule(): void {
  const holder = globalThis as GlobalWithSchedule;
  const state = holder[SCHEDULE_KEY];
  if (state === undefined) return;
  clearInterval(state.timer);
  delete holder[SCHEDULE_KEY];
}
