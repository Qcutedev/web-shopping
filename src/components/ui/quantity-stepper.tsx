"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
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

interface QuantityStepperBaseProps {
  /**
   * Current quantity (controlled). The input always shows exactly this number, also when it is
   * outside 1 to `max`; see `onOutOfRange`.
   */
  value: number;
  /**
   * Called with the new quantity when the customer changes it. The argument is always a whole
   * number from 1 to `max`. Not called when the quantity does not change.
   */
  onChange: (value: number) => void;
  /** Largest quantity allowed: the available stock. The server still validates stock. */
  max: number;
  /**
   * Called when the `value` prop is not a whole number from 1 to `max`, for example after a stock
   * refetch lowered `max` below the chosen quantity. `clamped` is the nearest allowed quantity.
   * Called once for each distinct pair of `value` and `clamped`, after render; not called again on
   * re-renders, and not called while `max` is under 1 (no quantity is allowed then).
   *
   * The stepper does not change the quantity by itself. The parent decides: adopt `clamped`
   * (set its state to it), or keep `value` and show a message (link it with `aria-describedby`
   * and set `invalid`).
   */
  onOutOfRange?: (value: number, clamped: number) => void;
  /** Accessible name of the minus button, for example "ลดจำนวน" (from th.ts). */
  decreaseLabel: string;
  /** Accessible name of the plus button, for example "เพิ่มจำนวน" (from th.ts). */
  increaseLabel: string;
  /**
   * Accessible name of the whole stepper, for what the quantity belongs to: in a list of cart
   * lines, the product title. When given, the wrapper is a named group. When omitted (a single
   * stepper next to its own label) the wrapper has no role and no name.
   */
  groupLabel?: string;
  /** Marks the number input invalid (`aria-invalid`) and gives the stepper the error border. */
  invalid?: boolean;
  disabled?: boolean;
  /** Form field name of the number input. */
  name?: string;
  /** Id of text that describes the stepper, for example the stock note or an error message. */
  "aria-describedby"?: string;
  className?: string;
}

/**
 * The number input needs exactly one accessible name. Either pass `inputLabel`, or pass `id` and
 * render a visible `<label htmlFor={id}>`. With both, `inputLabel` wins (aria-label overrides the
 * label element), so leave `inputLabel` out when there is a visible label.
 */
export type QuantityStepperProps = QuantityStepperBaseProps &
  (
    | {
        /** Accessible name of the number input, for example "จำนวน" (from th.ts). */
        inputLabel: string;
        /** Id of the number input. */
        id?: string;
      }
    | {
        inputLabel?: undefined;
        /** Id of the number input, referenced by a visible `<label htmlFor>`. */
        id: string;
      }
  );

const STEP_BUTTON =
  // 44px wide. The group border leaves 42px of height, so the pseudo-element restores a 44px touch area.
  "relative inline-flex w-11 shrink-0 items-center justify-center text-foreground transition-colors duration-150 focus-ring focus-visible:z-10 " +
  "before:absolute before:inset-x-0 before:-inset-y-px before:content-['']" +
  " " +
  "hover:bg-surface-muted active:bg-border " +
  "disabled:cursor-not-allowed disabled:bg-surface disabled:text-foreground-disabled";

/**
 * Minus button, numeric input, plus button.
 *
 * Contract (controlled component):
 * - The input shows the `value` prop exactly, and with `name` set a native form submits that
 *   same number. The stepper never shows a number that differs from the parent's state. (A
 *   `value` that is not a finite number shows as an empty input.)
 * - Every change made by the customer (buttons, arrow keys, typing) reaches the parent through
 *   `onChange` as a whole number from 1 to `max`. Typing is free while the input has focus and is
 *   clamped when it loses focus or Enter is pressed; Enter does not submit a surrounding form.
 * - When the `value` prop itself is outside 1 to `max`, the stepper keeps showing it and calls
 *   `onOutOfRange(value, clamped)` once. The parent owns the decision: lower the quantity to
 *   `clamped`, or keep it and show a message. Until the parent acts, the plus button is disabled
 *   above `max`, the minus button is disabled below 1, and the first step in the other direction
 *   lands on the nearest allowed quantity.
 * - `max` under 1 disables the whole control. A disabled input is not part of a form submission.
 */
export function QuantityStepper({
  value,
  onChange,
  max,
  onOutOfRange,
  decreaseLabel,
  increaseLabel,
  inputLabel,
  groupLabel,
  invalid = false,
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
  const clamped = clampQuantity(value, max);
  const upper = clampQuantity(max, max);
  const outOfRange = !unavailable && value !== clamped;
  // Numbers that the buttons and arrow keys step from. They differ only for a fractional value,
  // where a step goes to the next whole number in its direction.
  const base = Number.isFinite(value) ? value : MIN_QUANTITY;
  const stepUpFrom = Math.floor(base);
  const stepDownFrom = Math.ceil(base);

  // The pair last reported through onOutOfRange, so that each pair is reported once.
  const reported = useRef<{ value: number; clamped: number } | null>(null);
  useEffect(() => {
    if (!outOfRange) {
      reported.current = null;
      return;
    }
    const last = reported.current;
    if (last !== null && Object.is(last.value, value) && last.clamped === clamped) return;
    reported.current = { value, clamped };
    onOutOfRange?.(value, clamped);
  });

  function commit(next: number) {
    const allowed = clampQuantity(next, max);
    setDraft(null);
    if (allowed !== value) onChange(allowed);
  }

  function commitDraft() {
    if (draft === null) return;
    if (draft === "") {
      // Left empty: show the parent's value again.
      setDraft(null);
      return;
    }
    commit(Number(draft));
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
      commit((draft ? Number(draft) : stepUpFrom) + 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      commit((draft ? Number(draft) : stepDownFrom) - 1);
    }
  }

  return (
    <div
      role={groupLabel ? "group" : undefined}
      aria-label={groupLabel || undefined}
      className={cn(
        "border-control-border bg-surface inline-flex h-11 items-stretch rounded-sm border",
        invalid && "border-danger",
        isDisabled && "border-border",
        className,
      )}
    >
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={isDisabled || base <= MIN_QUANTITY}
        onClick={() => commit(stepDownFrom - 1)}
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
        aria-invalid={invalid ? true : undefined}
        disabled={isDisabled}
        value={draft ?? (Number.isFinite(value) ? String(value) : "")}
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
        disabled={isDisabled || base >= upper}
        onClick={() => commit(stepUpFrom + 1)}
        className={cn(STEP_BUTTON, "rounded-r-[9px]")}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
