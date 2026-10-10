import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Decorative icon. It is wrapped in an aria-hidden element. */
  icon?: ReactNode;
  /** One-line title, for example "ยังไม่มีสินค้าในตะกร้า" (from th.ts). */
  title: ReactNode;
  /** Heading level of the title. Pick the level that keeps the page outline in order. */
  titleAs?: "h2" | "h3" | "h4" | "p";
  /** One-line explanation that suggests the next step. */
  description?: ReactNode;
  /** One primary action: a Button, or a link styled with buttonVariants. */
  action?: ReactNode;
}

/** Shown in place of a list or table that has no rows. */
export function EmptyState({
  icon,
  title,
  titleAs: Title = "h2",
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center md:py-14", className)}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="bg-surface-muted text-foreground-muted mb-2 flex size-14 items-center justify-center rounded-full"
        >
          {icon}
        </div>
      ) : null}
      <Title className="type-card-title text-foreground">{title}</Title>
      {description ? (
        <p className="type-body text-foreground-secondary max-w-prose">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
