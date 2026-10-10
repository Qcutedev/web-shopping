import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  it("is neutral by default and shows its label", () => {
    render(<Badge>ฉบับร่าง</Badge>);
    const badge = screen.getByText("ฉบับร่าง");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.getAttribute("data-tone")).toBe("neutral");
  });

  it("gives each tone its own text colour on its soft background", () => {
    const expected = {
      primary: ["bg-primary-soft", "text-primary"],
      success: ["bg-success-soft", "text-success"],
      warning: ["bg-warning-soft", "text-warning"],
      danger: ["bg-danger-soft", "text-danger"],
      info: ["bg-info-soft", "text-info"],
    } as const;
    for (const [variant, classes] of Object.entries(expected)) {
      const { unmount } = render(<Badge variant={variant as keyof typeof expected}>สถานะ</Badge>);
      const badge = screen.getByText("สถานะ");
      expect(badge.getAttribute("data-tone")).toBe(variant);
      for (const name of classes) expect(badge.classList.contains(name)).toBe(true);
      unmount();
    }
  });

  // D-025, OQ-02: the shipped status badge is blue (the info tone), not the accent green.
  it("shows the shipped status in the info tone, not the accent", () => {
    render(<Badge variant="shipped">จัดส่งแล้ว</Badge>);
    const badge = screen.getByText("จัดส่งแล้ว");
    expect(badge.getAttribute("data-tone")).toBe("info");
    expect(badge.classList.contains("bg-info-soft")).toBe(true);
    expect(badge.classList.contains("text-info")).toBe(true);
    expect(badge.classList.contains("bg-primary-soft")).toBe(false);
    expect(badge.classList.contains("text-primary")).toBe(false);
  });
});
