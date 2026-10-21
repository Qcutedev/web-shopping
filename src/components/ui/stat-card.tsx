import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ErrorIcon } from "./icons";
import { Skeleton } from "./skeleton";

export interface StatCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** What is measured, for example "สินค้าที่เผยแพร่" (from th.ts). */
  label: ReactNode;
  /**
   * The figure, already formatted by the caller: `count.toLocaleString("th-TH")` for a count, or
   * `<Price satang={...} />` for money. Never a value that the client computed.
   */
  value: ReactNode;
  /** Period or scope, for example "เฉพาะคำสั่งซื้อที่ชำระแล้ว". Not a trend: there is no arrow. */
  note?: ReactNode;
  /** Makes the whole card a link to the list that the figure counts. */
  href?: string;
  /** Element to render. Use "li" inside a `ul`. */
  as?: "div" | "li";
  /** Shows a skeleton in place of the figure and sets `aria-busy`. */
  loading?: boolean;
  /** Visually hidden text of the loading state (from th.ts). Required with `loading`. */
  loadingLabel?: string;
  /** The figure could not be loaded. Shown with an icon in place of the value. */
  errorText?: ReactNode;
}

const CARD =
  "border-border bg-surface text-foreground flex h-full flex-col gap-1 rounded-lg border p-4";

/**
 * Dashboard metric: label, value, optional note. One card is one figure; a group of cards belongs
 * in a `ul` (pass `as="li"`). With `href` the whole card is one link whose name reads the label
 * and then the value.
 */
export function StatCard({
  label,
  value,
  note,
  href,
  as: Element = "div",
  loading = false,
  loadingLabel,
  errorText,
  className,
  ...props
}: StatCardProps) {
  const hasError = errorText !== undefined && errorText !== null && errorText !== "";
  const body = (
    <>
      <span className="type-small text-foreground-secondary">{label}</span>{" "}
      {loading ? (
        <>
          <Skeleton className="my-1.5 h-6 w-24" />
          {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        </>
      ) : hasError ? (
        <span className="type-small text-danger flex items-start gap-1.5">
          <ErrorIcon className="mt-0.5 size-4" />
          <span>{errorText}</span>
        </span>
      ) : (
        <span className="type-section-title tabular-nums">{value}</span>
      )}
      {note ? <span className="type-caption text-foreground-muted">{note}</span> : null}
    </>
  );

  // A link needs a value to point at; a card that is loading or failed is plain.
  if (href && !loading && !hasError) {
    return (
      <Element className={className} {...props}>
        <Link
          href={href}
          className={cn(CARD, "hover:bg-surface-muted focus-ring transition-colors duration-150")}
        >
          {body}
        </Link>
      </Element>
    );
  }

  return (
    <Element aria-busy={loading || undefined} className={cn(CARD, className)} {...props}>
      {body}
    </Element>
  );
}
