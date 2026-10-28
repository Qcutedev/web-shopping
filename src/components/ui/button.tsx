import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";
import { SpinnerIcon } from "./icons";

export type ButtonVariant = "primary" | "dark" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "relative inline-flex shrink-0 items-center justify-center gap-2 border border-transparent type-label select-none " +
  "transition-colors duration-150 focus-ring";

// Tailwind emits disabled: and aria-disabled: rules after hover: and active:, so these win over
// the variant's hover and active fills. aria-disabled covers links styled as buttons.
const DISABLED =
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-foreground-disabled " +
  "aria-disabled:cursor-not-allowed aria-disabled:border-border aria-disabled:bg-surface-muted aria-disabled:text-foreground-disabled";

// A loading button keeps its variant colours and ignores the pointer.
const LOADING = "pointer-events-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active",
  dark: "bg-ink text-on-ink hover:bg-ink-hover active:bg-ink-active",
  secondary:
    "border-control-border bg-surface text-foreground hover:border-control-border-hover hover:bg-surface-muted active:bg-border",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted active:bg-border",
  danger: "bg-danger text-on-danger hover:bg-danger-hover active:bg-danger-active",
};

const SIZES: Record<ButtonSize, string> = {
  // 36px high for dense dashboard rows. The pseudo-element keeps the touch area 44px high.
  sm: "h-9 min-w-9 rounded-sm px-3 before:absolute before:-inset-x-px before:-inset-y-[5px] before:content-['']",
  md: "h-11 min-w-11 rounded-sm px-4",
  lg: "h-13 min-w-13 rounded-md px-6",
};

export interface ButtonVariantOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/**
 * Class names of a button. Use it to style a link as a button:
 * `<Link className={buttonVariants({ variant: "primary" })} href="...">`.
 */
export function buttonVariants({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
}: ButtonVariantOptions & { loading?: boolean } = {}): string {
  return cn(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    loading ? LOADING : DISABLED,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantOptions {
  /** Shows a spinner, keeps the width, and blocks activation. The button stays focusable (aria-disabled). */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Button. `type` defaults to "button" so that a button inside a form never submits by accident;
 * pass `type="submit"` explicitly.
 */
export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  disabled = false,
  type = "button",
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  // A plainly disabled button never shows the spinner.
  const showSpinner = loading && !disabled;
  return (
    <button
      {...props}
      // A loading button stays focusable (aria-disabled, not native disabled) so keyboard focus is not
      // lost when an action starts. It becomes type="button" with no click handler, so Enter and
      // Space do nothing and a submit button cannot submit. No handler is created here: Button also
      // renders in server components, which cannot pass functions to a host element.
      type={showSpinner ? "button" : type}
      disabled={disabled}
      aria-disabled={showSpinner || undefined}
      aria-busy={showSpinner || undefined}
      onClick={showSpinner ? undefined : onClick}
      className={cn(buttonVariants({ variant, size, fullWidth, loading: showSpinner }), className)}
    >
      {showSpinner ? (
        <>
          {/* The label stays in the layout (width) and in the accessible name; only its ink is hidden. */}
          <span className="inline-flex items-center gap-2 opacity-0">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <SpinnerIcon />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
