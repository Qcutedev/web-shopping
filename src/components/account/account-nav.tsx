import Link from "next/link";
import { cn } from "@/lib/utils";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";

export type AccountPage = "profile" | "addresses";

const LINK =
  "type-label focus-ring inline-flex min-h-11 items-center rounded-sm border px-4 transition-colors duration-150";

/** Links between the pages of the account area. The current page is marked with aria-current. */
export function AccountNav({ current }: { current: AccountPage }) {
  const items: { page: AccountPage; href: string; label: string }[] = [
    { page: "profile", href: ROUTES.account, label: th.account.nav.profile },
    { page: "addresses", href: ROUTES.accountAddresses, label: th.account.nav.addresses },
  ];
  return (
    <nav aria-label={th.account.navLabel}>
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
