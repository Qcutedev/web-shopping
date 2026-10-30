import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { NotifyBadge } from "@/components/ui/notify-badge";
import { countAdminPending } from "@/modules/notifications";
import { getActor } from "@/server/auth/session";
import { logger } from "@/server/logger";

/**
 * Server Component: the red count on an admin nav link (applications or products waiting for a
 * decision). Display only: it reads the session itself, a non-admin gets nothing, and a failed
 * read shows no badge. Rendered behind Suspense because it reads the session cookie.
 */
export async function AdminNavBadge({ kind }: { kind: "applications" | "products" }) {
  let count = 0;
  try {
    const actor = await getActor(await headers());
    if (actor !== null) count = await countAdminPending(actor, kind);
  } catch (error) {
    unstable_rethrow(error);
    logger.warn("admin.nav_badge.read_failed", {
      errorClass: error instanceof Error ? error.name : typeof error,
    });
  }
  return <NotifyBadge count={count} className="ms-2" />;
}
