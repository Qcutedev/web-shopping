import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type FormEvent } from "react";
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

/**
 * A parent that owns the quantity, as a page does. It stores what `onChange` gives it, and shows
 * the text for a lowered quantity (`onLowered`) in a live region that is always on the page. For a
 * value that is out of range for another reason (`onOutOfRange`) it applies one of the two possible
 * answers: "adopt" sets its state to the clamped quantity, "keep" leaves its state alone and shows
 * a message. Its state is printed so tests can compare it with what the stepper shows and submits.
 */
function ParentHarness({
  initial,
  max,
  policy,
  disabled,
  onChange,
  onLowered,
  onOutOfRange,
}: {
  initial: number;
  max: number;
  policy: "adopt" | "keep";
  disabled?: boolean;
  onChange?: (value: number) => void;
  onLowered?: (previous: number, lowered: number) => void;
  onOutOfRange?: (value: number, clamped: number) => void;
}) {
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <form>
      <QuantityStepper
        {...labels}
        name="quantity"
        value={value}
        max={max}
        disabled={disabled}
        invalid={message !== null}
        aria-describedby={message !== null ? "quantity-message" : undefined}
        onChange={(next) => {
          onChange?.(next);
          setMessage(null);
          setValue(next);
        }}
        onLowered={(previous, lowered) => {
          onLowered?.(previous, lowered);
          setNotice(`ลดจาก ${previous} เหลือ ${lowered}`);
        }}
        onOutOfRange={(given, clamped) => {
          onOutOfRange?.(given, clamped);
          if (policy === "adopt") setValue(clamped);
          else setMessage(`เกิน ${clamped}`);
        }}
      />
      {message !== null ? <p id="quantity-message">{message}</p> : null}
      <p role="status" data-testid="notice">
        {notice}
      </p>
      <output data-testid="parent-state">{String(value)}</output>
    </form>
  );
}

const parentState = () => screen.getByTestId("parent-state").textContent;
const notice = () => screen.getByTestId("notice").textContent;

/** What a native form submission would send for the field named "quantity". */
function submittedQuantity(container: HTMLElement): FormDataEntryValue | null {
  const form = container.querySelector("form");
  if (form === null) throw new Error("No form rendered");
  return new FormData(form).get("quantity");
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

  it("disables every control when max is below 1", () => {
    render(<QuantityStepper {...labels} value={1} max={0} onChange={() => {}} />);
    expect(input().disabled).toBe(true);
    expect(minus().disabled).toBe(true);
    expect(plus().disabled).toBe(true);
  });
});

