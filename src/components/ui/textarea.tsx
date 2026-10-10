import type { Ref, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { controlClassName, FormField, joinIds, type FieldProps } from "./field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Marks the control invalid (aria-invalid and the danger border). Pair it with visible error text. */
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Bare multi-line input. Grows vertically only; never narrower than its container. */
export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid ? true : undefined}
      className={cn(controlClassName, "read-only:bg-surface-muted resize-y py-2.5", className)}
      {...props}
    />
  );
}

export type TextareaFieldProps = Omit<TextareaProps, "invalid"> & FieldProps;

/** Textarea with its label, helper text, and error text wired together. */
export function TextareaField({
  label,
  labelSuffix,
  helperText,
  errorText,
  fieldClassName,
  id,
  "aria-describedby": describedBy,
  ...props
}: TextareaFieldProps) {
  return (
    <FormField
      id={id}
      label={label}
      labelSuffix={labelSuffix}
      helperText={helperText}
      errorText={errorText}
      className={fieldClassName}
    >
      {(control) => (
        <Textarea
          {...props}
          {...control}
          aria-describedby={joinIds(describedBy, control["aria-describedby"])}
        />
      )}
    </FormField>
  );
}
