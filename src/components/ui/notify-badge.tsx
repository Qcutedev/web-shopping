import { cn } from "@/lib/utils";

const MAX_SHOWN = 99;

/**
 * Red count bubble for something new that needs attention. Hidden for 0 or a non-count. The
 * number is decoration: the parent's accessible name must carry the meaning (the bubble is
 * `aria-hidden`). A value above 99 reads "99+".
 */
export function NotifyBadge({ count, className }: { count: number; className?: string }) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return (
    <span
      aria-hidden="true"
      data-notify-badge=""
      className={cn(
        "bg-danger text-on-danger type-caption inline-flex min-w-5 items-center justify-center rounded-full px-1.5 leading-5 font-medium",
        className,
      )}
    >
      {count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}
    </span>
  );
}
