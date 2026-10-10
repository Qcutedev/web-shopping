import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronRightIcon } from "./icons";

export interface BreadcrumbItem {
  label: ReactNode;
  /** Link target. Ignored for the last item, which is the current page. */
  href?: string;
}

export interface BreadcrumbProps {
  /** Trail from the root to the current page, in order. The last item is the current page. */
  items: BreadcrumbItem[];
  /** Accessible name of the navigation landmark, for example "เส้นทางนำทาง" (from th.ts). */
  label: string;
  className?: string;
}

/**
 * Breadcrumb trail. Long Thai names wrap onto further lines; nothing is truncated.
 * Links are 44px high for touch.
 */
export function Breadcrumb({ items, label, className }: BreadcrumbProps) {
  if (items.length === 0) return null;
  const lastIndex = items.length - 1;

  return (
    <nav aria-label={label} className={className}>
      <ol className="type-small text-foreground-muted flex flex-wrap items-center gap-x-1">
        {items.map((item, index) => {
          const isCurrent = index === lastIndex;
          return (
            <li key={index} className="inline-flex min-w-0 items-center gap-x-1">
              {index > 0 ? <ChevronRightIcon className="size-4" /> : null}
              {isCurrent || item.href === undefined ? (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center",
                    isCurrent && "text-foreground font-medium",
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-foreground-muted focus-ring hover:text-foreground inline-flex min-h-11 items-center rounded-sm underline-offset-4 transition-colors duration-150 hover:underline"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
