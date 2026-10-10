import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 type-label select-none " +
  "transition-colors duration-150";

const REST =
  "border-control-border bg-surface text-foreground hover:bg-surface-muted active:bg-border";

// The selected chip uses --ink, as in the approved mockups (not --primary and not --selected).
const SELECTED = "border-ink bg-ink text-on-ink hover:bg-ink-hover active:bg-ink-active";

const DISABLED =
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-foreground-disabled";

/**
 * Class names of a chip, for a link that acts as a filter:
 * `<Link className={chipVariants({ selected })} aria-current={selected ? "true" : undefined}>`.
 */
export function chipVariants({ selected = false }: { selected?: boolean } = {}): string {
  return cn(BASE, "focus-ring", selected ? SELECTED : REST);
}

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  /** Whether the option is on. Exposed as aria-pressed. */
  selected: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Toggle chip: a filter or option that can be on or off independently of its neighbours.
 * When exactly one option of a set may be chosen, use ChipRadio instead.
 */
export function Chip({ selected, className, type = "button", ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(chipVariants({ selected }), DISABLED, className)}
      {...props}
    />
  );
}

export interface ChipRadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label of the option. */
  label: ReactNode;
  /** Class names of the visible pill. */
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Single-choice chip: a native radio drawn as a chip. Give every chip of the set the same `name`
 * and wrap the set in a `fieldset` with a `legend` (or RadioGroup) so the group has a name.
 */
export function ChipRadio({ label, className, ...props }: ChipRadioProps) {
  return (
    <label className="relative inline-flex cursor-pointer has-disabled:cursor-not-allowed">
      {/* The radio covers the pill so it receives the pointer and the focus, but is not painted. */}
      <input
        type="radio"
        className="peer focus-ring absolute inset-0 size-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
        {...props}
      />
      <span
        className={cn(
          BASE,
          // Hover and press are read from the radio on top, split by checked state so a
          // checked chip never gets the light hover fill under its light label.
          "border-control-border bg-surface text-foreground",
          "peer-[:not(:checked):hover]:bg-surface-muted peer-[:not(:checked):active]:bg-border",
          "peer-checked:border-ink peer-checked:bg-ink peer-checked:text-on-ink",
          "peer-[:checked:hover]:bg-ink-hover",
          "peer-disabled:border-border peer-disabled:bg-surface-muted peer-disabled:text-foreground-disabled",
          className,
        )}
      >
        {label}
      </span>
    </label>
  );
}
