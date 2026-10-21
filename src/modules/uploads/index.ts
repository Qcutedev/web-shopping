/**
 * Public surface of the upload module (docs/API_CONTRACTS.md section 5.8). Route handlers import
 * from here only.
 */
export {
  cleanUpExpiredOrphans,
  type CleanupResult,
  ORPHAN_CLEANUP_BATCH_SIZE,
  ORPHAN_CLEANUP_INTERVAL_MS,
  ORPHAN_CLEANUP_MAX_BATCHES,
  runUploadCleanup,
  startUploadCleanupSchedule,
  stopUploadCleanupSchedule,
} from "./cleanup";
export { getUploadStorage, UploadStorageNotConfiguredError } from "./config";
export { detectImageType } from "./content";
export { readUploadRequest } from "./reader";
export * from "./schema";
export {
  type ActorResolver,
  assertUploadAllowance,
  createUpload,
  type FileAccess,
  mayServe,
  openFile,
  type OpenedFile,
  type UploadDependencies,
} from "./service";
export {
  generateStorageKey,
  LocalDiskStorage,
  type StorageProvider,
  UPLOAD_ROOT_MARKER,
  UploadStorageNotReadyError,
} from "./storage";
