import type { Ref, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { controlClassName, FormField, joinIds, type FieldProps } from "./field";
import { ChevronDownIcon } from "./icons";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Marks the control invalid (aria-invalid and the danger border). Pair it with visible error text. */
  invalid?: boolean;
  /** Class names of the wrapper that positions the chevron. `className` goes to the select. */
  wrapperClassName?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** Native select, 44px high, with the design-system chevron. Pass `option` elements as children. */
export function Select({ className, wrapperClassName, invalid, children, ...props }: SelectProps) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select
        aria-invalid={invalid ? true : undefined}
        className={cn(controlClassName, "h-11 appearance-none pr-10", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="text-foreground-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" />
    </span>
  );
}

export type SelectFieldProps = Omit<SelectProps, "invalid"> & FieldProps;

/** Select with its label, helper text, and error text wired together. */
export function SelectField({
  label,
  labelSuffix,
  helperText,
  errorText,
  fieldClassName,
  id,
  "aria-describedby": describedBy,
  ...props
}: SelectFieldProps) {
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
        <Select
          {...props}
          {...control}
          aria-describedby={joinIds(describedBy, control["aria-describedby"])}
        />
      )}
    </FormField>
  );
}
