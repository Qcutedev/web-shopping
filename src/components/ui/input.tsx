import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";
import { controlClassName, FormField, joinIds, type FieldProps } from "./field";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the control invalid (aria-invalid and the danger border). Pair it with visible error text. */
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** Bare text input, 44px high. Use InputField unless the label is laid out separately. */
export function Input({ className, invalid, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid ? true : undefined}
      className={cn(controlClassName, "read-only:bg-surface-muted h-11", className)}
      {...props}
    />
  );
}

export type InputFieldProps = Omit<InputProps, "invalid"> & FieldProps;

/** Input with its label, helper text, and error text wired together. */
export function InputField({
  label,
  labelSuffix,
  helperText,
  errorText,
  fieldClassName,
  id,
  "aria-describedby": describedBy,
  ...props
}: InputFieldProps) {
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
        <Input
          {...props}
          {...control}
          aria-describedby={joinIds(describedBy, control["aria-describedby"])}
        />
      )}
    </FormField>
  );
}
