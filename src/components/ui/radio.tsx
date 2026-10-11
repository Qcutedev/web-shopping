import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { FieldMessage, hasContent } from "./field";

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label. Clicking it selects the radio; the whole row is the 44px touch target. */
  label: ReactNode;
  /** Class names of the label row. `className` goes to the input. */
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Native radio button with a visible label. Group radios that share a `name` in a RadioGroup. */
export function Radio({ label, wrapperClassName, className, id, ...props }: RadioProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "type-body text-foreground has-disabled:text-foreground-disabled inline-flex min-h-11 cursor-pointer items-start gap-3 py-2.5 has-disabled:cursor-not-allowed",
        wrapperClassName,
      )}
    >
      <span className="relative mt-[2px] inline-grid size-5 shrink-0 place-items-center">
        <input
          type="radio"
          id={inputId}
          className={cn(
            "peer border-control-border bg-surface col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-full border",
            "focus-ring hover:border-control-border-hover transition-colors duration-150",
            "checked:border-primary checked:hover:border-primary-hover",
            "disabled:border-border disabled:bg-surface-muted disabled:cursor-not-allowed",
            "forced-colors:appearance-auto",
            className,
          )}
          {...props}
        />
        <span
          aria-hidden="true"
          className="bg-primary peer-disabled:bg-foreground-disabled pointer-events-none col-start-1 row-start-1 size-2.5 rounded-full opacity-0 peer-checked:opacity-100 forced-colors:hidden"
        />
      </span>
      <span>{label}</span>
    </label>
  );
}

export interface RadioGroupProps {
  /** Visible group label, rendered as the fieldset legend. */
  legend: ReactNode;
  helperText?: ReactNode;
  /** Error text. Replaces the helper text and marks the group invalid. */
  errorText?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Radio elements that share one `name`. */
  children: ReactNode;
}

/**
 * Fieldset for a set of radios. Arrow keys move between radios of the same `name` (native
 * behaviour). The helper or error text is linked to the group with aria-describedby.
 */
export function RadioGroup({
  legend,
  helperText,
  errorText,
  disabled,
  className,
  children,
}: RadioGroupProps) {
  const messageId = `${useId()}-message`;
  const hasError = hasContent(errorText);
  const hasMessage = hasError || hasContent(helperText);

  return (
    <fieldset
      role="radiogroup"
      disabled={disabled}
      aria-describedby={hasMessage ? messageId : undefined}
      aria-invalid={hasError ? true : undefined}
      className={cn("flex min-w-0 flex-col", className)}
    >
      <legend className="type-label text-foreground mb-1">{legend}</legend>
      <div className="flex flex-col">{children}</div>
      <FieldMessage id={messageId} helperText={helperText} errorText={errorText} />
    </fieldset>
  );
}
