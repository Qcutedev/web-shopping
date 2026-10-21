import { th } from "@/i18n/th";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import type { ApiFailure } from "@/lib/api-client/http";

/**
 * Thai copy for a refused seller request. Adds the seller-specific codes and the `reason` of a
 * `409 CONFLICT` (API_CONTRACTS 2.3) to the shared mapping; the English `message` is never shown.
 */
export function sellerErrorMessage(
  error: Pick<ApiFailure, "status" | "code"> & { reason?: string },
): string {
  const errors = th.seller.errors;
  switch (error.code) {
    case "SELLER_NOT_APPROVED":
      return errors.sellerNotApproved;
    case "INVALID_STATE_TRANSITION":
      return errors.invalidTransition;
    case "PAYLOAD_TOO_LARGE":
      return errors.payloadTooLarge;
    case "UNSUPPORTED_MEDIA_TYPE":
      return errors.unsupportedMedia;
    case "CONFLICT": {
      const reasons: Readonly<Record<string, string>> = errors.reasons;
      return (error.reason !== undefined ? reasons[error.reason] : undefined) ?? errors.conflict;
    }
    default:
      return apiErrorMessage(error);
  }
}
