import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { formatSatang } from "./format-price";

export type PriceSize = "inline" | "card" | "page";

const SIZES: Record<PriceSize, string> = {
  // Inherits size and weight from the surrounding text (cart lines, order summaries, tables).
  inline: "tabular-nums",
  card: "type-price-card",
  page: "type-price-page",
};

export interface PriceProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Amount in integer satang, as stored in the database. Never pass baht or a fraction. */
  satang: number;
  size?: PriceSize;
}

/**
 * A THB amount with tabular numerals. Prices use the text colour, never the accent.
 * Throws a RangeError when `satang` is not an integer (see formatSatang).
 */
export function Price({ satang, size = "inline", className, ...props }: PriceProps) {
  return (
    <span className={cn("text-foreground whitespace-nowrap", SIZES[size], className)} {...props}>
      {formatSatang(satang)}
    </span>
  );
}
