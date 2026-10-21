import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("shows the label, the value, and the note", () => {
    render(<StatCard label="สินค้าที่เผยแพร่" value="12" note="ทั้งหมดในร้าน" />);
    expect(screen.getByText("สินค้าที่เผยแพร่")).toBeTruthy();
    const value = screen.getByText("12");
    expect(value.classList.contains("tabular-nums")).toBe(true);
    expect(screen.getByText("ทั้งหมดในร้าน")).toBeTruthy();
  });

  it("does not render a note or any trend when none is given", () => {
    const { container } = render(<StatCard label="a" value="1" />);
    expect(container.querySelectorAll("span")).toHaveLength(2);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("is a plain div by default and an li on request", () => {
    const { container, rerender } = render(<StatCard label="a" value="1" />);
    expect(container.firstElementChild?.tagName).toBe("DIV");
    rerender(
      <ul>
        <StatCard as="li" label="a" value="1" />
      </ul>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("becomes one link whose name reads the label then the value", () => {
    render(<StatCard label="สินค้าหมด" value="3" href="/seller/products?soldOut=true" />);
    const link = screen.getByRole("link", { name: "สินค้าหมด 3" });
    expect(link.getAttribute("href")).toBe("/seller/products?soldOut=true");
    expect(link.classList.contains("focus-ring")).toBe(true);
  });

  it("shows a hidden-from-view skeleton and loading text while loading", () => {
    const { container } = render(
      <StatCard label="ยอดขาย" value="99" loading loadingLabel="กำลังโหลด" href="/x" />,
    );
    expect(screen.queryByText("99")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("กำลังโหลด").classList.contains("sr-only")).toBe(true);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("shows error text with an icon in place of the value", () => {
    const { container } = render(
      <StatCard label="ยอดขาย" value="99" errorText="โหลดไม่สำเร็จ" href="/x" />,
    );
    expect(screen.getByText("โหลดไม่สำเร็จ")).toBeTruthy();
    expect(screen.queryByText("99")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("shows the value 0", () => {
    render(<StatCard label="a" value={0} />);
    expect(screen.getByText("0")).toBeTruthy();
  });
});
