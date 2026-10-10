import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { clampQuantity, QuantityStepper } from "./quantity-stepper";

const labels = {
  decreaseLabel: "ลดจำนวน",
  increaseLabel: "เพิ่มจำนวน",
  inputLabel: "จำนวน",
};

function Harness({
  initial,
  max,
  onChange,
}: {
  initial: number;
  max: number;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QuantityStepper
      {...labels}
      value={value}
      max={max}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

const input = () => screen.getByRole<HTMLInputElement>("textbox", { name: "จำนวน" });
const minus = () => screen.getByRole<HTMLButtonElement>("button", { name: "ลดจำนวน" });
const plus = () => screen.getByRole<HTMLButtonElement>("button", { name: "เพิ่มจำนวน" });

describe("clampQuantity", () => {
  it("clamps to 1 and max", () => {
    expect(clampQuantity(0, 5)).toBe(1);
    expect(clampQuantity(-3, 5)).toBe(1);
    expect(clampQuantity(3, 5)).toBe(3);
    expect(clampQuantity(6, 5)).toBe(5);
    expect(clampQuantity(999, 5)).toBe(5);
  });

  it("truncates fractions and treats non-numbers as 1", () => {
    expect(clampQuantity(2.9, 5)).toBe(2);
    expect(clampQuantity(Number.NaN, 5)).toBe(1);
    expect(clampQuantity(3, Number.NaN)).toBe(1);
    expect(clampQuantity(3, 0)).toBe(1);
  });
});

describe("QuantityStepper", () => {
  it("gives both buttons and the input Thai accessible names", () => {
    render(<Harness initial={2} max={5} />);
    expect(minus()).toBeTruthy();
    expect(plus()).toBeTruthy();
    expect(input().value).toBe("2");
  });

  it("does not go below 1", async () => {
    const onChange = vi.fn();
    render(<Harness initial={2} max={5} onChange={onChange} />);
    await userEvent.click(minus());
    expect(input().value).toBe("1");
    expect(minus().disabled).toBe(true);
    await userEvent.click(minus());
    expect(input().value).toBe("1");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("does not go above max", async () => {
    const onChange = vi.fn();
    render(<Harness initial={4} max={5} onChange={onChange} />);
    await userEvent.click(plus());
    expect(input().value).toBe("5");
    expect(plus().disabled).toBe(true);
    await userEvent.click(plus());
    expect(input().value).toBe("5");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("clamps a typed value above max when the input loses focus", async () => {
    const onChange = vi.fn();
    render(<Harness initial={2} max={5} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "99");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(input().value).toBe("5");
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("clamps a typed 0 to 1, on Enter", async () => {
    const onChange = vi.fn();
    render(<Harness initial={3} max={5} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "0{Enter}");
    expect(input().value).toBe("1");
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ignores non-digits and restores the value when the input is left empty", async () => {
    const onChange = vi.fn();
    render(<Harness initial={3} max={5} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "-a.");
    expect(input().value).toBe("");
    await userEvent.tab();
    expect(input().value).toBe("3");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps a value prop that is already out of range", () => {
    render(<QuantityStepper {...labels} value={9} max={4} onChange={() => {}} />);
    expect(input().value).toBe("4");
    expect(plus().disabled).toBe(true);
  });

  it("disables every control when max is below 1", () => {
    render(<QuantityStepper {...labels} value={1} max={0} onChange={() => {}} />);
    expect(input().disabled).toBe(true);
    expect(minus().disabled).toBe(true);
    expect(plus().disabled).toBe(true);
  });
});
