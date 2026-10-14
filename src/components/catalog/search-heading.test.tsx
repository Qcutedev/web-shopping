import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import { SearchHeading } from "./search-heading";

describe("SearchHeading", () => {
  it("isolates only q in bdi, keeping the fixed wording outside", () => {
    const { container } = render(<SearchHeading q="กาแฟ" />);
    const h1 = container.querySelector("h1");
    expect(container.querySelectorAll("bdi")).toHaveLength(1);
    expect(container.querySelector("bdi")?.textContent).toBe("กาแฟ");
    expect(h1?.textContent).toBe(
      `${th.catalog.search.resultsForPrefix}กาแฟ${th.catalog.search.resultsForSuffix}`,
    );
  });

  it("shows the whole-catalogue title without q", () => {
    const { container } = render(<SearchHeading q={undefined} />);
    expect(container.querySelector("bdi")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe(th.catalog.search.allTitle);
  });
});
