import { useId, type LabelHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ErrorIcon } from "./icons";

/**
 * Class names shared by Input, Textarea, and Select.
 * Border colour comes from --control-border (see globals.css).
 */
export const controlClassName =
  "block w-full min-h-11 rounded-sm border border-control-border bg-surface px-3.5 type-body text-foreground " +
  "placeholder:text-foreground-muted transition-colors duration-150 focus-ring " +
  "hover:border-border-contrast " +
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-foreground-disabled " +
  "aria-invalid:border-danger";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Extra content after the label text, for example a "not required" note from th.ts. */
  suffix?: ReactNode;
}

/** Visible label of a form control. Always pass `htmlFor`. */
export function Label({ className, children, suffix, ...props }: LabelProps) {
  return (
    <label className={cn("type-label text-foreground block", className)} {...props}>
      {children}
      {suffix ? <span className="text-foreground-muted ml-1 font-normal">{suffix}</span> : null}
    </label>
  );
}

/** Attributes a control needs so that its label, helper text, and error text are associated. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export interface FieldMessageProps {
  /** The id that the control references through aria-describedby. */
  id: string;
  helperText?: ReactNode;
  /** When present it replaces the helper text. */
  errorText?: ReactNode;
  className?: string;
}

/**
 * Helper or error text under a control. The wrapper is a polite live region that is always
 * rendered, so an error that appears after validation is announced. The error carries an icon as
 * well as colour.
 */
export function FieldMessage({ id, helperText, errorText, className }: FieldMessageProps) {
  const hasError = hasContent(errorText);
  const hasHelper = hasContent(helperText);
  return (
    <div aria-live="polite" className={className}>
      {hasError ? (
        <p
          id={id}
          data-field-error=""
          className="type-caption text-danger flex items-start gap-1.5"
        >
          <ErrorIcon className="mt-0.5 size-4" />
          <span>{errorText}</span>
        </p>
      ) : hasHelper ? (
        <p id={id} className="type-caption text-foreground-muted">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export interface FormFieldProps {
  label: ReactNode;
  labelSuffix?: ReactNode;
  helperText?: ReactNode;
  /** Error text. When present it replaces the helper text and marks the control invalid. */
  errorText?: ReactNode;
  /** Id of the control. Generated when omitted. */
  id?: string;
  className?: string;
  /** Renders the control. Spread the argument onto the input, select, or textarea. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label above, control, helper or error text below. The error text is linked to the control with
 * aria-describedby and the control is marked aria-invalid.
 */
export function FormField({
  label,
  labelSuffix,
  helperText,
  errorText,
  id,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const messageId = `${controlId}-message`;
  const hasError = hasContent(errorText);
  const hasMessage = hasError || hasContent(helperText);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={controlId} suffix={labelSuffix}>
        {label}
      </Label>
      {children({
        id: controlId,
        "aria-describedby": hasMessage ? messageId : undefined,
        "aria-invalid": hasError ? true : undefined,
      })}
      <FieldMessage id={messageId} helperText={helperText} errorText={errorText} />
    </div>
  );
}

/** Field props shared by InputField, TextareaField, and SelectField. */
export interface FieldProps {
  label: ReactNode;
  labelSuffix?: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  /** Class names of the field wrapper. `className` goes to the control itself. */
  fieldClassName?: string;
}

/** Joins the ids for aria-describedby, dropping empty ones. */
export function joinIds(...ids: Array<string | undefined>): string | undefined {
  const present = ids.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.join(" ") : undefined;
}

/**
 * Whether helper or error text would put anything on the screen. `undefined`, `null`, booleans,
 * and the empty string render nothing in React and count as no content; the number 0 renders "0"
 * and counts as content. Every primitive that shows helper or error text uses this one check, so
 * the visible message, `aria-describedby`, and `aria-invalid` always agree.
 */
export function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean" && node !== "";
}
