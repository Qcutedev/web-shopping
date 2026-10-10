import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Decorative inline icons used by the primitives. They are always hidden from assistive
 * technology; the accessible name comes from text or an aria-label on the parent control.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ className, children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 7.5l5 5 5-5" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.5 5l-5 5 5 5" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 5l5 5-5 5" />
    </Icon>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 10h10" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 5v10M5 10h10" />
    </Icon>
  );
}

/** Circle with "i": informational messages. */
export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9.25v4.25M10 6.5v.01" />
    </Icon>
  );
}

/** Circle with a check: success messages. */
export function SuccessIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M6.75 10.25l2.25 2.25 4.25-4.75" />
    </Icon>
  );
}

/** Triangle with "!": warnings. */
export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3.25l7.25 12.5H2.75L10 3.25z" />
      <path d="M10 8.25v3.5M10 13.75v.01" />
    </Icon>
  );
}

/** Circle with "!": errors. */
export function ErrorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.25v4.5M10 13.5v.01" />
    </Icon>
  );
}

export function SpinnerIcon({ className, ...props }: IconProps) {
  return (
    <Icon className={cn("animate-spin", className)} {...props}>
      <path d="M10 2.75a7.25 7.25 0 1 0 7.25 7.25" />
    </Icon>
  );
}
