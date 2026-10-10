import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Price } from "./price";

describe("Price", () => {
  it("renders integer satang as THB with tabular numerals", () => {
    render(<Price satang={29000} data-testid="price" />);
    const price = screen.getByTestId("price");
    expect(price.textContent).toBe("฿290.00");
    expect(price.className).toContain("tabular-nums");
  });

  it("uses the card and product-page type styles", () => {
    render(
      <>
        <Price satang={100} size="card" data-testid="card" />
        <Price satang={100} size="page" data-testid="page" />
      </>,
    );
    expect(screen.getByTestId("card").className).toContain("type-price-card");
    expect(screen.getByTestId("page").className).toContain("type-price-page");
  });

  it("throws instead of rendering a non-integer amount", () => {
    expect(() => render(<Price satang={290.5} />)).toThrow(RangeError);
  });
});