describe("QuantityStepper keyboard and disabled", () => {
  it("steps up by one with arrow up, and stops at max", async () => {
    const onChange = vi.fn();
    render(<Harness initial={3} max={4} onChange={onChange} />);
    await userEvent.click(input());
    await userEvent.keyboard("{ArrowUp}");
    expect(input().value).toBe("4");
    expect(onChange).toHaveBeenLastCalledWith(4);
    await userEvent.keyboard("{ArrowUp}");
    expect(input().value).toBe("4");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("steps down by one with arrow down, and stops at 1", async () => {
    const onChange = vi.fn();
    render(<Harness initial={2} max={5} onChange={onChange} />);
    await userEvent.click(input());
    await userEvent.keyboard("{ArrowDown}");
    expect(input().value).toBe("1");
    expect(onChange).toHaveBeenLastCalledWith(1);
    await userEvent.keyboard("{ArrowDown}");
    expect(input().value).toBe("1");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("steps from the number being typed when an arrow key is pressed", async () => {
    const onChange = vi.fn();
    render(<Harness initial={1} max={9} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "5{ArrowUp}");
    expect(input().value).toBe("6");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(6);
  });

  it("disables the input and both buttons with the disabled prop, and ignores clicks", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <QuantityStepper
          {...labels}
          name="quantity"
          value={2}
          max={5}
          disabled
          onChange={onChange}
        />
      </form>,
    );
    expect(input().disabled).toBe(true);
    expect(minus().disabled).toBe(true);
    expect(plus().disabled).toBe(true);
    await userEvent.click(plus());
    await userEvent.click(minus());
    await userEvent.type(input(), "4{ArrowUp}");
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("2");
    // A disabled field is not part of a native form submission.
    expect(submittedQuantity(container)).toBeNull();
  });

  it("commits on Enter without submitting the surrounding form", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="หมายเหตุ" name="note" />
        <Harness initial={2} max={5} onChange={onChange} />
        <button type="submit">บันทึก</button>
      </form>,
    );
    await userEvent.clear(input());
    await userEvent.type(input(), "4{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(input().value).toBe("4");
    // Enter with nothing typed does not submit either.
    await userEvent.type(input(), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    // Control: Enter in an ordinary input of the same form does submit, so the assertions above
    // would fail if the stepper let the key through.
    await userEvent.type(screen.getByRole("textbox", { name: "หมายเหตุ" }), "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("QuantityStepper accessible names", () => {
  it("names the input from inputLabel and has no group when groupLabel is omitted", () => {
    render(<QuantityStepper {...labels} value={2} max={5} onChange={() => {}} />);
    expect(screen.getAllByRole("textbox", { name: "จำนวน" })).toHaveLength(1);
    expect(screen.queryByRole("group")).toBeNull();
    // Only the input carries the name: it is announced once.
    expect(screen.getAllByLabelText("จำนวน")).toHaveLength(1);
  });

  it("gives the group and the input one name each, and they differ", () => {
    render(
      <QuantityStepper
        {...labels}
        groupLabel="เสื้อยืดผ้าฝ้าย"
        value={2}
        max={5}
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole("group", { name: "เสื้อยืดผ้าฝ้าย" });
    const textbox = screen.getByRole("textbox", { name: "จำนวน" });
    expect(group.contains(textbox)).toBe(true);
    expect(screen.queryByRole("group", { name: "จำนวน" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "เสื้อยืดผ้าฝ้าย" })).toBeNull();
    expect(group.contains(minus())).toBe(true);
    expect(group.contains(plus())).toBe(true);
  });

  it("takes the input name from an external visible label when inputLabel is omitted", async () => {
    render(
      <>
        <label htmlFor="line-quantity">จำนวนที่ต้องการ</label>
        <QuantityStepper
          id="line-quantity"
          decreaseLabel="ลดจำนวน"
          increaseLabel="เพิ่มจำนวน"
          value={2}
          max={5}
          onChange={() => {}}
        />
      </>,
    );
    const textbox = screen.getByRole<HTMLInputElement>("textbox", { name: "จำนวนที่ต้องการ" });
    expect(textbox.id).toBe("line-quantity");
    expect(textbox.getAttribute("aria-label")).toBeNull();
    expect(screen.getByLabelText("จำนวนที่ต้องการ")).toBe(textbox);
    // Clicking the visible label moves focus to the input.
    await userEvent.click(screen.getByText("จำนวนที่ต้องการ"));
    expect(document.activeElement).toBe(textbox);
  });

  it("marks the input invalid and keeps the description when the parent says so", () => {
    render(
      <>
        <p id="stock-note">เหลือ 4 ชิ้น</p>
        <QuantityStepper
          {...labels}
          value={9}
          max={4}
          invalid
          aria-describedby="stock-note"
          onChange={() => {}}
        />
      </>,
    );
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("textbox", { description: "เหลือ 4 ชิ้น" })).toBe(input());
  });

  it("is not marked invalid by default, also when the value is out of range", () => {
    render(<QuantityStepper {...labels} value={9} max={4} onChange={() => {}} />);
    expect(input().getAttribute("aria-invalid")).toBeNull();
  });
});

// D-025, OQ-23: when stock drops below the quantity the customer chose, the quantity is lowered
// automatically to what is available and the customer is told. The stepper calls onChange with
// the lowered quantity and then onLowered, which the page uses for the announcement.
describe("QuantityStepper with a value above max (stock below the chosen quantity)", () => {
  it("lowers the quantity and tells the page: shown, submitted, and parent state all agree", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    const onOutOfRange = vi.fn();
    const { container } = render(
      <ParentHarness
        initial={9}
        max={4}
        policy="keep"
        onChange={onChange}
        onLowered={onLowered}
        onOutOfRange={onOutOfRange}
      />,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);
    expect(onLowered).toHaveBeenCalledTimes(1);
    expect(onLowered).toHaveBeenCalledWith(9, 4);
    // Not reported as a caller mistake, whatever the parent's policy for those is.
    expect(onOutOfRange).not.toHaveBeenCalled();
    expect(input().value).toBe("4");
    expect(submittedQuantity(container)).toBe("4");
    expect(parentState()).toBe("4");
    expect(plus().disabled).toBe(true);
    // The page's text is in its live region; the stepper itself renders no text.
    expect(notice()).toBe("ลดจาก 9 เหลือ 4");
    expect(input().getAttribute("aria-invalid")).toBeNull();
  });

  it("calls onChange before onLowered", () => {
    const calls: string[] = [];
    render(
      <QuantityStepper
        {...labels}
        value={9}
        max={4}
        onChange={(next) => calls.push(`change ${next}`)}
        onLowered={(previous, lowered) => calls.push(`lowered ${previous} ${lowered}`)}
      />,
    );
    expect(calls).toEqual(["change 4", "lowered 9 4"]);
  });

  it("lowers the quantity when max drops below it after mount", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    const view = (max: number) => (
      <ParentHarness
        initial={9}
        max={max}
        policy="keep"
        onChange={onChange}
        onLowered={onLowered}
      />
    );
    const { container, rerender } = render(view(10));
    expect(onChange).not.toHaveBeenCalled();
    expect(onLowered).not.toHaveBeenCalled();
    expect(input().value).toBe("9");
    expect(notice()).toBe("");

    rerender(view(4));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(onLowered).toHaveBeenCalledTimes(1);
    expect(onLowered).toHaveBeenLastCalledWith(9, 4);
    expect(input().value).toBe("4");
    expect(submittedQuantity(container)).toBe("4");
    expect(parentState()).toBe("4");
    expect(notice()).toBe("ลดจาก 9 เหลือ 4");

    // Stock drops again, below the lowered quantity: lowered again, announced again.
    rerender(view(3));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onLowered).toHaveBeenLastCalledWith(4, 3);
    expect(input().value).toBe("3");
    expect(notice()).toBe("ลดจาก 4 เหลือ 3");

    // Stock comes back: the lowered quantity stays, nothing is reported.
    rerender(view(10));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onLowered).toHaveBeenCalledTimes(2);
    expect(input().value).toBe("3");
    expect(parentState()).toBe("3");
  });

  it("lowers a fractional quantity above max to max", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    const onOutOfRange = vi.fn();
    render(
      <QuantityStepper
        {...labels}
        value={9.5}
        max={4}
        onChange={onChange}
        onLowered={onLowered}
        onOutOfRange={onOutOfRange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(4);
    expect(onLowered).toHaveBeenCalledWith(9.5, 4);
    expect(onOutOfRange).not.toHaveBeenCalled();
  });

  it("does not report a value that is in range", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    const onOutOfRange = vi.fn();
    render(
      <ParentHarness
        initial={4}
        max={4}
        policy="keep"
        onChange={onChange}
        onLowered={onLowered}
        onOutOfRange={onOutOfRange}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(onLowered).not.toHaveBeenCalled();
    expect(onOutOfRange).not.toHaveBeenCalled();
    expect(input().value).toBe("4");
    expect(notice()).toBe("");
  });

  // A parent that does not store what onChange gives it. The stepper still shows the parent's
  // value, and must not call it again on every render.
  it("lowers once for each pair of value and max when the parent does not take the new value", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    const view = (
      max: number,
      change: (value: number) => void = onChange,
      lowered: (previous: number, next: number) => void = onLowered,
    ) => (
      <form>
        <QuantityStepper
          {...labels}
          name="quantity"
          value={9}
          max={max}
          onChange={change}
          onLowered={lowered}
        />
      </form>
    );
    const { container, rerender } = render(view(4));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(onLowered).toHaveBeenCalledTimes(1);
    expect(onLowered).toHaveBeenLastCalledWith(9, 4);
    // The stepper never shows a number that differs from the parent's state.
    expect(input().value).toBe("9");
    expect(submittedQuantity(container)).toBe("9");
    expect(plus().disabled).toBe(true);
    expect(minus().disabled).toBe(false);

    // Re-rendering, also with new callback functions, does not repeat the same pair.
    const wrappedChange = vi.fn();
    const wrappedLowered = vi.fn();
    rerender(view(4, wrappedChange, wrappedLowered));
    rerender(view(4, wrappedChange, wrappedLowered));
    expect(wrappedChange).not.toHaveBeenCalled();
    expect(wrappedLowered).not.toHaveBeenCalled();
    expect(input().value).toBe("9");

    // The available stock changed, so the quantity is lowered to the new number.
    rerender(view(3));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(onLowered).toHaveBeenLastCalledWith(9, 3);

    // Back in range: nothing happens. Above max again later: lowered again.
    rerender(view(10));
    expect(onChange).toHaveBeenCalledTimes(2);
    rerender(view(3));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onLowered).toHaveBeenCalledTimes(3);
    expect(onLowered).toHaveBeenLastCalledWith(9, 3);
  });

  it("works without an onLowered callback", () => {
    const onChange = vi.fn();
    render(<QuantityStepper {...labels} value={9} max={4} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("moves to the nearest allowed quantity on the first step from above max", async () => {
    // The parent has not taken the lowered quantity yet, so the stepper still shows 9.
    const onChange = vi.fn();
    render(<QuantityStepper {...labels} value={9} max={4} onChange={onChange} />);
    onChange.mockClear();
    await userEvent.click(minus());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  // D-025, OQ-24.
  it("does nothing on arrow up while the value is above max, like the disabled plus button", async () => {
    const onChange = vi.fn();
    render(<QuantityStepper {...labels} value={9} max={4} onChange={onChange} />);
    onChange.mockClear();
    expect(plus().disabled).toBe(true);
    await userEvent.click(input());
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("9");
    // Arrow down still steps, to the nearest allowed quantity.
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("does nothing on arrow up while the number being typed is at or above max", async () => {
    const onChange = vi.fn();
    render(<Harness initial={2} max={5} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "99{ArrowUp}");
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("99");
    // Leaving the input still clamps what was typed.
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(input().value).toBe("5");
  });
});

// A value outside 1..max for a reason other than stock (below 1, a fraction, not a number) is a
// mistake of the caller. The stepper shows exactly the value it was given, a native form submits
// that same number, and the parent is told through onOutOfRange and decides what happens.
describe("QuantityStepper with a value outside 1 to max", () => {
  it("shows and submits the value it was given, and reports it once", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    const onOutOfRange = vi.fn();
    const view = (callback: (value: number, clamped: number) => void) => (
      <form>
        <QuantityStepper
          {...labels}
          name="quantity"
          value={0}
          max={4}
          onChange={onChange}
          onLowered={onLowered}
          onOutOfRange={callback}
        />
      </form>
    );
    const { container, rerender } = render(view(onOutOfRange));

    expect(input().value).toBe("0");
    expect(submittedQuantity(container)).toBe("0");
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
    expect(onOutOfRange).toHaveBeenCalledWith(0, 1);
    // The stepper does not change this quantity by itself.
    expect(onChange).not.toHaveBeenCalled();
    expect(onLowered).not.toHaveBeenCalled();
    expect(minus().disabled).toBe(true);
    expect(plus().disabled).toBe(false);

    // Re-rendering, also with a new callback function, does not report the same value again.
    const wrapped = vi.fn((value: number, clamped: number) => onOutOfRange(value, clamped));
    rerender(view(wrapped));
    rerender(view(wrapped));
    expect(wrapped).not.toHaveBeenCalled();
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("0");
  });

  it("lets the parent adopt the clamped value: shown, submitted, and parent state all agree", () => {
    const onOutOfRange = vi.fn();
    const { container } = render(
      <ParentHarness initial={0} max={4} policy="adopt" onOutOfRange={onOutOfRange} />,
    );
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
    expect(onOutOfRange).toHaveBeenCalledWith(0, 1);
    expect(input().value).toBe("1");
    expect(submittedQuantity(container)).toBe("1");
    expect(parentState()).toBe("1");
    expect(minus().disabled).toBe(true);
  });

  it("lets the parent keep the value and show a message: shown, submitted, and parent state all agree", () => {
    const onOutOfRange = vi.fn();
    const { container } = render(
      <ParentHarness initial={0} max={4} policy="keep" onOutOfRange={onOutOfRange} />,
    );
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("0");
    expect(submittedQuantity(container)).toBe("0");
    expect(parentState()).toBe("0");
    expect(screen.getByRole("textbox", { description: "เกิน 1" })).toBe(input());
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });

  it("reports again when the value changes to another one outside the range", () => {
    const onOutOfRange = vi.fn();
    const view = (value: number) => (
      <QuantityStepper
        {...labels}
        value={value}
        max={4}
        onChange={() => {}}
        onOutOfRange={onOutOfRange}
      />
    );
    const { rerender } = render(view(0));
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
    expect(onOutOfRange).toHaveBeenLastCalledWith(0, 1);

    // Same value again: no second report.
    rerender(view(0));
    expect(onOutOfRange).toHaveBeenCalledTimes(1);

    rerender(view(-2));
    expect(onOutOfRange).toHaveBeenCalledTimes(2);
    expect(onOutOfRange).toHaveBeenLastCalledWith(-2, 1);

    // Back in range: nothing to report. Out of range again later: reported again.
    rerender(view(3));
    expect(onOutOfRange).toHaveBeenCalledTimes(2);
    rerender(view(-2));
    expect(onOutOfRange).toHaveBeenCalledTimes(3);
    expect(onOutOfRange).toHaveBeenLastCalledWith(-2, 1);
  });

  // D-025, OQ-24.
  it("does nothing on arrow down while the value is below 1, like the disabled minus button", async () => {
    const onChange = vi.fn();
    render(<ParentHarness initial={0} max={4} policy="keep" onChange={onChange} />);
    expect(minus().disabled).toBe(true);
    await userEvent.click(input());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("0");
    expect(parentState()).toBe("0");
    // Arrow up still steps, to the nearest allowed quantity.
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(input().value).toBe("1");
  });

  it("does nothing on arrow down while the number being typed is 1 or less", async () => {
    const onChange = vi.fn();
    render(<Harness initial={3} max={5} onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "0{ArrowDown}");
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("0");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(input().value).toBe("1");
  });

  it("reports a value below 1 and moves to 1 on the first step", async () => {
    const onChange = vi.fn();
    const onOutOfRange = vi.fn();
    const { container } = render(
      <ParentHarness
        initial={0}
        max={4}
        policy="keep"
        onChange={onChange}
        onOutOfRange={onOutOfRange}
      />,
    );
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
    expect(onOutOfRange).toHaveBeenCalledWith(0, 1);
    expect(input().value).toBe("0");
    expect(submittedQuantity(container)).toBe("0");
    expect(minus().disabled).toBe(true);
    await userEvent.click(plus());
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(input().value).toBe("1");
  });

  it("restores the out-of-range value, without onChange, when the input is left empty", async () => {
    const onChange = vi.fn();
    render(<ParentHarness initial={0} max={4} policy="keep" onChange={onChange} />);
    await userEvent.clear(input());
    await userEvent.tab();
    expect(input().value).toBe("0");
    expect(parentState()).toBe("0");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("restores a value above max that the parent kept, when the input is left empty", async () => {
    const onChange = vi.fn();
    render(<QuantityStepper {...labels} value={9} max={4} onChange={onChange} />);
    onChange.mockClear();
    await userEvent.clear(input());
    await userEvent.tab();
    expect(input().value).toBe("9");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a fractional value and steps to the next whole number", async () => {
    const onChange = vi.fn();
    const onOutOfRange = vi.fn();
    render(
      <ParentHarness
        initial={2.5}
        max={5}
        policy="keep"
        onChange={onChange}
        onOutOfRange={onOutOfRange}
      />,
    );
    expect(onOutOfRange).toHaveBeenCalledWith(2.5, 2);
    expect(input().value).toBe("2.5");
    await userEvent.click(plus());
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it("shows an empty input for a value that is not a number, and reports it", () => {
    const onOutOfRange = vi.fn();
    const { container, rerender } = render(
      <ParentHarness initial={Number.NaN} max={4} policy="keep" onOutOfRange={onOutOfRange} />,
    );
    expect(input().value).toBe("");
    expect(submittedQuantity(container)).toBe("");
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
    expect(onOutOfRange.mock.calls[0]?.[0]).toBeNaN();
    expect(onOutOfRange.mock.calls[0]?.[1]).toBe(1);
    rerender(
      <ParentHarness initial={Number.NaN} max={4} policy="keep" onOutOfRange={onOutOfRange} />,
    );
    expect(onOutOfRange).toHaveBeenCalledTimes(1);
  });

  it("does not report while max is below 1: the control is disabled and submits nothing", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    const onOutOfRange = vi.fn();
    const { container } = render(
      <ParentHarness
        initial={3}
        max={0}
        policy="keep"
        onChange={onChange}
        onLowered={onLowered}
        onOutOfRange={onOutOfRange}
      />,
    );
    expect(onOutOfRange).not.toHaveBeenCalled();
    // No quantity is allowed, so nothing is lowered either.
    expect(onChange).not.toHaveBeenCalled();
    expect(onLowered).not.toHaveBeenCalled();
    expect(input().disabled).toBe(true);
    expect(input().value).toBe("3");
    expect(parentState()).toBe("3");
    expect(submittedQuantity(container)).toBeNull();
  });

  it("works without an onOutOfRange callback", () => {
    const onChange = vi.fn();
    render(<QuantityStepper {...labels} value={0} max={4} onChange={onChange} />);
    expect(input().value).toBe("0");
    expect(minus().disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("QuantityStepper typed numbers and the disabled state", () => {
  it("commits a number too long to hold as max, not as 1", async () => {
    const onChange = vi.fn();
    render(<Harness initial={2} max={5} onChange={onChange} />);
    const digits = "9".repeat(400);
    expect(Number(digits)).toBe(Number.POSITIVE_INFINITY);
    await userEvent.clear(input());
    await userEvent.click(input());
    await userEvent.paste(digits);
    expect(input().value).toBe(digits);
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(input().value).toBe("5");
  });

  it("commits a number too long to hold as max on Enter and on arrow down as well", async () => {
    const onChange = vi.fn();
    render(<Harness initial={2} max={5} onChange={onChange} />);
    const digits = "9".repeat(400);
    await userEvent.clear(input());
    await userEvent.click(input());
    await userEvent.paste(digits);
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(input().value).toBe("5");

    await userEvent.click(minus());
    expect(input().value).toBe("4");
    await userEvent.clear(input());
    await userEvent.click(input());
    await userEvent.paste(digits);
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(input().value).toBe("5");
  });

  it("discards a typed draft when the control is disabled, and shows the committed value when enabled again", async () => {
    const onChange = vi.fn();
    const view = (disabled: boolean) => (
      <QuantityStepper {...labels} value={2} max={9} disabled={disabled} onChange={onChange} />
    );
    const { rerender } = render(view(false));
    await userEvent.clear(input());
    await userEvent.type(input(), "7");
    expect(input().value).toBe("7");

    rerender(view(true));
    expect(input().disabled).toBe(true);
    expect(input().value).toBe("2");

    rerender(view(false));
    expect(input().disabled).toBe(false);
    expect(input().value).toBe("2");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards a typed draft when max drops under 1 and comes back", async () => {
    const onChange = vi.fn();
    const view = (max: number) => (
      <QuantityStepper {...labels} value={2} max={max} onChange={onChange} />
    );
    const { rerender } = render(view(9));
    await userEvent.clear(input());
    await userEvent.type(input(), "7");
    rerender(view(0));
    expect(input().value).toBe("2");
    rerender(view(9));
    expect(input().value).toBe("2");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lowers a quantity above max while the disabled prop is set too", () => {
    const onChange = vi.fn();
    const onLowered = vi.fn();
    render(
      <ParentHarness
        initial={9}
        max={4}
        policy="keep"
        disabled
        onChange={onChange}
        onLowered={onLowered}
      />,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onLowered).toHaveBeenCalledWith(9, 4);
    expect(input().disabled).toBe(true);
    expect(input().value).toBe("4");
    expect(parentState()).toBe("4");
  });
});
