import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserName } from "./user-name";

describe("UserName", () => {
  it("wraps the text in a bdi element, so a right-to-left name cannot reorder its surroundings", () => {
    const { container } = render(
      <p>
        ผู้ซื้อ <UserName>שלום</UserName>
      </p>,
    );
    const bdi = container.querySelector("p > bdi");
    expect(bdi?.textContent).toBe("שלום");
  });

  it("does not interpret markup in the name", () => {
    const { container } = render(<UserName>{"<img src=x onerror=alert(1)>"}</UserName>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("bdi")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
