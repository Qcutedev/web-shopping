import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const signOut = vi.fn();
vi.mock("@/lib/api-client/auth", () => ({ signOut: (...args: unknown[]) => signOut(...args) }));

import { AccountMenu } from "./account-menu";

const copy = th.shell.header.account;
const NAME = "สมชาย";

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  signOut.mockReset();
});

async function openMenu() {
  const user = userEvent.setup();
  render(<AccountMenu name={NAME} />);
  await user.click(screen.getByRole("button", { name: fill(copy.buttonLabel, { name: NAME }) }));
  return user;
}

describe("AccountMenu", () => {
  it("starts closed, shows the name, and opens on click", async () => {
    const user = userEvent.setup();
    render(<AccountMenu name={NAME} />);
    const button = screen.getByRole("button", { name: fill(copy.buttonLabel, { name: NAME }) });
    expect(button.textContent).toBe(NAME);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: copy.profile })).toBeNull();
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: copy.profile }).getAttribute("href")).toBe(
      ROUTES.account,
    );
    expect(screen.getByRole("link", { name: copy.orders }).getAttribute("href")).toBe(
      ROUTES.orders,
    );
  });

  it("offers no admin or seller link", async () => {
    await openMenu();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href.startsWith("/admin") || href.startsWith("/seller"))).toBe(
      false,
    );
  });

  it("uses the fallback name when the profile could not be read", () => {
    render(<AccountMenu name={null} />);
    expect(screen.getByRole("button", { name: copy.fallbackName }).textContent).toBe(
      copy.fallbackName,
    );
  });

  it("closes on Escape and on a click outside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AccountMenu name={NAME} />
        <p>outside</p>
      </>,
    );
    const button = screen.getByRole("button", { name: /สมชาย/ });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.click(button);
    await user.click(screen.getByText("outside"));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("signs out, goes home, and refreshes the server data", async () => {
    signOut.mockResolvedValue({ ok: true, status: 200, data: { signedOut: true } });
    const user = await openMenu();
    await user.click(screen.getByRole("button", { name: copy.signOut }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(ROUTES.home);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("treats a 401 as already signed out", async () => {
    signOut.mockResolvedValue({
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      fields: [],
      requestId: null,
    });
    const user = await openMenu();
    await user.click(screen.getByRole("button", { name: copy.signOut }));
    expect(replace).toHaveBeenCalledWith(ROUTES.home);
  });

  it("disables sign-out while pending and sends one request", async () => {
    let finish: (value: unknown) => void = () => undefined;
    signOut.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = await openMenu();
    await user.click(screen.getByRole("button", { name: copy.signOut }));
    const pending = screen.getByRole("button", { name: copy.signingOut }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    await user.click(pending);
    expect(signOut).toHaveBeenCalledTimes(1);
    finish({ ok: true, status: 200, data: { signedOut: true } });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("shows Thai copy and allows a retry when sign-out fails", async () => {
    signOut.mockResolvedValue({
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      fields: [],
      requestId: null,
    });
    const user = await openMenu();
    await user.click(screen.getByRole("button", { name: copy.signOut }));
    expect((await screen.findByRole("alert")).textContent).toBe(copy.signOutFailed);
    expect(replace).not.toHaveBeenCalled();
    const retry = screen.getByRole("button", { name: copy.signOut }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
  });

  it("returns focus to the button on Escape", async () => {
    const user = await openMenu();
    const button = screen.getByRole("button", { name: fill(copy.buttonLabel, { name: NAME }) });
    await user.click(screen.getByRole("link", { name: copy.profile }));
    await user.click(button);
    (screen.getByRole("link", { name: copy.orders }) as HTMLElement).focus();
    await user.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("clears the sign-out error when the menu closes", async () => {
    signOut.mockResolvedValue({
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      fields: [],
      requestId: null,
    });
    const user = await openMenu();
    await user.click(screen.getByRole("button", { name: copy.signOut }));
    await screen.findByRole("alert");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: fill(copy.buttonLabel, { name: NAME }) }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
