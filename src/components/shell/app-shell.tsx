import type { ReactNode } from "react";
import { th } from "@/i18n/th";
import { AnnouncementBar } from "./announcement-bar";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const MAIN_CONTENT_ID = "main-content";

/**
 * The storefront page frame: skip link, header, the single `main` landmark, footer. Pages render
 * their content inside it and must not add another `main`. The `h1` belongs to each page.
 */
export function AppShell({
  children,
  headerSession,
}: {
  children: ReactNode;
  headerSession?: ReactNode;
}) {
  return (
    <>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="focus-ring bg-surface text-foreground type-label sr-only rounded-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-3"
      >
        {th.shell.skipToContent}
      </a>
      <AnnouncementBar />
      <SiteHeader session={headerSession} />
      {/* tabIndex -1 lets the skip link move focus here, not only scroll. The element is not
          interactive, so the focus outline is removed. */}
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
