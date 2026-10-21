import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileUpload, type FileUploadItem, type FileUploadProps } from "./file-upload";

function setup(props: Partial<FileUploadProps> = {}) {
  const onFiles = vi.fn();
  const utils = render(
    <FileUpload
      label="รูปสินค้า"
      dropText="ลากไฟล์มาวางที่นี่ หรือ"
      buttonLabel="เลือกไฟล์"
      limitsText="JPEG, PNG ไม่เกิน 5 MB ไม่เกิน 8 ไฟล์"
      removeLabel={(name) => `ลบไฟล์ ${name}`}
      progressLabel={(name) => `ความคืบหน้าของ ${name}`}
      onFiles={onFiles}
      accept="image/jpeg,image/png"
      {...props}
    />,
  );
  const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...utils, onFiles, input };
}

const file = (name: string) => new File(["x"], name, { type: "image/png" });

describe("FileUpload", () => {
  it("is a labelled group that shows its limits", () => {
    setup();
    const group = screen.getByRole("group", { name: "รูปสินค้า" });
    const limits = screen.getByText("JPEG, PNG ไม่เกิน 5 MB ไม่เกิน 8 ไฟล์");
    expect(group.getAttribute("aria-describedby")).toContain(limits.id);
  });

  it("opens the native picker from the button, which the keyboard can press", async () => {
    const { input } = setup();
    const click = vi.spyOn(input, "click");
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "เลือกไฟล์" }));
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledTimes(1);
    expect(input.getAttribute("accept")).toBe("image/jpeg,image/png");
    expect(input.tabIndex).toBe(-1);
  });

  it("hands chosen files to onFiles", async () => {
    const { input, onFiles } = setup({ multiple: true });
    await userEvent.upload(input, [file("a.png"), file("b.png")]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect((onFiles.mock.calls[0]![0] as File[]).map((f) => f.name)).toEqual(["a.png", "b.png"]);
  });

  it("passes only the first file when not multiple", () => {
    const { input, onFiles } = setup();
    fireEvent.change(input, { target: { files: [file("a.png"), file("b.png")] } });
    expect((onFiles.mock.calls[0]![0] as File[]).map((f) => f.name)).toEqual(["a.png"]);
  });

  it("accepts dropped files and shows the drag state", () => {
    const { onFiles, container } = setup({ multiple: true });
    const zone = container.querySelector("[data-dragging], .border-dashed") as HTMLElement;
    fireEvent.dragOver(zone);
    expect(zone.getAttribute("data-dragging")).toBe("true");
    fireEvent.drop(zone, { dataTransfer: { files: [file("a.png")] } });
    expect(zone.getAttribute("data-dragging")).toBeNull();
    expect((onFiles.mock.calls[0]![0] as File[]).map((f) => f.name)).toEqual(["a.png"]);
  });

  it("ignores drops and disables the button when disabled", () => {
    const { onFiles, container } = setup({ disabled: true });
    const zone = container.querySelector(".border-dashed") as HTMLElement;
    fireEvent.dragOver(zone);
    expect(zone.getAttribute("data-dragging")).toBeNull();
    fireEvent.drop(zone, { dataTransfer: { files: [file("a.png")] } });
    expect(onFiles).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "เลือกไฟล์" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows a control error as text with an icon and links it to the group", () => {
    const { container } = setup({ errorText: "เลือกได้ไม่เกิน 8 ไฟล์" });
    const message = screen.getByText("เลือกได้ไม่เกิน 8 ไฟล์");
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-describedby")).toContain(message.closest("p")!.id);
    expect(message.closest("p")!.querySelector("svg")).toBeTruthy();
    expect(container.querySelector(".border-danger")).toBeTruthy();
  });

  it("shows per-file progress, success, and error with text", async () => {
    const onRemove = vi.fn();
    const items: FileUploadItem[] = [
      { id: "1", name: "a.png", status: "uploading", progress: 40, statusText: "กำลังอัปโหลด 40%" },
      { id: "2", name: "b.png", status: "done", statusText: "อัปโหลดแล้ว" },
      {
        id: "3",
        name: "c.png",
        status: "error",
        statusText: "ล้มเหลว",
        errorText: "ไฟล์ใหญ่เกิน 5 MB",
      },
    ];
    setup({ items, onRemove });
    const bar = screen.getByRole("progressbar", { name: "ความคืบหน้าของ a.png" });
    expect(bar.getAttribute("value")).toBe("40");
    expect(screen.getByText("กำลังอัปโหลด 40%")).toBeTruthy();
    expect(screen.getByText("อัปโหลดแล้ว")).toBeTruthy();
    expect(screen.getByText("ไฟล์ใหญ่เกิน 5 MB")).toBeTruthy();
    expect(screen.queryByText("ล้มเหลว")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "ลบไฟล์ c.png" }));
    expect(onRemove).toHaveBeenCalledWith("3");
  });

  it("clamps progress and leaves it indeterminate when unknown", () => {
    setup({
      items: [
        { id: "1", name: "a.png", status: "uploading", progress: 250, statusText: "x" },
        { id: "2", name: "b.png", status: "uploading", statusText: "y" },
      ],
    });
    expect(
      screen.getByRole("progressbar", { name: "ความคืบหน้าของ a.png" }).getAttribute("value"),
    ).toBe("100");
    expect(
      screen.getByRole("progressbar", { name: "ความคืบหน้าของ b.png" }).getAttribute("value"),
    ).toBeNull();
  });

  it("has no remove buttons without onRemove", () => {
    setup({ items: [{ id: "1", name: "a.png", status: "done", statusText: "เสร็จ" }] });
    expect(screen.queryByRole("button", { name: /ลบไฟล์/ })).toBeNull();
  });
});
