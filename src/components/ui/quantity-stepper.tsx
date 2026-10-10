"use client";

import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { MinusIcon, PlusIcon } from "./icons";

/** Smallest quantity a stepper allows. */
export const MIN_QUANTITY = 1;

/**
 * Clamps a quantity to the range 1 to `max`. Fractions are truncated; anything that is not a
 * finite number becomes 1. When `max` is under 1 the result is 1 (the stepper is then disabled).
 */
export function clampQuantity(value: number, max: number): number {
  if (!Number.isFinite(value)) return MIN_QUANTITY;
  const upper = Number.isFinite(max) ? Math.max(MIN_QUANTITY, Math.trunc(max)) : MIN_QUANTITY;
  return Math.min(upper, Math.max(MIN_QUANTITY, Math.trunc(value)));
}

export interface QuantityStepperProps {
  /** Current quantity (controlled). */
  value: number;
  /** Called with the new, already clamped quantity. Not called when the quantity does not change. */
  onChange: (value: number) => void;
  /** Largest quantity allowed: the available stock. The server still validates stock. */
  max: number;
  /** Accessible name of the minus button, for example "ลดจำนวน" (from th.ts). */
  decreaseLabel: string;
  /** Accessible name of the plus button, for example "เพิ่มจำนวน" (from th.ts). */
  increaseLabel: string;
  /** Accessible name of the number input, for example "จำนวน" (from th.ts). */
  inputLabel: string;
  disabled?: boolean;
  /** Id of the number input, for an external visible label. */
  id?: string;
  /** Form field name of the number input. */
  name?: string;
  /** Id of text that describes the stepper, for example the stock note. */
  "aria-describedby"?: string;
  className?: string;
}

const STEP_BUTTON =
  // 44px wide. The group border leaves 42px of height, so the pseudo-element restores a 44px touch area.
  "relative inline-flex w-11 shrink-0 items-center justify-center text-foreground transition-colors duration-150 focus-ring focus-visible:z-10 " +
  "before:absolute before:inset-x-0 before:-inset-y-px before:content-['']" +
  " " +
  "hover:bg-surface-muted active:bg-border " +
  "disabled:cursor-not-allowed disabled:bg-surface disabled:text-foreground-disabled";

/**
 * Minus button, numeric input, plus button. The quantity is clamped to 1 and `max`. Typing is
 * free while the input has focus and is clamped when it loses focus or Enter is pressed.
 * Arrow up and arrow down in the input step by one.
 */
export function QuantityStepper({
  value,
  onChange,
  max,
  decreaseLabel,
  increaseLabel,
  inputLabel,
  disabled = false,
  id,
  name,
  "aria-describedby": describedBy,
  className,
}: QuantityStepperProps) {
  // Text being typed. Null when the input shows the committed value.
  const [draft, setDraft] = useState<string | null>(null);

  const unavailable = !Number.isFinite(max) || max < MIN_QUANTITY;
  const isDisabled = disabled || unavailable;
  const current = clampQuantity(value, max);
  const upper = clampQuantity(max, max);

  function commit(next: number) {
    const clamped = clampQuantity(next, max);
    setDraft(null);
    if (clamped !== value) onChange(clamped);
  }

  function commitDraft() {
    if (draft === null) return;
    commit(draft === "" ? current : Number(draft));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    // Digits only. The value is clamped on blur so a number can be retyped freely.
    setDraft(event.target.value.replace(/\D/g, ""));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Commit the typed value instead of submitting a surrounding form with a stale quantity.
      event.preventDefault();
      commitDraft();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      commit((draft ? Number(draft) : current) + 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      commit((draft ? Number(draft) : current) - 1);
    }
  }

  return (
    <div
      role="group"
      aria-label={inputLabel}
      className={cn(
        "border-control-border bg-surface inline-flex h-11 items-stretch rounded-sm border",
        isDisabled && "border-border",
        className,
      )}
    >
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={isDisabled || current <= MIN_QUANTITY}
        onClick={() => commit(current - 1)}
        className={cn(STEP_BUTTON, "rounded-l-[9px]")}
      >
        <MinusIcon />
      </button>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={inputLabel}
        aria-describedby={describedBy}
        disabled={isDisabled}
        value={draft ?? String(current)}
        onChange={handleChange}
        onBlur={commitDraft}
        onKeyDown={handleKeyDown}
        className={cn(
          "border-control-border bg-surface type-body text-foreground focus-ring relative w-12 min-w-0 border-x text-center tabular-nums focus-visible:z-10",
          "disabled:border-border disabled:text-foreground-disabled disabled:cursor-not-allowed",
        )}
      />
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={isDisabled || current >= upper}
        onClick={() => commit(current + 1)}
        className={cn(STEP_BUTTON, "rounded-r-[9px]")}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
