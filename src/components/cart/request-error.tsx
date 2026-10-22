import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { th } from "@/i18n/th";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import type { ApiFailure } from "@/lib/api-client/http";
import { signInHref } from "@/lib/routes";

/**
 * Banner for a cart or checkout request that failed, in Thai. The whole failure goes to
 * `apiErrorMessage`, so the `reason` of a 409 (`CART_LINE_LIMIT`) selects its own text. A refusal
 * because the session ended links to the sign-in page that returns to `returnTo`, a fixed in-app
 * path.
 */
export function ShopRequestError({
  failure,
  returnTo,
}: {
  failure: Pick<ApiFailure, "status" | "code" | "reason">;
  returnTo: string;
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
      {apiErrorMessage(failure)}
    </Alert>
  );
}
