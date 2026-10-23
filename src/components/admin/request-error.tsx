import { RequestError } from "@/components/account/request-error";
import type { ApiFailure } from "@/lib/api-client/http";
import { adminErrorMessage } from "./error-copy";

export type AdminFailure = Pick<ApiFailure, "status" | "code"> & { reason?: string };

/** Banner for a failed admin request, with the admin copy of the error code and reason. */
export function AdminRequestError({
  failure,
  returnTo,
}: {
  failure: AdminFailure;
  returnTo: string;
}) {
  return (
    <RequestError failure={failure} returnTo={returnTo} message={adminErrorMessage(failure)} />
  );
}
