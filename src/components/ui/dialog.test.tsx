import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, type DialogProps } from "./dialog";

function Harness(props: Partial<DialogProps> & { withFocusRef?: boolean }) {
  const { withFocusRef, ...rest } = props;
  const [open, setOpen] = useState(false);
  const second = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button onClick={() => setOpen(true)}>เปิด</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="ยกเลิกคำสั่งซื้อ"
        description="การดำเนินการนี้ย้อนกลับไม่ได้"
        closeLabel="ปิด"
        initialFocusRef={withFocusRef ? second : undefined}
        footer={
          <>
            <button>ไม่ยกเลิก</button>
            <button ref={second}>ยกเลิกคำสั่งซื้อ</button>
          </>
        }
        {...rest}
      >
        <p>เนื้อหา</p>
        <input aria-label="เหตุผล" />
      </Dialog>
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "เปิด" });
  await user.click(trigger);
  return { user, trigger };
}

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its title and described by its description", async () => {
    render(<Harness />);
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกคำสั่งซื้อ" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const description = screen.getByText("การดำเนินการนี้ย้อนกลับไม่ได้");
    expect(dialog.getAttribute("aria-describedby")).toBe(description.id);
    expect(screen.getByRole("heading", { name: "ยกเลิกคำสั่งซื้อ" }).tagName).toBe("H2");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it("supports the alertdialog role", async () => {
    render(<Harness role="alertdialog" />);
    await openDialog();
    expect(screen.getByRole("alertdialog", { name: "ยกเลิกคำสั่งซื้อ" })).toBeTruthy();
  });

  it("moves focus to the first control in the body, not the close button", async () => {
    render(<Harness />);
    await openDialog();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "เหตุผล" }));
  });

  it("focuses initialFocusRef when given", async () => {
    render(<Harness withFocusRef />);
    await openDialog();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "ยกเลิกคำสั่งซื้อ" }));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<Harness />);
    const { user, trigger } = await openDialog();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from the close button and returns focus", async () => {
    render(<Harness />);
    const { user, trigger } = await openDialog();
    await user.click(screen.getByRole("button", { name: "ปิด" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab inside the dialog in both directions", async () => {
    render(<Harness />);
    const { user } = await openDialog();
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "ปิด" });
    const confirm = screen.getByRole("button", { name: "ยกเลิกคำสั่งซื้อ" });
    // Focus starts on the input. Tab order: close, input, keep, confirm.
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    for (let i = 0; i < 10; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("pulls focus back in when it leaves the dialog", async () => {
    render(<Harness />);
    await openDialog();
    screen.getByRole("button", { name: "เปิด", hidden: true }).focus();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("closes on a backdrop click for a dialog but not for an alertdialog", async () => {
    const { unmount } = render(<Harness />);
    const { user } = await openDialog();
    await user.click(document.querySelector("[data-dialog-backdrop]")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    render(<Harness role="alertdialog" />);
    const second = await openDialog();
    await second.user.click(document.querySelector("[data-dialog-backdrop]")!);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("ignores Escape, the backdrop, and the close button while not dismissible", async () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="t" closeLabel="ปิด" dismissible={false} />);
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    await user.click(document.querySelector("[data-dialog-backdrop]")!);
    expect((screen.getByRole("button", { name: "ปิด" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks page scroll while open and restores it", async () => {
    render(<Harness />);
    const { user } = await openDialog();
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("focuses the panel itself when it has no controls and keeps focus there", async () => {
    render(<Dialog open onClose={() => {}} title="t" closeLabel="ปิด" />);
    const user = userEvent.setup();
    // The close button is the only control, so it takes focus.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "ปิด" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "ปิด" }));
  });
});
