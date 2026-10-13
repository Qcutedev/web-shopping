import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { th } from "@/i18n/th";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import type { ApiFailure } from "@/lib/api-client/http";
import { signInHref } from "@/lib/routes";

/**
 * Banner for a request that failed, in Thai. A refusal because the session ended carries a link
 * to the sign-in page that comes back to `returnTo`, a fixed in-app path.
 */
export function RequestError({
  failure,
  returnTo,
  message,
}: {
  failure: Pick<ApiFailure, "status" | "code">;
  returnTo: string;
  /** Overrides the message mapped from the error code. */
  message?: string;
}) {
  const unauthenticated = failure.code === "UNAUTHENTICATED" || failure.status === 401;
  return (
    <Alert
      tone="danger"
      action={
        unauthenticated ? (
          <Link
            href={signInHref(returnTo)}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {th.shell.header.signIn}
          </Link>
        ) : undefined
      }
    >
      {message ?? apiErrorMessage(failure)}
    </Alert>
  );
}
