import Link from "next/link";
import { NoticeLabel } from "@/components/ui/notice-label";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";

const FOOTER_LINK =
  "type-small text-foreground-nav hover:text-foreground focus-ring inline-flex min-h-11 items-center rounded-sm";

/**
 * Storefront footer: name, description, links, and the persistent labels that the marketplace's
 * payment and shipping are simulated (CLAUDE.md, "Mock payment and simulated shipping must be
 * labelled"). The name comes from `th.site.name` (REQ-N-12).
 */
export function SiteFooter() {
  return (
    <footer className="border-border bg-surface-muted mt-14 border-t lg:mt-18">
      <div className="container-page flex flex-col gap-6 py-8 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-md flex-col gap-2">
          <p className="type-panel-title text-foreground">{th.site.name}</p>
          <p className="type-small text-foreground-secondary">{th.site.description}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            <li>
              <NoticeLabel>{th.notice.mockPayment}</NoticeLabel>
            </li>
            <li>
              <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
            </li>
          </ul>
        </div>
        <nav aria-label={th.shell.footer.navLabel}>
          <ul className="flex flex-col md:items-end">
            <li>
              <Link href={ROUTES.openStore} className={FOOTER_LINK}>
                {th.shell.header.openStore}
              </Link>
            </li>
            <li>
              <Link href={ROUTES.signIn} className={FOOTER_LINK}>
                {th.shell.header.signIn}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <p className="container-page type-caption text-foreground-muted border-border border-t py-4">
        {fill(th.shell.footer.copyright, { name: th.site.name })}
      </p>
    </footer>
  );
}
