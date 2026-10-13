import Link from "next/link";
import { SearchField } from "@/components/ui/search-field";
import { MAX_SEARCH_TEXT_LENGTH } from "@/modules/catalog/schema";
import { th } from "@/i18n/th";
import { ROUTES, SEARCH_QUERY_PARAM } from "@/lib/routes";
import { CartLink } from "./cart-link";

const NAV_LINK =
  "type-label text-foreground-nav hover:text-foreground focus-ring inline-flex min-h-11 items-center rounded-sm px-2";

/**
 * Storefront header: brand, pill search, "เปิดร้านค้า", "เข้าสู่ระบบ", and the cart button
 * (docs/DESIGN_SYSTEM.md, "Storefront header"). It renders no request data, so it stays in the
 * static shell. Below 768 px the search field takes its own row. "เปิดร้านค้า" shows at every
 * width (D-036 item 8, CR-70); the footer keeps its own link too.
 *
 * Not in this task: the second row of category links (needs the category pages of T-021) and a
 * signed-in state (needs the sign-in page and an account menu).
 */
export function SiteHeader() {
  return (
    <header className="border-border bg-background border-b">
      <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        {/* DOM order is the visual order below 768 px: brand, nav, then the search row. From
            768 px the search sits between brand and nav through `md:order-*`. */}
        <Link
          href={ROUTES.home}
          className="type-panel-title text-foreground focus-ring order-1 inline-flex min-h-11 items-center rounded-sm"
        >
          {th.site.name}
        </Link>
        <nav
          aria-label={th.shell.header.navLabel}
          className="order-2 ml-auto flex items-center gap-1 md:order-3"
        >
          <Link href={ROUTES.openStore} className={NAV_LINK}>
            {th.shell.header.openStore}
          </Link>
          <Link href={ROUTES.signIn} className={NAV_LINK}>
            {th.shell.header.signIn}
          </Link>
          <CartLink />
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
