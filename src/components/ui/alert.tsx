import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from "./icons";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { container: string; accent: string }> = {
  info: { container: "border-info bg-info-soft", accent: "text-info" },
  success: { container: "border-success bg-success-soft", accent: "text-success" },
  warning: { container: "border-warning bg-warning-soft", accent: "text-warning" },
  danger: { container: "border-danger bg-danger-soft", accent: "text-danger" },
};

const ICONS: Record<AlertTone, typeof InfoIcon> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  danger: ErrorIcon,
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: AlertTone;
  /** Optional one-line heading in the tone colour. */
  title?: ReactNode;
  /** Message text. */
  children?: ReactNode;
  /** Optional action (a Button or a link) shown under the message. */
  action?: ReactNode;
}

/**
 * Inline banner. Each tone has its own icon shape, so the tone is not conveyed by colour alone.
 * `role` defaults to "alert" for danger (announced at once) and "status" for the other tones;
 * pass `role` to override, for example `role="note"` for a message that is part of the page from
 * the start.
 */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  role,
  className,
  ...props
}: AlertProps) {
  const ToneIcon = ICONS[tone];
  const styles = TONES[tone];
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      data-tone={tone}
      className={cn(
        "text-foreground flex items-start gap-3 rounded-sm border p-4",
        styles.container,
        className,
      )}
      {...props}
    >
      <ToneIcon className={cn("mt-0.5", styles.accent)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className={cn("type-label font-semibold", styles.accent)}>{title}</p> : null}
        {children ? <div className="type-body">{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
