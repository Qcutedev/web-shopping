import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Small persistent pill that marks sample data, mock payment, or simulated shipping.
 * Mandatory wherever such data is shown. The children are the Thai text from th.ts
 * ("ข้อมูลตัวอย่าง", "การชำระเงินจำลอง", "การจัดส่งจำลอง"); the text is the signal, the colour
 * only supports it.
 */
export function NoticeLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "bg-warning-soft type-caption text-warning inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 font-medium",
        className,
      )}
      {...props}
    />
  );
}
