import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { FieldMessage, hasContent, joinIds } from "./field";
import { CheckIcon } from "./icons";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label. Clicking it toggles the checkbox; the whole row is the 44px touch target. */
  label: ReactNode;
  helperText?: ReactNode;
  /** Error text. Replaces the helper text and marks the checkbox invalid. */
  errorText?: ReactNode;
  /** Class names of the wrapper. `className` goes to the input. */
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Native checkbox with a visible label. */
export function Checkbox({
  label,
  helperText,
  errorText,
  wrapperClassName,
  className,
  id,
  "aria-describedby": describedBy,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const hasError = hasContent(errorText);
  const hasMessage = hasError || hasContent(helperText);

  return (
    <div className={cn("flex flex-col", wrapperClassName)}>
      <label
        htmlFor={inputId}
        className="type-body text-foreground has-disabled:text-foreground-disabled inline-flex min-h-11 cursor-pointer items-start gap-3 py-2.5 has-disabled:cursor-not-allowed"
      >
        {/* The box is centred on the first text line (15px x 1.65), so wrapped labels stay aligned. */}
        <span className="relative mt-[2px] inline-grid size-5 shrink-0 place-items-center">
          <input
            type="checkbox"
            id={inputId}
            aria-describedby={joinIds(describedBy, hasMessage ? messageId : undefined)}
            aria-invalid={hasError ? true : undefined}
            className={cn(
              "peer border-control-border bg-surface col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-[6px] border",
              "focus-ring hover:border-control-border-hover transition-colors duration-150",
              "checked:border-primary checked:bg-primary checked:hover:border-primary-hover checked:hover:bg-primary-hover",
              "disabled:border-border disabled:bg-surface-muted disabled:checked:border-foreground-disabled disabled:checked:bg-foreground-disabled disabled:cursor-not-allowed",
              "aria-invalid:border-danger",
              "forced-colors:appearance-auto",
              className,
            )}
            {...props}
          />
          <CheckIcon
            strokeWidth={2.5}
            className="text-on-primary pointer-events-none col-start-1 row-start-1 size-3.5 opacity-0 peer-checked:opacity-100 forced-colors:hidden"
          />
        </span>
        <span>{label}</span>
      </label>
      <FieldMessage id={messageId} helperText={helperText} errorText={errorText} className="pl-8" />
    </div>
  );
}
