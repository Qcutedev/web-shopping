import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const updateProfile = vi.fn();
vi.mock("@/lib/api-client/me", () => ({
  updateProfile: (...args: unknown[]) => updateProfile(...args),
}));

import { ProfileCard } from "./profile-card";

const profile = { name: "สมชาย", email: "somchai@example.com", phone: null };

beforeEach(() => {
  refresh.mockReset();
  updateProfile.mockReset();
});

describe("ProfileCard", () => {
  it("shows the profile with the name isolated in bdi, the email as text, and a placeholder phone", () => {
    const { container } = render(<ProfileCard profile={profile} />);
    expect(container.querySelector("bdi")?.textContent).toBe("สมชาย");
    expect(screen.getByText(/somchai@example.com/)).toBeTruthy();
    expect(screen.getByText(th.account.common.notProvided)).toBeTruthy();
    expect(container.querySelector('input[name="email"]')).toBeNull();
  });

  it("saves name and phone, shows the server's values and a success message", async () => {
    const user = userEvent.setup();
    updateProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...profile, name: "สมหญิง", phone: "0812345678", id: "u", role: "CUSTOMER" },
    });
    render(<ProfileCard profile={profile} />);
    await user.click(screen.getByRole("button", { name: th.account.profile.edit }));
    const name = screen.getByLabelText(th.account.profile.name);
    await user.clear(name);
    await user.type(name, "สมหญิง");
    await user.type(screen.getByLabelText(th.account.profile.phone), "081-234-5678");
    await user.click(screen.getByRole("button", { name: th.account.common.save }));

    expect(updateProfile).toHaveBeenCalledWith({ name: "สมหญิง", phone: "0812345678" });
    expect(await screen.findByText(th.account.profile.saved)).toBeTruthy();
    expect(screen.getByText("0812345678")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("does not call the server for an invalid phone and shows the field message", async () => {
    const user = userEvent.setup();
    render(<ProfileCard profile={profile} />);
    await user.click(screen.getByRole("button", { name: th.account.profile.edit }));
    await user.type(screen.getByLabelText(th.account.profile.phone), "12345");
    await user.click(screen.getByRole("button", { name: th.account.common.save }));
    expect(updateProfile).not.toHaveBeenCalled();
    expect(screen.getByText(th.account.fieldErrors.phone.invalid)).toBeTruthy();
  });

  it("disables the submit control while the request is pending and sends it once", async () => {
    const user = userEvent.setup();
    let resolve: (value: unknown) => void = () => {};
    updateProfile.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<ProfileCard profile={profile} />);
    await user.click(screen.getByRole("button", { name: th.account.profile.edit }));
    const save = screen.getByRole("button", { name: th.account.common.save });
    await user.click(save);
    await waitFor(() => expect(save.getAttribute("aria-disabled")).toBe("true"));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await user.click(save);
    expect(updateProfile).toHaveBeenCalledTimes(1);
    resolve({ ok: false, status: 500, code: "INTERNAL_ERROR", fields: [], requestId: null });
    expect(await screen.findByText(th.errors.unknown)).toBeTruthy();
    const again = screen.getByRole("button", { name: th.account.common.save });
    expect((again as HTMLButtonElement).disabled).toBe(false);
  });

  it("maps a server validation error to the field, and a lost session to a sign-in link", async () => {
    const user = userEvent.setup();
    updateProfile.mockResolvedValueOnce({
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      fields: [{ path: "name", code: "invalid_format" }],
      requestId: "r",
    });
    render(<ProfileCard profile={profile} />);
    await user.click(screen.getByRole("button", { name: th.account.profile.edit }));
    await user.click(screen.getByRole("button", { name: th.account.common.save }));
    expect(await screen.findByText(th.account.fieldErrors.name.invalid)).toBeTruthy();

    updateProfile.mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      fields: [],
      requestId: null,
    });
    await user.click(screen.getByRole("button", { name: th.account.common.save }));
    expect(await screen.findByText(th.errors.unauthenticated)).toBeTruthy();
    const link = screen.getByRole("link", { name: th.shell.header.signIn });
    expect(link.getAttribute("href")).toBe("/sign-in?next=%2Faccount");
  });
});

describe("ProfileCard clipping (SEC-042 display part)", () => {
  it("clips a name with 1,000 combining marks in its own box and its cell", () => {
    const stacked = "ก" + "́".repeat(1000);
    const { container } = render(<ProfileCard profile={{ ...profile, name: stacked }} />);
    const bdi = container.querySelector("dd > bdi");
    expect(bdi?.textContent).toBe(stacked);
    expect(bdi?.parentElement?.classList.contains("overflow-hidden")).toBe(true);
    expect(bdi?.parentElement?.classList.contains("max-w-full")).toBe(true);
  });
});
