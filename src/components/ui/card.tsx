import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render. Use "section" or "article" when the card has its own heading. */
  as?: "div" | "section" | "article" | "li";
  /** "card": 16px padding. "panel": 16px, 24px from `md`. "none": the content sets its own padding. */
  padding?: "card" | "panel" | "none";
}

const PADDING: Record<NonNullable<CardProps["padding"]>, string> = {
  card: "p-4",
  panel: "p-4 md:p-6",
  none: "",
};

/** Bordered surface with a 16px radius. Cards at rest have no shadow. */
export function Card({ as: Element = "div", padding = "card", className, ...props }: CardProps) {
  return (
    <Element
      className={cn(
        "border-border bg-surface text-foreground rounded-lg border",
        PADDING[padding],
        className,
      )}
      {...props}
    />
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Heading level. Pick the level that keeps the page outline in order. */
  as: "h2" | "h3" | "h4";
  /** "card": 17/600. "panel": 20/600. */
  size?: "card" | "panel";
}

/** Heading of a card or panel. */
export function CardTitle({ as: Heading, size = "card", className, ...props }: CardTitleProps) {
  return (
    <Heading
      className={cn(size === "panel" ? "type-panel-title" : "type-card-title", className)}
      {...props}
    />
  );
}
