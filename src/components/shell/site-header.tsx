import Link from "next/link";
import { SearchField } from "@/components/ui/search-field";
import { th } from "@/i18n/th";
import { ROUTES, SEARCH_QUERY_PARAM } from "@/lib/routes";
import { CartLink } from "./cart-link";

const NAV_LINK =
  "type-label text-foreground-nav hover:text-foreground focus-ring inline-flex min-h-11 items-center rounded-sm px-2";

/**
 * Storefront header: brand, pill search, "เปิดร้านค้า", "เข้าสู่ระบบ", and the cart button
 * (docs/DESIGN_SYSTEM.md, "Storefront header"). It renders no request data, so it stays in the
 * static shell. Below 640 px the search field takes its own row and "เปิดร้านค้า" moves to the
 * footer, where it is always present.
 *
 * Not in this task: the second row of category links (needs the category pages of T-021) and a
 * signed-in state (needs the sign-in page and an account menu).
 */
export function SiteHeader() {
  return (
    <header className="border-border bg-background border-b">
      <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <Link
          href={ROUTES.home}
          className="type-panel-title text-foreground focus-ring order-1 rounded-sm"
        >
          {th.site.name}
        </Link>
        <div className="order-3 w-full md:order-2 md:w-auto md:flex-1">
          <SearchField
            action={ROUTES.search}
            name={SEARCH_QUERY_PARAM}
            label={th.shell.header.search.label}
            submitLabel={th.shell.header.search.submit}
          />
        </div>
        <nav
          aria-label={th.shell.header.navLabel}
          className="order-2 ml-auto flex items-center gap-1 md:order-3"
        >
          <Link href={ROUTES.openStore} className={`${NAV_LINK} hidden sm:inline-flex`}>
            {th.shell.header.openStore}
          </Link>
          <Link href={ROUTES.signIn} className={NAV_LINK}>
            {th.shell.header.signIn}
          </Link>
          <CartLink />
        </nav>
      </div>
    </header>
  );
}
