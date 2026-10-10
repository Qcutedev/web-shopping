import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

export type PaginationItem =
  | { type: "page"; page: number; hideOnMobile: boolean }
  | { type: "ellipsis"; key: string; mobileOnly: boolean };

/** First page, last page, and the current page with `siblings` neighbours; a gap of one page is filled. */
function windowPages(page: number, totalPages: number, siblings: number): number[] {
  const pages = new Set<number>([1, totalPages]);
  for (let candidate = page - siblings; candidate <= page + siblings; candidate += 1) {
    if (candidate >= 1 && candidate <= totalPages) pages.add(candidate);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const filled: number[] = [];
  sorted.forEach((value, index) => {
    filled.push(value);
    const next = sorted[index + 1];
    // An ellipsis that would hide exactly one page is replaced by that page.
    if (next !== undefined && next - value === 2) filled.push(value + 1);
  });
  return filled;
}

/**
 * Page count that may be shown, or 0 when `totalPages` is not one. Only a whole number from 1 up
 * to `Number.MAX_SAFE_INTEGER` is a page count. Anything else (`NaN`, `Infinity`, a fraction, 0,
 * a negative number) gives 0: the count is not guessed, and pagination renders nothing.
 */
export function normaliseTotalPages(totalPages: number): number {
  return Number.isSafeInteger(totalPages) && totalPages >= 1 ? totalPages : 0;
}

/**
 * Current page that may be shown, always a whole number from 1 to `total` (a valid page count).
 * A page that is not a finite number (`NaN`, `Infinity`, `-Infinity`) becomes 1. A fraction is
 * truncated. A page under 1 becomes 1 and a page above `total` becomes `total`.
 */
export function normalisePage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(total, Math.max(1, Math.trunc(page)));
}

/**
 * Items of the page list. From `sm` up: first, last, and the current page with one neighbour on
 * each side. Below `sm`: first, last, and the current page only, so the row fits a 360px screen.
 * Both layouts come from one list; items carry the flag that hides or shows them below `sm`.
 * Inputs go through `normaliseTotalPages` and `normalisePage`; an invalid page count gives no items.
 */
export function buildPaginationItems(page: number, totalPages: number): PaginationItem[] {
  const total = normaliseTotalPages(totalPages);
  if (total === 0) return [];
  const current = normalisePage(page, total);
  const wide = windowPages(current, total, 1);
  const narrow = new Set(windowPages(current, total, 0));

  const items: PaginationItem[] = [];
  wide.forEach((value, index) => {
    items.push({ type: "page", page: value, hideOnMobile: !narrow.has(value) });
    const next = wide[index + 1];
    if (next === undefined) return;
    if (next - value > 1) {
      items.push({ type: "ellipsis", key: `gap-${value}`, mobileOnly: false });
      return;
    }
    if (!narrow.has(value) || narrow.has(next)) return;
    // Pages after this one are hidden below `sm`. Add a mobile-only ellipsis unless the run of
    // hidden pages already contains a shared one.
    let cursor = index + 1;
    let hasSharedGap = false;
    while (cursor < wide.length && !narrow.has(wide[cursor]!)) {
      const following = wide[cursor + 1];
      if (following !== undefined && following - wide[cursor]! > 1) hasSharedGap = true;
      cursor += 1;
    }
    if (!hasSharedGap) items.push({ type: "ellipsis", key: `gap-${value}`, mobileOnly: true });
  });
  return items;
}

export interface PaginationProps {
  /** Current page, starting at 1. Normalised with `normalisePage`. */
  page: number;
  /** Number of pages: a whole number of at least 1. Any other value renders nothing. */
  totalPages: number;
  /** Builds the link target of a page. Keep the other search parameters in it. */
  hrefForPage: (page: number) => string;
  /** Accessible name of the navigation landmark, for example "การแบ่งหน้า" (from th.ts). */
  label: string;
  /** Accessible name of the previous link, for example "หน้าก่อนหน้า" (from th.ts). */
  previousLabel: string;
  /** Accessible name of the next link, for example "หน้าถัดไป" (from th.ts). */
  nextLabel: string;
  /** Accessible name of a page link, for example (page) => `หน้า ${page}` (from th.ts). */
  pageLabel: (page: number) => string;
  className?: string;
}

const ITEM =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-sm px-2 type-label tabular-nums " +
  "transition-colors duration-150 focus-ring";
const ITEM_REST = "text-foreground hover:bg-surface-muted active:bg-border";
// The current page uses --selected: dark ink (D-025). It is also marked with aria-current
// and a heavier weight, so it does not depend on colour.
const ITEM_CURRENT = "bg-selected font-bold text-on-selected";
const ITEM_DISABLED = "cursor-not-allowed text-foreground-disabled";

/**
 * Previous, page numbers, next, as links (so pagination works without JavaScript and each page
 * has a URL). Renders nothing when there is only one page, and nothing when `totalPages` is not a
 * whole number of at least 1 (see `normaliseTotalPages`). The current page is normalised with
 * `normalisePage`, so no link text, label, or href is ever built from `NaN`, `Infinity`, or a
 * fraction.
 */
export function Pagination({
  page,
  totalPages,
  hrefForPage,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  className,
}: PaginationProps) {
  const total = normaliseTotalPages(totalPages);
  if (total <= 1) return null;
  const current = normalisePage(page, total);
  const items = buildPaginationItems(current, total);

  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-0.5 sm:gap-1">
        <li>
          {current > 1 ? (
            <Link
              href={hrefForPage(current - 1)}
              rel="prev"
              aria-label={previousLabel}
              className={cn(ITEM, ITEM_REST)}
            >
              <ChevronLeftIcon />
            </Link>
          ) : (
            <span
              role="link"
              aria-disabled="true"
              aria-label={previousLabel}
              className={cn(ITEM, ITEM_DISABLED)}
            >
              <ChevronLeftIcon />
            </span>
          )}
        </li>
        {items.map((item) =>
          item.type === "ellipsis" ? (
            <li
              key={item.key}
              aria-hidden="true"
              className={cn(
                "type-label text-foreground-muted inline-flex h-11 min-w-6 items-center justify-center",
                item.mobileOnly && "sm:hidden",
              )}
            >
              …
            </li>
          ) : (
            <li key={item.page} className={cn(item.hideOnMobile && "max-sm:hidden")}>
              <Link
                href={hrefForPage(item.page)}
                aria-label={pageLabel(item.page)}
                aria-current={item.page === current ? "page" : undefined}
                className={cn(ITEM, item.page === current ? ITEM_CURRENT : ITEM_REST)}
              >
                {item.page}
              </Link>
            </li>
          ),
        )}
        <li>
          {current < total ? (
            <Link
              href={hrefForPage(current + 1)}
              rel="next"
              aria-label={nextLabel}
              className={cn(ITEM, ITEM_REST)}
            >
              <ChevronRightIcon />
            </Link>
          ) : (
            <span
              role="link"
              aria-disabled="true"
              aria-label={nextLabel}
              className={cn(ITEM, ITEM_DISABLED)}
            >
              <ChevronRightIcon />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
