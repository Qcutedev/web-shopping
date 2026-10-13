import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

export interface CartLinkProps {
  /** Number of items in the cart. The badge is hidden for 0. Display only: the server owns the cart. */
  count?: number;
  className?: string;
}

function CartIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 7H6" />
    </svg>
  );
}

/**
 * The header's cart button: a pill link with a count badge. This is the CartButton of
 * docs/DESIGN_SYSTEM.md; it lives in the shell because it reads Thai copy and routes.
 * The accessible name includes the count when there is one.
 */
export function CartLink({ count = 0, className }: CartLinkProps) {
  const hasItems = Number.isSafeInteger(count) && count > 0;
  const name = hasItems
    ? fill(th.shell.header.cart.labelWithCount, { count })
    : th.shell.header.cart.label;
  return (
    <Link
      href={ROUTES.cart}
      aria-label={name}
      className={cn(buttonVariants({ variant: "secondary" }), "rounded-full", className)}
    >
      <CartIcon />
      {hasItems ? (
        <span
          aria-hidden="true"
          className="bg-primary text-on-primary type-caption inline-flex min-w-6 items-center justify-center rounded-full px-1.5 font-medium"
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
