import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { NoticeLabel } from "@/components/ui/notice-label";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";

const FOOTER_LINK =
  "type-small text-foreground-nav hover:text-primary focus-ring inline-flex min-h-11 items-center rounded-sm";

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <p className="type-label text-foreground mb-1">{title}</p>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className={FOOTER_LINK}>
        {children}
      </Link>
    </li>
  );
}

/**
 * Storefront footer: name, description, link columns, and the persistent labels that the
 * marketplace's payment and shipping are simulated (CLAUDE.md, "Mock payment and simulated
 * shipping must be labelled"). The name comes from `th.site.name` (REQ-N-12). Every link leads to
 * a page that exists.
 */
export function SiteFooter() {
  const { footer, header } = th.shell;
  return (
    <footer className="border-border bg-surface-muted mt-14 border-t lg:mt-18">
      <div className="container-page pt-8">
        <div className="bg-primary-soft flex flex-col gap-3 rounded-xl p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex flex-col gap-1">
            <p className="type-panel-title text-foreground">{footer.sellerCtaTitle}</p>
            <p className="type-small text-foreground-secondary">{footer.sellerCtaDescription}</p>
          </div>
          <Link
            href={ROUTES.openStore}
            className="focus-ring on-ink bg-ink text-on-ink type-label hover:bg-ink-hover inline-flex min-h-11 items-center justify-center rounded-full px-6 transition-transform duration-150 hover:scale-[1.04]"
          >
            {header.openStore}
          </Link>
        </div>
      </div>
      <div className="container-page grid gap-8 py-10 md:grid-cols-[1.6fr_1fr_1fr]">
        <div className="flex max-w-md flex-col gap-2">
          <p className="type-panel-title text-foreground flex items-center gap-2">
            <Image
              src="/brand/qubix-logo.png"
              alt=""
              width={36}
              height={36}
              className="size-9 rounded-md"
              unoptimized
            />
            {th.site.name}
          </p>
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
        <nav
          aria-label={footer.navLabel}
          className="grid grid-cols-2 gap-6 md:col-span-2 md:grid-cols-3"
        >
          <FooterColumn title={footer.shopTitle}>
            <FooterLink href={ROUTES.home}>{header.home}</FooterLink>
            <FooterLink href={ROUTES.search}>{footer.allProducts}</FooterLink>
            <FooterLink href={ROUTES.cart}>{footer.cart}</FooterLink>
          </FooterColumn>
          <FooterColumn title={footer.sellerTitle}>
            <FooterLink href={ROUTES.openStore}>{header.openStore}</FooterLink>
          </FooterColumn>
          <FooterColumn title={footer.accountTitle}>
            <FooterLink href={ROUTES.signIn}>{header.signIn}</FooterLink>
            <FooterLink href={ROUTES.signUp}>{footer.signUp}</FooterLink>
            <FooterLink href={ROUTES.orders}>{footer.myOrders}</FooterLink>
          </FooterColumn>
        </nav>
      </div>
      <p className="container-page type-caption text-foreground-muted border-border border-t py-4">
        {fill(footer.copyright, { name: th.site.name })}
      </p>
    </footer>
  );
}
