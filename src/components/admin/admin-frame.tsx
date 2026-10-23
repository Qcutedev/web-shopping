import Link from "next/link";
import type { ReactNode } from "react";
import { th } from "@/i18n/th";
import { cn } from "@/lib/utils";
import { AdminNoticeRegion } from "./action-button";
import { ADMIN_ROUTES } from "./routes";

export type AdminPage =
  | "dashboard"
  | "users"
  | "applications"
  | "stores"
  | "products"
  | "categories"
  | "orders"
  | "reports"
  | "settings"
  | "auditLogs";

const LINK =
  "type-label focus-ring inline-flex min-h-11 items-center rounded-sm border px-4 transition-colors duration-150";

const ITEMS: readonly AdminPage[] = [
  "dashboard",
  "users",
  "applications",
  "stores",
  "products",
  "categories",
  "orders",
  "reports",
  "settings",
  "auditLogs",
];

/** Links between the admin pages. The current area is marked with aria-current. */
export function AdminNav({ current }: { current?: AdminPage }) {
  return (
    <nav aria-label={th.admin.navLabel}>
      <ul className="flex flex-wrap gap-2">
        {ITEMS.map((page) => (
          <li key={page}>
            <Link
              href={ADMIN_ROUTES[page]}
              aria-current={page === current ? "page" : undefined}
              className={cn(
                LINK,
                page === current
                  ? "border-ink bg-ink text-on-ink"
                  : "border-control-border text-foreground hover:bg-surface-muted",
              )}
            >
              {th.admin.nav[page]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Frame of an admin page: the single `h1`, an optional description and action, the admin links,
 * then the content. The `main` landmark comes from the shell.
 */
export function AdminFrame({
  current,
  title,
  description,
  action,
  children,
}: {
  current?: AdminPage;
  title: string;
  description?: string;
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
      <AdminNav current={current} />
      <AdminNoticeRegion />
      {children}
    </div>
  );
}
