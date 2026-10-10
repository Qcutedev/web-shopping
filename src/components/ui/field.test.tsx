import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";
import { hasContent } from "./field";
import { InputField } from "./input";
import { Radio, RadioGroup } from "./radio";

function describedByText(element: HTMLElement): string {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

describe("hasContent", () => {
  it("is false for values that React renders as nothing", () => {
    expect(hasContent(undefined)).toBe(false);
    expect(hasContent(null)).toBe(false);
    expect(hasContent(false)).toBe(false);
    expect(hasContent(true)).toBe(false);
    expect(hasContent("")).toBe(false);
  });

  it("is true for text, elements, and the number 0", () => {
    expect(hasContent("กรุณากรอกอีเมล")).toBe(true);
    expect(hasContent(<span>ข้อความ</span>)).toBe(true);
    expect(hasContent(0)).toBe(true);
  });
});

// The number 0 is the value where `Boolean(text)` and `hasContent(text)` disagree. The visible
// message, aria-describedby, and aria-invalid must agree in every primitive.
describe("error and helper text of 0", () => {
  it("InputField shows the error, links it, and marks the input invalid", () => {
    render(<InputField label="จำนวน" errorText={0} />);
    const input = screen.getByLabelText("จำนวน");
    expect(document.querySelector("[data-field-error]")?.textContent).toBe("0");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(input)).toBe("0");
  });

  it("Checkbox shows the error, links it, and marks the checkbox invalid", () => {
    render(<Checkbox label="ยอมรับเงื่อนไข" errorText={0} />);
    const checkbox = screen.getByRole("checkbox", { name: "ยอมรับเงื่อนไข" });
    expect(document.querySelector("[data-field-error]")?.textContent).toBe("0");
    expect(checkbox.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(checkbox)).toBe("0");
  });

  it("Checkbox links helper text of 0 without marking the checkbox invalid", () => {
    render(<Checkbox label="ยอมรับเงื่อนไข" helperText={0} />);
    const checkbox = screen.getByRole("checkbox", { name: "ยอมรับเงื่อนไข" });
    expect(document.querySelector("[data-field-error]")).toBeNull();
    expect(checkbox.getAttribute("aria-invalid")).toBeNull();
    expect(describedByText(checkbox)).toBe("0");
  });

  it("RadioGroup shows the error, links it, and marks the group invalid", () => {
    render(
      <RadioGroup legend="วิธีจัดส่ง" errorText={0}>
        <Radio name="shipping" value="standard" label="มาตรฐาน" />
      </RadioGroup>,
    );
    const group = screen.getByRole("radiogroup", { name: "วิธีจัดส่ง" });
    expect(document.querySelector("[data-field-error]")?.textContent).toBe("0");
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(group)).toBe("0");
  });

  it("RadioGroup links helper text of 0 without marking the group invalid", () => {
    render(
      <RadioGroup legend="วิธีจัดส่ง" helperText={0}>
        <Radio name="shipping" value="standard" label="มาตรฐาน" />
      </RadioGroup>,
    );
    const group = screen.getByRole("radiogroup", { name: "วิธีจัดส่ง" });
    expect(document.querySelector("[data-field-error]")).toBeNull();
    expect(group.getAttribute("aria-invalid")).toBeNull();
    expect(describedByText(group)).toBe("0");
  });
});

describe("error text that renders nothing", () => {
  it.each([[""], [false], [true], [null]])(
    "%j leaves checkbox and radio group valid with no message",
    (errorText) => {
      render(
        <>
          <Checkbox label="ยอมรับเงื่อนไข" errorText={errorText} />
          <RadioGroup legend="วิธีจัดส่ง" errorText={errorText}>
            <Radio name="shipping" value="standard" label="มาตรฐาน" />
          </RadioGroup>
        </>,
      );
      const checkbox = screen.getByRole("checkbox", { name: "ยอมรับเงื่อนไข" });
      const group = screen.getByRole("radiogroup", { name: "วิธีจัดส่ง" });
      expect(document.querySelector("[data-field-error]")).toBeNull();
      for (const element of [checkbox, group]) {
        expect(element.getAttribute("aria-invalid")).toBeNull();
        expect(element.getAttribute("aria-describedby")).toBeNull();
      }
    },
  );
});
