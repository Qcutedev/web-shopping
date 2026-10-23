import { th } from "@/i18n/th";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import type { ApiFailure } from "@/lib/api-client/http";

/**
 * Thai copy for a refused admin request. Adds the admin codes and the `reason` of a
 * `409 CONFLICT` (API_CONTRACTS 5.9) to the shared mapping; the English `message` is never shown.
 */
export function adminErrorMessage(
  error: Pick<ApiFailure, "status" | "code"> & { reason?: string },
): string {
  const errors = th.admin.errors;
  switch (error.code) {
    case "INVALID_STATE_TRANSITION":
      return errors.invalidTransition;
    case "PAYLOAD_TOO_LARGE":
      return errors.payloadTooLarge;
    case "UNSUPPORTED_MEDIA_TYPE":
      return errors.unsupportedMedia;
    case "CONFLICT": {
      const reasons: Readonly<Record<string, string>> = errors.reasons;
      if (error.reason !== undefined && Object.hasOwn(reasons, error.reason)) {
        const text = reasons[error.reason];
        if (typeof text === "string") return text;
      }
      return errors.conflict;
    }
    default:
      return apiErrorMessage(error);
  }
}
