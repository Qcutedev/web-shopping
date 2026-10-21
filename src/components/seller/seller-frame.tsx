import Link from "next/link";
import type { ReactNode } from "react";
import { th } from "@/i18n/th";
import { cn } from "@/lib/utils";
import { SELLER_ROUTES } from "./routes";

export type SellerPage = "dashboard" | "store" | "products" | "orders";

const LINK =
  "type-label focus-ring inline-flex min-h-11 items-center rounded-sm border px-4 transition-colors duration-150";

/** Links between the seller pages. The current area is marked with aria-current. */
export function SellerNav({ current }: { current?: SellerPage }) {
  const items: { page: SellerPage; href: string; label: string }[] = [
    { page: "dashboard", href: SELLER_ROUTES.dashboard, label: th.seller.nav.dashboard },
    { page: "store", href: SELLER_ROUTES.store, label: th.seller.nav.store },
    { page: "products", href: SELLER_ROUTES.products, label: th.seller.nav.products },
    { page: "orders", href: SELLER_ROUTES.orders, label: th.seller.nav.orders },
  ];
  return (
    <nav aria-label={th.seller.navLabel}>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.page}>
            <Link
              href={item.href}
              aria-current={item.page === current ? "page" : undefined}
              className={cn(
                LINK,
                item.page === current
                  ? "border-ink bg-ink text-on-ink"
                  : "border-control-border text-foreground hover:bg-surface-muted",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Frame of a seller page: the single `h1`, an optional description and action, the seller links
 * (when `current` is given), then the content. The `main` landmark comes from the shell.
 */
export function SellerFrame({
  current,
  title,
  description,
  action,
  children,
}: {
  current?: SellerPage;
  title: string;
  description?: string;
  /** Primary action of the page, shown beside the title. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="container-page flex flex-1 flex-col gap-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="type-page-title">{title}</h1>
          {description ? (
            <p className="type-body text-foreground-secondary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {current ? <SellerNav current={current} /> : null}
      {children}
    </div>
  );
}
