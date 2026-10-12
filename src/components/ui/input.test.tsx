import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";
import { Input, InputField } from "./input";
import { Radio } from "./radio";
import { SearchField } from "./search-field";
import { SelectField } from "./select";
import { TextareaField } from "./textarea";

function describedByText(element: HTMLElement): string {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

describe("InputField", () => {
  it("associates the label with the input", () => {
    render(<InputField label="อีเมล" name="email" />);
    const input = screen.getByLabelText("อีเมล");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  it("links helper text with aria-describedby without marking the input invalid", () => {
    render(<InputField label="รหัสผ่าน" helperText="อย่างน้อย 8 ตัวอักษร" />);
    const input = screen.getByLabelText("รหัสผ่าน");
    expect(describedByText(input)).toBe("อย่างน้อย 8 ตัวอักษร");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks the input invalid and points aria-describedby at the error text", () => {
    render(
      <InputField
        label="อีเมล"
        helperText="ใช้สำหรับเข้าสู่ระบบ"
        errorText="กรุณากรอกอีเมลให้ถูกต้อง"
      />,
    );
    const input = screen.getByLabelText("อีเมล");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const message = document.getElementById(describedBy ?? "");
    expect(message).not.toBeNull();
    expect(message?.textContent).toBe("กรุณากรอกอีเมลให้ถูกต้อง");
    // The error replaces the helper text.
    expect(screen.queryByText("ใช้สำหรับเข้าสู่ระบบ")).toBeNull();
    // It sits in a polite live region so it is announced when it appears.
    expect(message?.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps a caller-supplied aria-describedby next to the error id", () => {
    render(
      <>
        <p id="hint">คำแนะนำเพิ่มเติม</p>
        <InputField label="ชื่อร้าน" aria-describedby="hint" errorText="กรุณากรอกชื่อร้าน" />
      </>,
    );
    expect(describedByText(screen.getByLabelText("ชื่อร้าน"))).toBe(
      "คำแนะนำเพิ่มเติม กรุณากรอกชื่อร้าน",
    );
  });

  it("uses the given id for the control", () => {
    render(<InputField id="store-name" label="ชื่อร้าน" errorText="กรุณากรอกชื่อร้าน" />);
    const input = screen.getByLabelText("ชื่อร้าน");
    expect(input.id).toBe("store-name");
    expect(input.getAttribute("aria-describedby")).toBe("store-name-message");
  });
});

describe("Input", () => {
  it("sets aria-invalid from the invalid prop", () => {
    render(<Input aria-label="ค้นหา" invalid />);
    expect(screen.getByLabelText("ค้นหา").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("TextareaField and SelectField", () => {
  it("wire the error text the same way", () => {
    render(
      <>
        <TextareaField label="รายละเอียด" errorText="กรุณากรอกรายละเอียด" />
        <SelectField label="หมวดหมู่" errorText="กรุณาเลือกหมวดหมู่">
          <option value="">-</option>
        </SelectField>
      </>,
    );
    const textarea = screen.getByLabelText("รายละเอียด");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(textarea)).toBe("กรุณากรอกรายละเอียด");

    const select = screen.getByLabelText("หมวดหมู่");
    expect(select.tagName).toBe("SELECT");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(select)).toBe("กรุณาเลือกหมวดหมู่");
  });
});

describe("hover border of form controls (D-026, OQ-45)", () => {
  it("is the ink hover token on the input, textarea, select, checkbox, radio, and search field", () => {
    render(
      <>
        <InputField label="อีเมล" />
        <TextareaField label="รายละเอียด" />
        <SelectField label="หมวดหมู่">
          <option value="">-</option>
        </SelectField>
        <Checkbox label="ยอมรับเงื่อนไข" />
        <Radio label="จัดส่งมาตรฐาน" name="shipping" />
        <SearchField name="q" label="ค้นหาสินค้า" submitLabel="ค้นหา" />
      </>,
    );
    const controls = [
      screen.getByLabelText("อีเมล"),
      screen.getByLabelText("รายละเอียด"),
      screen.getByLabelText("หมวดหมู่"),
      screen.getByRole("checkbox", { name: "ยอมรับเงื่อนไข" }),
      screen.getByRole("radio", { name: "จัดส่งมาตรฐาน" }),
      screen.getByRole("search"),
    ];
    for (const control of controls) {
      const classes = control.className.split(" ");
      expect(classes).toContain("border-control-border");
      expect(classes).toContain("hover:border-control-border-hover");
      // The border at rest is no longer repeated as the hover border.
      expect(classes).not.toContain("hover:border-border-contrast");
    }
  });

  // The class name alone proves nothing about which rule wins; the order of the compiled rules is
  // checked in style-order.test.ts (CR-01). This test only checks the control is marked invalid
  // and carries the enabled-only error border class (CR-07).
  it("marks an invalid control and carries the enabled-only error border class", () => {
    render(<InputField label="อีเมล" errorText="กรุณากรอกอีเมลให้ถูกต้อง" />);
    const control = screen.getByLabelText("อีเมล");
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(control.className.split(" ")).toContain("aria-invalid:enabled:border-danger");
    expect(control.className.split(" ")).not.toContain("aria-invalid:border-danger");
  });
});

describe("Checkbox", () => {
  it("is labelled, and links its error text", () => {
    render(<Checkbox label="ยอมรับเงื่อนไข" errorText="กรุณายอมรับเงื่อนไข" />);
    const checkbox = screen.getByRole("checkbox", { name: "ยอมรับเงื่อนไข" });
    expect(checkbox.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(checkbox)).toBe("กรุณายอมรับเงื่อนไข");
  });
});
