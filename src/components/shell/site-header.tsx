import Link from "next/link";
import type { ReactNode } from "react";
import { SearchField } from "@/components/ui/search-field";
import { MAX_SEARCH_TEXT_LENGTH } from "@/modules/catalog/schema";
import { th } from "@/i18n/th";
import { ROUTES, SEARCH_QUERY_PARAM } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { CartLink } from "./cart-link";
import { NAV_LINK } from "./nav-link";

/**
 * Storefront header: brand, pill search, "เปิดร้านค้า", the session part, and the cart button
 * (docs/DESIGN_SYSTEM.md, "Storefront header"). It renders no request data, so it stays in the
 * static shell. Below 768 px the search field takes its own row. "เปิดร้านค้า" shows at every
 * width (D-036 item 8, CR-70); the footer keeps its own link too.
 *
 * `session` is the session-dependent part of the nav (sign-up and sign-in links, or the account
 * menu, then the cart link). The layout passes it behind Suspense; the default is the plain cart
 * link, which is also the loading state. Not in this task: the second row of category links.
 */
export function SiteHeader({
  session = <CartLink />,
  menu = null,
}: {
  session?: ReactNode;
  /** The hamburger button and its category panel, placed before the brand. */
  menu?: ReactNode;
}) {
  return (
    <header className="border-border bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        {/* DOM order is the visual order below 768 px: brand, nav, then the search row. From
            768 px the search sits between brand and nav through `md:order-*`. */}
        {menu === null ? null : <div className="order-1 -ml-2">{menu}</div>}
        <Link
          href={ROUTES.home}
          className="type-panel-title text-foreground focus-ring order-1 inline-flex min-h-11 items-center gap-2 rounded-sm"
        >
          <span
            aria-hidden="true"
            className="bg-primary text-on-primary flex size-9 items-center justify-center rounded-md"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
            >
              <path d="M5 8h14l-1 12H6L5 8z" />
              <path d="M9 8V7a3 3 0 016 0v1" />
            </svg>
          </span>
          {th.site.name}
        </Link>
        <nav
          aria-label={th.shell.header.navLabel}
          className="order-2 ml-auto flex items-center gap-1 md:order-3"
        >
          <Link href={ROUTES.home} className={cn(NAV_LINK, "hidden lg:inline-flex")}>
            {th.shell.header.home}
          </Link>
          <Link href={ROUTES.search} className={cn(NAV_LINK, "hidden lg:inline-flex")}>
            {th.shell.footer.allProducts}
          </Link>
          <Link href={ROUTES.openStore} className={NAV_LINK}>
            {th.shell.header.openStore}
          </Link>
          {session}
        </nav>
        <div className="order-3 w-full md:order-2 md:w-auto md:flex-1">
          <SearchField
            action={ROUTES.search}
            name={SEARCH_QUERY_PARAM}
            label={th.shell.header.search.label}
            submitLabel={th.shell.header.search.submit}
            inputProps={{ maxLength: MAX_SEARCH_TEXT_LENGTH }}
          />
        </div>
      </div>
    </header>
  );
}
