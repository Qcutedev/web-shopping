import { type ReactNode, Suspense } from "react";
import { AppShell } from "./app-shell";
import { CartLink } from "./cart-link";
import { HeaderCategoryMenu, HeaderCategoryMenuSkeleton } from "./header-category-menu";
import { HeaderSession } from "./header-session";

/**
 * `AppShell` with the live session part of the header. The session is read behind the boundary, so
 * the rest of the shell stays static; the fallback is the cart link alone, so no sign-in links
 * flash for a signed-in user. Every route group that shows the shell uses this.
 */
export function StorefrontShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      headerMenu={
        <Suspense fallback={<HeaderCategoryMenuSkeleton />}>
          <HeaderCategoryMenu />
        </Suspense>
      }
      headerSession={
        <Suspense fallback={<CartLink />}>
          <HeaderSession />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
