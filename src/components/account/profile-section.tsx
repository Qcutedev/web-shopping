import { redirect, unstable_rethrow } from "next/navigation";
import { ROUTES, signInHref } from "@/lib/routes";
import { getProfile, type ProfileDto } from "@/modules/profile";
import type { Actor } from "@/server/auth/actor";
import { isAppError } from "@/server/errors";
import { requireAccountActor } from "./account-actor";
import { AccountLoadError } from "./load-state";
import { ProfileCard } from "./profile-card";

/**
 * Server Component: reads the signed-in user's profile through the module service and hands the
 * three displayed fields to the client card. Reads the session, so it renders behind a Suspense
 * boundary (Cache Components).
 */
export async function ProfileSection() {
  let actor: Actor;
  try {
    actor = await requireAccountActor(ROUTES.account);
  } catch (error) {
    // The redirect of the guard is a framework signal and must pass through.
    unstable_rethrow(error);
    return <AccountLoadError retryHref={ROUTES.account} />;
  }

  let profile: ProfileDto;
  try {
    profile = await getProfile(actor);
  } catch (error) {
    unstable_rethrow(error);
    // A user deactivated since the guard is answered like a caller with no session.
    if (isAppError(error) && error.code === "UNAUTHENTICATED") {
      redirect(signInHref(ROUTES.account));
    }
    return <AccountLoadError retryHref={ROUTES.account} />;
  }

  return (
    <ProfileCard profile={{ name: profile.name, email: profile.email, phone: profile.phone }} />
  );
}
