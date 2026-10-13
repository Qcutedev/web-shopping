import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInHref } from "@/lib/routes";
import { getActor } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";

/**
 * The signed-in actor of this request for an account page, or a redirect to the sign-in page that
 * returns to `returnTo` (a fixed in-app path). The redirect is a convenience: every `/api/v1/me`
 * call and every module service checks the session again. A failure to read the session throws,
 * so the caller can show its error state.
 */
export async function requireAccountActor(returnTo: string): Promise<Actor> {
  const actor = await getActor(await headers());
  if (actor === null) redirect(signInHref(returnTo));
  return actor;
}
