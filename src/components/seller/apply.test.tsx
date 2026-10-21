import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { notFound, unauthenticated } from "@/server/errors";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super("redirect");
  }
}

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const getActor = vi.fn();
vi.mock("@/server/auth/session", () => ({ getActor: (...args: unknown[]) => getActor(...args) }));

const getOwnApplication = vi.fn();
const getOwnStore = vi.fn();
vi.mock("@/modules/sellers", () => ({
  getOwnApplication: (...args: unknown[]) => getOwnApplication(...args),
  getOwnStore: (...args: unknown[]) => getOwnStore(...args),
}));

const submitApplication = vi.fn();
vi.mock("@/lib/api-client/seller", () => ({
  submitApplication: (...args: unknown[]) => submitApplication(...args),
}));

import { ApplySection } from "./apply-section";
import { ApplyView } from "./apply-view";
import { renderForSeller } from "./with-seller";

const customer = { userId: "u1", role: "CUSTOMER", storeId: null, storeStatus: null };
const seller = { userId: "u2", role: "SELLER", storeId: "s1", storeStatus: "APPROVED" };
const admin = { userId: "u3", role: "ADMIN", storeId: null, storeStatus: null };

const application = {
  id: "a1",
  storeName: "ร้านทดสอบ",
  description: "ขายของ",
  contactPhone: "0812345678",
  status: "PENDING" as const,
  reviewNote: null,
  reviewedAt: null,
  createdAt: "2026-10-20T03:00:00.000Z",
};

beforeEach(() => {
  getActor.mockReset();
  getOwnApplication.mockReset();
  getOwnStore.mockReset();
  submitApplication.mockReset();
  refresh.mockReset();
});

