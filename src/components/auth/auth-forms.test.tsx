import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
const signIn = vi.fn();
const signUp = vi.fn();
const readSession = vi.fn();
vi.mock("@/lib/api-client/auth", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signUp: (...args: unknown[]) => signUp(...args),
  readSession: (...args: unknown[]) => readSession(...args),
}));

import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

function fail(status: number, code: string, fields: { path: string; code: string }[] = []) {
  return { ok: false, status, code, fields, requestId: null };
}

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  signIn.mockReset();
  signUp.mockReset();
  readSession.mockReset();
});

describe("SignInForm", () => {
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(th.auth.email), "a@example.com");
    await user.type(screen.getByLabelText(th.auth.password), "secret");
    await user.click(screen.getByRole("button", { name: th.auth.signInSubmit }));
  }

  it("signs in, confirms, and goes to the validated next path", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ ok: true, status: 200, data: { userId: "u", role: "CUSTOMER" } });
    render(<SignInForm next="/cart" />);
    await fillAndSubmit(user);
    expect(signIn).toHaveBeenCalledWith({ email: "a@example.com", password: "secret" });
    expect(await screen.findByText(th.auth.signedIn)).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/cart");
  });

  it("shows field messages and does not call the server for empty input", async () => {
    const user = userEvent.setup();
    render(<SignInForm next="/" />);
    await user.click(screen.getByRole("button", { name: th.auth.signInSubmit }));
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByText(th.auth.fieldErrors.email.required)).toBeTruthy();
    expect(screen.getByText(th.auth.fieldErrors.password.required)).toBeTruthy();
  });

  it("shows one generic message for a refused sign-in and stays on the page", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(fail(401, "UNAUTHENTICATED"));
    render(<SignInForm next="/" />);
    await fillAndSubmit(user);
    expect(await screen.findByText(th.auth.invalidCredentials)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: th.auth.signInSubmit }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it.each([
    [429, "RATE_LIMITED", th.errors.rateLimited],
    [0, "NETWORK_ERROR", th.errors.network],
  ])("maps %s %s to Thai copy", async (status, code, text) => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(fail(status, code));
    render(<SignInForm next="/" />);
    await fillAndSubmit(user);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("disables the button while pending and sends one request", async () => {
    const user = userEvent.setup();
    signIn.mockReturnValue(new Promise(() => {}));
    render(<SignInForm next="/" />);
    await fillAndSubmit(user);
    const button = screen.getByRole("button", { name: th.auth.signInSubmit }) as HTMLButtonElement;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await user.click(button);
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});

describe("SignUpForm", () => {
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = "password1") {
    await user.type(screen.getByLabelText(th.auth.name), "สมชาย");
    await user.type(screen.getByLabelText(th.auth.email), "a@example.com");
    await user.type(screen.getByLabelText(th.auth.password), password);
    await user.click(screen.getByRole("button", { name: th.auth.signUpSubmit }));
  }

  it("signs up, checks the session, and goes to next", async () => {
    const user = userEvent.setup();
    signUp.mockResolvedValue({ ok: true, status: 200, data: { accepted: true } });
    readSession.mockResolvedValue({
      ok: true,
      status: 200,
      data: { userId: "u", role: "CUSTOMER" },
    });
    render(<SignUpForm next="/products/tea" />);
    await fillAndSubmit(user);
    expect(signUp).toHaveBeenCalledWith({
      name: "สมชาย",
      email: "a@example.com",
      password: "password1",
    });
    expect(await screen.findByText(th.auth.signedUp)).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/products/tea");
  });

  it("shows a generic message that does not name the email when no session follows", async () => {
    const user = userEvent.setup();
    signUp.mockResolvedValue({ ok: true, status: 200, data: { accepted: true } });
    readSession.mockResolvedValue({ ok: true, status: 200, data: null });
    render(<SignUpForm next="/" />);
    await fillAndSubmit(user);
    expect(await screen.findByText(th.auth.signUpNotCompleted)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("rejects a short password on the client without calling the server", async () => {
    const user = userEvent.setup();
    render(<SignUpForm next="/" />);
    await fillAndSubmit(user, "short");
    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getByText(th.auth.fieldErrors.password.tooShort)).toBeTruthy();
  });

  it("places server field errors under the fields", async () => {
    const user = userEvent.setup();
    signUp.mockResolvedValue(
      fail(400, "VALIDATION_ERROR", [{ path: "name", code: "invalid_format" }]),
    );
    render(<SignUpForm next="/" />);
    await fillAndSubmit(user);
    expect(await screen.findByText(th.auth.fieldErrors.name.invalid)).toBeTruthy();
  });

  it("maps a rate limit to Thai copy and re-enables the button", async () => {
    const user = userEvent.setup();
    signUp.mockResolvedValue(fail(429, "RATE_LIMITED"));
    render(<SignUpForm next="/" />);
    await fillAndSubmit(user);
    expect(await screen.findByText(th.errors.rateLimited)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: th.auth.signUpSubmit }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
