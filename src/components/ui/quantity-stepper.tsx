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

/**
 * Number typed into the input. `draft` holds digits only and is not empty, so the result is never
 * negative or `NaN`. A number too long for JavaScript to hold (`Number()` gives `Infinity`) is
 * capped, so that it clamps to `max` like any other number above the stock.
 */
function draftQuantity(draft: string): number {
  return Math.min(Number(draft), Number.MAX_SAFE_INTEGER);
}

interface QuantityStepperBaseProps {
  /**
   * Current quantity (controlled). The input always shows exactly this number, also when it is
   * outside 1 to `max`; see `onLowered` and `onOutOfRange`.
   */
  value: number;
  /**
   * Called with the new quantity when the customer changes it, and when the stepper lowers a
   * quantity that is above `max` (see `onLowered`). The argument is always a whole number from 1
   * to `max`. Not called when the quantity does not change.
   */
  onChange: (value: number) => void;
  /** Largest quantity allowed: the available stock. The server still validates stock. */
  max: number;
  /**
   * Called right after the stepper lowered the quantity because `value` was above `max`, for
   * example after a stock refetch (D-025, OQ-23). `onChange(lowered)` has already been called;
   * `previous` is the quantity the customer had chosen and `lowered` is the largest quantity
   * allowed. Use it to tell the customer: render the text (from th.ts) in a live region that is
   * already on the page, for example `FieldMessage` or an `Alert` with `role="status"`. The
   * stepper renders no text of its own.
   *
   * Called once for each distinct pair of `previous` and `lowered`, after render; not called again
   * on re-renders, and not called while `max` is under 1 (no quantity is allowed then).
   */
  onLowered?: (previous: number, lowered: number) => void;
  /**
   * Called when the `value` prop is outside 1 to `max` for a reason other than being above `max`:
   * below 1, a fraction, or not a number. `clamped` is the nearest allowed quantity. A `value`
   * above `max` is lowered by the stepper and reported through `onLowered` instead.
   * Called once for each distinct pair of `value` and `clamped`, after render; not called again on
   * re-renders, and not called while `max` is under 1.
   *
   * For these values the stepper does not change the quantity by itself. The parent decides:
   * adopt `clamped` (set its state to it), or keep `value` and show a message (link it with
   * `aria-describedby` and set `invalid`).
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
 * - When `value` is above `max` (stock dropped below the chosen quantity), the stepper lowers it:
 *   it calls `onChange(max)` and then `onLowered(previous, max)`, once, after render. The page
 *   uses `onLowered` to tell the customer, with text from th.ts (D-025, OQ-23).
 * - Any other `value` outside 1 to `max` (below 1, a fraction, not a number) is a mistake of the
 *   caller, not of the customer: the stepper keeps showing it and calls
 *   `onOutOfRange(value, clamped)` once. The parent decides what to do.
 * - While `value` is outside the range, the plus button and the Up arrow key do nothing at or
 *   above `max`, the minus button and the Down arrow key do nothing at or below 1 (D-025, OQ-24),
 *   and the first step in the other direction lands on the nearest allowed quantity.
 * - `max` under 1 disables the whole control. A disabled input is not part of a form submission.
 * - A disabled control discards text that was being typed and shows `value`.
 */
export function QuantityStepper({
  value,
  onChange,
  max,
  onLowered,
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
  // The chosen quantity is more than the available stock (D-025, OQ-23).
  const aboveMax = outOfRange && Number.isFinite(value) && value > upper;
  // Numbers that the buttons and arrow keys step from. They differ only for a fractional value,
  // where a step goes to the next whole number in its direction.
  const base = Number.isFinite(value) ? value : MIN_QUANTITY;
  const stepUpFrom = Math.floor(base);
  const stepDownFrom = Math.ceil(base);

  // A disabled control shows the committed value: text typed before it was disabled is discarded,
  // so it cannot come back when the control is enabled again. (A browser does not fire blur on an
  // input that becomes disabled, so the draft would otherwise survive.)
  if (isDisabled && draft !== null) setDraft(null);

  // The pair last handled by the effect below, so that each pair is handled once.
  const reported = useRef<{ value: number; clamped: number } | null>(null);
  useEffect(() => {
    if (!outOfRange) {
      reported.current = null;
      return;
    }
    const last = reported.current;
    if (last !== null && Object.is(last.value, value) && last.clamped === clamped) return;
    reported.current = { value, clamped };
    if (aboveMax) {
      // Stock is below the chosen quantity: lower it, then let the page tell the customer.
      onChange(clamped);
      onLowered?.(value, clamped);
    } else {
      onOutOfRange?.(value, clamped);
    }
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
    commit(draftQuantity(draft));
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
      // At or above the available stock the key does nothing, like the disabled plus button.
      const typed = draft ? draftQuantity(draft) : null;
      if ((typed ?? base) >= upper) return;
      commit((typed ?? stepUpFrom) + 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      // At or below 1 the key does nothing, like the disabled minus button.
      const typed = draft ? draftQuantity(draft) : null;
      if ((typed ?? base) <= MIN_QUANTITY) return;
      commit((typed ?? stepDownFrom) - 1);
    }
  }

  return (
    <div
      role={groupLabel ? "group" : undefined}
      aria-label={groupLabel || undefined}
      className={cn(
        "border-control-border bg-surface inline-flex h-11 items-stretch rounded-sm border transition-colors duration-150",
        // Hover border in ink (D-026, OQ-45). The error and disabled borders stay as they are.
        !invalid && !isDisabled && "hover:border-control-border-hover",
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
