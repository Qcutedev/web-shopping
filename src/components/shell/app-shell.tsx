import type { ReactNode } from "react";
import { th } from "@/i18n/th";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const MAIN_CONTENT_ID = "main-content";

/**
 * The storefront page frame: skip link, header, the single `main` landmark, footer. Pages render
 * their content inside it and must not add another `main`. The `h1` belongs to each page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="focus-ring bg-surface text-foreground type-label sr-only rounded-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-3"
      >
        {th.shell.skipToContent}
      </a>
      <SiteHeader />
      <main id={MAIN_CONTENT_ID} className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
