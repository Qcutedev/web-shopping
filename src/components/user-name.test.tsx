import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { USER_NAME_CONTAINER_CLASS, UserName } from "./user-name";

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

describe("UserName container clipping (SEC-042 display part)", () => {
  const stacked = "ก" + "́".repeat(1000);

  it("keeps 1,000 combining marks in a bare bdi, and the container class clips and wraps", () => {
    const { container } = render(
      <p className={USER_NAME_CONTAINER_CLASS}>
        <UserName>{stacked}</UserName>
      </p>,
    );
    expect(container.querySelector("p > bdi")?.textContent).toBe(stacked);
    const classes = container.querySelector("p")?.className.split(" ") ?? [];
    expect(classes).toContain("overflow-hidden");
    expect(classes).toContain("max-w-full");
    expect(classes).toContain("min-w-0");
    expect(classes).toContain("[overflow-wrap:anywhere]");
  });
});
