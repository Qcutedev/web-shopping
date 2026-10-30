import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotifyBadge } from "./notify-badge";

describe("NotifyBadge", () => {
  it("shows a red count", () => {
    const { container } = render(<NotifyBadge count={3} />);
    const badge = container.querySelector("[data-notify-badge]");
    expect(badge?.textContent).toBe("3");
    expect(badge?.className).toContain("bg-danger");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
  });

  it("caps above 99", () => {
    const { container } = render(<NotifyBadge count={120} />);
    expect(container.textContent).toBe("99+");
  });

  it.each([0, -1, 1.5, Number.NaN])("renders nothing for %s", (count) => {
    const { container } = render(<NotifyBadge count={count} />);
    expect(container.innerHTML).toBe("");
  });
});
