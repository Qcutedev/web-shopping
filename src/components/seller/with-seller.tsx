import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import { signInHref } from "@/lib/routes";
import { getOwnStore } from "@/modules/sellers";
import type { Actor } from "@/server/auth/actor";
import { getActor } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { NotSellerState, SellerForbiddenState, SellerLoadError } from "./load-state";
import { SELLER_ROUTES } from "./routes";

export interface WithSellerOptions {
  /** `seller`: role `SELLER`. `applicant`: a customer who may apply; a seller is sent to the dashboard. */
  access?: "seller" | "applicant";
  /** Where the retry link of the error state goes. Defaults to `returnTo`. */
  retryHref?: string;
  /** Rendered instead of the load error when the service answers 404. */
  notFound?: ReactNode;
}

/** Banner for a suspended store (REQ-S-09, BR-14). The reason is shown when it could be read. */
export function SuspendedNotice({ reason }: { reason: string | null }) {
  return (
    <Alert tone="warning" title={th.seller.suspended.title} role="status">
      <p>{th.seller.suspended.body}</p>
      {reason ? (
        <p className={`mt-2 ${USER_NAME_CONTAINER_CLASS}`}>
          {th.seller.suspended.reasonLabel}: <UserName>{reason}</UserName>
        </p>
      ) : null}
    </Alert>
  );
}

export type OwnStore = Awaited<ReturnType<typeof getOwnStore>>;

/** Handed to `render`: the store of the session, read at most once per request (CR-108). */
export interface SellerContext {
  getStore: () => Promise<OwnStore>;
}

/**
 * Reads the actor's store through the service and remembers a successful read, so the suspension
 * banner and the section share one read. A failed read is not remembered: the next call tries again.
 */
function storeReader(actor: Actor): SellerContext {
  let stored: Promise<OwnStore> | null = null;
  return {
    getStore() {
      if (stored === null) {
        const read = getOwnStore(actor);
        stored = read;
        read.catch(() => {
          if (stored === read) stored = null;
        });
      }
      return stored;
    },
  };
}

async function readSuspensionReason(context: SellerContext): Promise<string | null> {
  try {
    return (await context.getStore()).statusReason;
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/**
 * Server-side frame of every seller data section: reads the session, redirects a visitor to
 * sign-in, answers a customer with the way to apply and an admin with a refusal, shows the
 * suspended-store notice, then calls `render` with the actor. The checks here are a convenience:
 * every module service checks the role, the store, and ownership again, and the server decides.
 * A read that fails shows the error state with a retry link; a 404 shows `options.notFound`.
 */
export async function renderForSeller(
  returnTo: string,
  render: (actor: Actor, context: SellerContext) => Promise<ReactNode>,
  options: WithSellerOptions = {},
): Promise<ReactNode> {
  const { access = "seller", retryHref = returnTo, notFound } = options;

  let actor: Actor | null;
  try {
    actor = await getActor(await headers());
  } catch (error) {
    unstable_rethrow(error);
    return <SellerLoadError retryHref={retryHref} />;
  }
  if (actor === null) redirect(signInHref(returnTo));

  if (actor.role === "ADMIN") return <SellerForbiddenState />;
  if (access === "applicant") {
    if (actor.role === "SELLER") redirect(SELLER_ROUTES.dashboard);
  } else if (actor.role !== "SELLER") {
    return <NotSellerState />;
  }

  const suspended = actor.role === "SELLER" && actor.storeStatus === "SUSPENDED";
  const context = storeReader(actor);
  const reason = suspended ? await readSuspensionReason(context) : null;

  let content: ReactNode;
  try {
    content = await render(actor, context);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) {
      if (error.code === "UNAUTHENTICATED") redirect(signInHref(returnTo));
      if (error.code === "FORBIDDEN") return <SellerForbiddenState />;
      if (error.code === "NOT_FOUND" && notFound !== undefined) return notFound;
    }
    return <SellerLoadError retryHref={retryHref} />;
  }

  if (!suspended) return content;
  return (
    <div className="flex flex-col gap-6">
      <SuspendedNotice reason={reason} />
      {content}
    </div>
  );
}
