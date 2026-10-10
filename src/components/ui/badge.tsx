import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
export type BadgeVariant = BadgeTone | "shipped";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-foreground-secondary",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

// OQ-02: colour of the fulfilment SHIPPED status badge. The spec currently maps it to "primary";
// the owner decides. Change this one line.
const SHIPPED_TONE: BadgeTone = "primary";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Use "shipped" for the fulfilment SHIPPED status so its colour stays a single decision. */
  variant?: BadgeVariant;
}

/**
 * Pill-shaped status label. The text is the status; colour only supports it, so never render a
 * badge without its label.
 */
export function Badge({ variant = "neutral", className, ...props }: BadgeProps) {
  const tone = variant === "shipped" ? SHIPPED_TONE : variant;
  return (
    <span
      data-tone={tone}
      className={cn(
        "type-caption inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
