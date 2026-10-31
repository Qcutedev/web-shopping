import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder block for content that is loading. Size it with class names so it matches the shape
 * of what it replaces (for example `aspect-square w-full rounded-lg` for a product image).
 * It breathes softly (`.skeleton-pulse`, opacity only, no sweep) and is hidden from assistive technology: put `aria-busy="true"` on the
 * region that is loading and give that region a visually hidden loading text from th.ts.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton-pulse bg-surface-muted rounded-sm", className)}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of text lines to stand in for. The last line is shorter. */
  lines?: number;
}

/** Stand-in for a block of body text. Each bar occupies one body line (15px x 1.65). */
export function SkeletonText({ lines = 2, className, ...props }: SkeletonTextProps) {
  const count = Math.max(1, Math.trunc(lines));
  return (
    <div aria-hidden="true" className={cn("flex flex-col", className)} {...props}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="type-body flex h-[1.65em] items-center">
          <div
            className={cn(
              "skeleton-pulse bg-surface-muted h-[0.8em] rounded-full",
              index === count - 1 && count > 1 ? "w-2/3" : "w-full",
            )}
          />
        </div>
      ))}
    </div>
  );
}
