import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { signInHref } from "@/lib/routes";
import type { Actor } from "@/server/auth/actor";
import { getActor } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { AdminForbiddenState, AdminLoadError } from "./load-state";

export interface WithAdminOptions {
  /** Where the retry link of the error state goes. Defaults to `returnTo`. */
  retryHref?: string;
  /** Rendered instead of the load error when the service answers 404. */
  notFound?: ReactNode;
}

/**
 * Server-side frame of every admin data section: reads the session, redirects a visitor to
 * sign-in, answers anyone who is not an admin with a refusal, then calls `render` with the actor.
 * The checks here are a convenience: every admin service checks the role `ADMIN` again before it
 * reads anything, and the server decides. A read that fails shows the error state with a retry
 * link; a 404 shows `options.notFound`.
 */
export async function renderForAdmin(
  returnTo: string,
  render: (actor: Actor) => Promise<ReactNode>,
  options: WithAdminOptions = {},
): Promise<ReactNode> {
  const { retryHref = returnTo, notFound } = options;

  let actor: Actor | null;
  try {
    actor = await getActor(await headers());
  } catch (error) {
    unstable_rethrow(error);
    return <AdminLoadError retryHref={retryHref} />;
  }
  if (actor === null) redirect(signInHref(returnTo));
  if (actor.role !== "ADMIN") return <AdminForbiddenState />;

  try {
    return await render(actor);
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) {
      if (error.code === "UNAUTHENTICATED") redirect(signInHref(returnTo));
      if (error.code === "FORBIDDEN") return <AdminForbiddenState />;
      if (error.code === "NOT_FOUND" && notFound !== undefined) return notFound;
    }
    return <AdminLoadError retryHref={retryHref} />;
  }
}