describe("renderForSeller", () => {
  it("redirects a visitor without a session to sign-in, returning to the page", async () => {
    getActor.mockResolvedValue(null);
    const render_ = vi.fn();
    await expect(renderForSeller("/seller/products", render_)).rejects.toMatchObject({
      url: "/sign-in?next=%2Fseller%2Fproducts",
    });
    expect(render_).not.toHaveBeenCalled();
  });

  it("shows the way to apply to a customer and never calls the section", async () => {
    getActor.mockResolvedValue(customer);
    const render_ = vi.fn();
    render(await renderForSeller("/seller", render_));
    expect(render_).not.toHaveBeenCalled();
    expect(screen.getByText(th.seller.guard.customerTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.seller.guard.customerAction }).getAttribute("href"),
    ).toBe("/seller/apply");
  });

  it("refuses an admin", async () => {
    getActor.mockResolvedValue(admin);
    const render_ = vi.fn();
    render(await renderForSeller("/seller", render_));
    expect(render_).not.toHaveBeenCalled();
    expect(screen.getByText(th.seller.guard.forbiddenTitle)).toBeTruthy();
  });

  it("calls the section with the session's actor for a seller", async () => {
    getActor.mockResolvedValue(seller);
    const render_ = vi.fn().mockResolvedValue(<p>content</p>);
    render(await renderForSeller("/seller", render_));
    expect(render_).toHaveBeenCalledWith(seller);
    expect(screen.getByText("content")).toBeTruthy();
    expect(screen.queryByText(th.seller.suspended.title)).toBeNull();
  });

  it("shows the suspension notice with the reason above the content", async () => {
    getActor.mockResolvedValue({ ...seller, storeStatus: "SUSPENDED" });
    getOwnStore.mockResolvedValue({ statusReason: "ละเมิดนโยบาย" });
    render(await renderForSeller("/seller", async () => <p>content</p>));
    expect(screen.getByText(th.seller.suspended.title)).toBeTruthy();
    expect(screen.getByText("ละเมิดนโยบาย")).toBeTruthy();
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("shows the notice without a reason when the store read fails", async () => {
    getActor.mockResolvedValue({ ...seller, storeStatus: "SUSPENDED" });
    getOwnStore.mockRejectedValue(new Error("db down"));
    render(await renderForSeller("/seller", async () => <p>content</p>));
    expect(screen.getByText(th.seller.suspended.title)).toBeTruthy();
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("shows the error state with a retry link when the section fails", async () => {
    getActor.mockResolvedValue(seller);
    render(
      await renderForSeller("/seller/orders", async () => {
        throw new Error("db down");
      }),
    );
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/seller/orders",
    );
  });

  it("shows the not-found content on a 404 when the page gives one", async () => {
    getActor.mockResolvedValue(seller);
    render(
      await renderForSeller(
        "/seller/orders/x",
        async () => {
          throw notFound();
        },
        { notFound: <p>gone</p> },
      ),
    );
    expect(screen.getByText("gone")).toBeTruthy();
  });

  it("redirects when a service reports the user as no longer signed in", async () => {
    getActor.mockResolvedValue(seller);
    await expect(
      renderForSeller("/seller", async () => {
        throw unauthenticated();
      }),
    ).rejects.toMatchObject({ url: "/sign-in?next=%2Fseller" });
  });

  it("shows the error state when the session cannot be read", async () => {
    getActor.mockRejectedValue(new Error("db down"));
    render(await renderForSeller("/seller", async () => <p>content</p>));
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
  });
});

describe("ApplySection", () => {
  it("shows the form to a customer who never applied", async () => {
    getActor.mockResolvedValue(customer);
    getOwnApplication.mockRejectedValue(notFound());
    render(await ApplySection());
    expect(getOwnApplication).toHaveBeenCalledWith(customer);
    expect(screen.getByLabelText(new RegExp(th.seller.apply.fields.storeName))).toBeTruthy();
  });

  it("sends a seller to the dashboard", async () => {
    getActor.mockResolvedValue(seller);
    await expect(ApplySection()).rejects.toMatchObject({ url: "/seller" });
  });

  it("shows the error state when the application cannot be read", async () => {
    getActor.mockResolvedValue(customer);
    getOwnApplication.mockRejectedValue(new Error("db down"));
    render(await ApplySection());
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
  });
});

describe("ApplyView", () => {
  it("shows a pending application without a form", () => {
    render(<ApplyView application={application} />);
    expect(screen.getByText(th.seller.status.application.PENDING)).toBeTruthy();
    expect(screen.getByText(th.seller.apply.pendingNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: th.seller.apply.submit })).toBeNull();
  });

  it("shows the rejection reason and the form again after a rejection", () => {
    render(
      <ApplyView
        application={{
          ...application,
          status: "REJECTED",
          reviewNote: "ชื่อซ้ำ",
          reviewedAt: "2026-10-21T03:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("ชื่อซ้ำ")).toBeTruthy();
    expect(screen.getByRole("button", { name: th.seller.apply.submit })).toBeTruthy();
  });
});

describe("ApplicationForm", () => {
  it("shows Thai messages under empty fields and sends nothing", async () => {
    const user = userEvent.setup();
    render(<ApplyView application={null} />);
    await user.click(screen.getByRole("button", { name: th.seller.apply.submit }));
    expect(screen.getByText(th.seller.fieldErrors.storeName.required)).toBeTruthy();
    expect(screen.getByText(th.seller.fieldErrors.description.required)).toBeTruthy();
    expect(submitApplication).not.toHaveBeenCalled();
  });

  it("submits once, disables the button while pending, and refreshes on success", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    submitApplication.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ApplyView application={null} />);
    await user.type(
      screen.getByLabelText(new RegExp(th.seller.apply.fields.storeName)),
      "ร้านทดสอบ",
    );
    await user.type(
      screen.getByLabelText(new RegExp(th.seller.apply.fields.description)),
      "ขายของ",
    );
    await user.type(
      screen.getByLabelText(new RegExp(th.seller.apply.fields.contactPhone)),
      "0812345678",
    );
    const button = screen.getByRole("button", { name: th.seller.apply.submit });
    await user.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(submitApplication).toHaveBeenCalledTimes(1);
    expect(submitApplication).toHaveBeenCalledWith({
      storeName: "ร้านทดสอบ",
      description: "ขายของ",
      contactPhone: "0812345678",
    });
    finish({ ok: true, status: 201, data: application });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("maps a store-name conflict to Thai copy", async () => {
    const user = userEvent.setup();
    submitApplication.mockResolvedValue({
      ok: false,
      status: 409,
      code: "CONFLICT",
      reason: "STORE_NAME_TAKEN",
      fields: [],
      requestId: null,
    });
    render(<ApplyView application={null} />);
    await user.type(
      screen.getByLabelText(new RegExp(th.seller.apply.fields.storeName)),
      "ร้านทดสอบ",
    );
    await user.type(
      screen.getByLabelText(new RegExp(th.seller.apply.fields.description)),
      "ขายของ",
    );
    await user.type(
      screen.getByLabelText(new RegExp(th.seller.apply.fields.contactPhone)),
      "0812345678",
    );
    await user.click(screen.getByRole("button", { name: th.seller.apply.submit }));
    expect(await screen.findByText(th.seller.errors.reasons.STORE_NAME_TAKEN)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: th.seller.apply.submit }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
