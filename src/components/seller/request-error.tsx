import { RequestError } from "@/components/account/request-error";
import type { ApiFailure } from "@/lib/api-client/http";
import { sellerErrorMessage } from "./error-copy";

export type SellerFailure = Pick<ApiFailure, "status" | "code"> & { reason?: string };

/** Banner for a failed seller request, with the seller copy of the error code and reason. */
export function SellerRequestError({
  failure,
  returnTo,
}: {
  failure: SellerFailure;
  returnTo: string;
}) {
  return (
    <RequestError failure={failure} returnTo={returnTo} message={sellerErrorMessage(failure)} />
  );
}
