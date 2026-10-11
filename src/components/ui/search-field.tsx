import { useId, type FormHTMLAttributes, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export interface SearchFieldProps extends Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "role" | "children" | "defaultValue"
> {
  /** Name of the query parameter the form submits, as defined by the search page. */
  name: string;
  /** Accessible label of the input, for example "ค้นหาสินค้า" (from th.ts). Visually hidden. */
  label: string;
  /** Text of the submit button: "ค้นหา" (from th.ts, key header.search.submit). */
  submitLabel: string;
  placeholder?: string;
  /** Initial query, for example the current search term on the results page. */
  defaultValue?: string;
  /** Extra attributes for the input (maxLength, autoComplete, value and onChange, ...). */
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "name" | "type" | "id" | "placeholder" | "defaultValue"
  >;
}

/**
 * Pill-shaped search form with the dark submit button inside its right end. Works without
 * JavaScript as a GET form: pass `action` (the search page path); `method` defaults to "get".
 * The field is 52px high so that the 44px button fits inside it.
 */
export function SearchField({
  name,
  label,
  submitLabel,
  placeholder,
  defaultValue,
  inputProps,
  className,
  method = "get",
  ...props
}: SearchFieldProps) {
  const inputId = useId();
  return (
    <form
      role="search"
      method={method}
      className={cn(
        "border-control-border bg-surface flex h-13 w-full items-center gap-1 rounded-full border pr-[3px] pl-5",
        "focus-ring-within hover:border-control-border-hover transition-colors duration-150",
        className,
      )}
      {...props}
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        type="search"
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className={cn(
          "type-body text-foreground placeholder:text-foreground-muted h-full min-w-0 flex-1 appearance-none bg-transparent outline-none",
          inputProps?.className,
        )}
      />
      <button
        type="submit"
        className={cn(buttonVariants({ variant: "dark", size: "md" }), "rounded-full px-5")}
      >
        {submitLabel}
      </button>
    </form>
  );
}
