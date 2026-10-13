import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";
import { AppShell } from "./app-shell";
import { MAX_SEARCH_TEXT_LENGTH } from "@/modules/catalog/schema";
import { CartLink } from "./cart-link";

describe("AppShell", () => {
  it("has one main landmark that holds the page, one banner, and one footer", () => {
    render(
      <AppShell>
        <h1>หน้าทดสอบ</h1>
      </AppShell>,
    );
    const main = screen.getByRole("main");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(within(main).getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
  });

  it("puts the skip link first and points it at main", () => {
    render(<AppShell>x</AppShell>);
    const skip = screen.getByRole("link", { name: th.shell.skipToContent });
    expect(skip.getAttribute("href")).toBe(`#${screen.getByRole("main").id}`);
    expect(document.body.querySelector("a")).toBe(skip);
  });

  it("shows the marketplace name from th.site.name in header and footer", () => {
    render(<AppShell>x</AppShell>);
    const header = screen.getByRole("banner");
    const footer = screen.getByRole("contentinfo");
    expect(within(header).getByRole("link", { name: th.site.name }).getAttribute("href")).toBe("/");
    expect(within(footer).getAllByText(new RegExp(th.site.name)).length).toBeGreaterThan(0);
  });

  it("has a labelled GET search form that submits the q parameter", () => {
    render(<AppShell>x</AppShell>);
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe(ROUTES.search);
    expect(form.getAttribute("method")).toBe("get");
    const input = within(form).getByLabelText(th.shell.header.search.label);
    expect(input.getAttribute("name")).toBe("q");
    expect(within(form).getByRole("button", { name: th.shell.header.search.submit })).toBeTruthy();
  });

  it("links to sign-in, open-store, and cart", () => {
    render(<AppShell>x</AppShell>);
    const nav = screen.getByRole("navigation", { name: th.shell.header.navLabel });
    expect(
      within(nav).getByRole("link", { name: th.shell.header.signIn }).getAttribute("href"),
    ).toBe(ROUTES.signIn);
    expect(
      within(nav).getByRole("link", { name: th.shell.header.openStore }).getAttribute("href"),
    ).toBe(ROUTES.openStore);
    expect(
      within(nav).getByRole("link", { name: th.shell.header.cart.label }).getAttribute("href"),
    ).toBe(ROUTES.cart);
  });

  it("makes main focusable so the skip link moves focus", () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
  });

  it("caps the search input at the length the API accepts", () => {
    render(<AppShell>x</AppShell>);
    const input = screen.getByLabelText(th.shell.header.search.label);
    expect(input.getAttribute("maxlength")).toBe(String(MAX_SEARCH_TEXT_LENGTH));
    expect(MAX_SEARCH_TEXT_LENGTH).toBe(100);
  });

  it("keeps the header DOM order brand, navigation, search (the order on a narrow screen)", () => {
    render(<AppShell>x</AppShell>);
    const header = screen.getByRole("banner");
    const brand = within(header).getByRole("link", { name: th.site.name });
    const nav = within(header).getByRole("navigation");
    const search = within(header).getByRole("search");
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(brand, nav)).toBe(true);
    expect(follows(nav, search)).toBe(true);
  });

  it("gives the brand link a 44 px target", () => {
    render(<AppShell>x</AppShell>);
    const brand = within(screen.getByRole("banner")).getByRole("link", { name: th.site.name });
    expect(brand.className).toContain("min-h-11");
  });

  it("labels mock payment and simulated shipping in the footer", () => {
    render(<AppShell>x</AppShell>);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(th.notice.mockPayment)).toBeTruthy();
    expect(within(footer).getByText(th.notice.simulatedShipping)).toBeTruthy();
  });
});

describe("CartLink", () => {
  it("hides the badge and uses the plain name when the cart is empty", () => {
    render(<CartLink count={0} />);
    const link = screen.getByRole("link", { name: th.shell.header.cart.label });
    expect(link.textContent).toBe("");
  });

  it("puts the count in the accessible name and shows the badge", () => {
    render(<CartLink count={3} />);
    const link = screen.getByRole("link", { name: "ตะกร้าสินค้า 3 รายการ" });
    expect(link.textContent).toBe("3");
  });

  it("treats an invalid count as an empty cart", () => {
    render(<CartLink count={Number.NaN} />);
    expect(screen.getByRole("link", { name: th.shell.header.cart.label }).textContent).toBe("");
  });
});
