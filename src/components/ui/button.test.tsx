import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "./button";

describe("Button", () => {
  it("fires onClick when enabled and defaults to type button", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>บันทึก</Button>);
    const button = screen.getByRole("button", { name: "บันทึก" });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("type")).toBe("button");
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        บันทึก
      </Button>,
    );
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "บันทึก" });
    await userEvent.click(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBeNull();
  });

  it("does not fire onClick while loading, and keeps its accessible name", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        ชำระเงิน
      </Button>,
    );
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "ชำระเงิน" });
    await userEvent.click(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("does not submit its form while loading", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          ชำระเงิน
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ชำระเงิน" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a visible focus ring and the 44px minimum height in every variant", () => {
    for (const variant of ["primary", "dark", "secondary", "ghost", "danger"] as const) {
      const classes = buttonVariants({ variant }).split(" ");
      expect(classes).toContain("focus-ring");
      expect(classes).toContain("h-11");
    }
  });
});
