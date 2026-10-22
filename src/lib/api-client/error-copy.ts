import { th } from "@/i18n/th";
import type { ApiFailure } from "./http";

/**
 * Thai copy for a refused or failed request (API_CONTRACTS 2.2: the frontend maps `code` to Thai;
 * the English `message` is never shown). Keyed by error code, then by status for the codes the
 * envelope does not carry.
 */
export function apiErrorMessage(
  error: Pick<ApiFailure, "status" | "code"> & { reason?: string },
): string {
  if (error.code === "CONFLICT" && error.reason !== undefined) {
    const reasons: Readonly<Record<string, string>> = th.errors.reasons;
    const text = reasons[error.reason];
    if (Object.hasOwn(reasons, error.reason) && typeof text === "string") return text;
  }
  switch (error.code) {
    case "NETWORK_ERROR":
      return th.errors.network;
    case "UNAUTHENTICATED":
      return th.errors.unauthenticated;
    case "FORBIDDEN":
      return th.errors.forbidden;
    case "NOT_FOUND":
      return th.errors.notFound;
    case "VALIDATION_ERROR":
      return th.errors.validation;
    case "RATE_LIMITED":
      return th.errors.rateLimited;
    default:
      break;
  }
  if (error.status === 401) return th.errors.unauthenticated;
  if (error.status === 404) return th.errors.notFound;
  return th.errors.unknown;
}
