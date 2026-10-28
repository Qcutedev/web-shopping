import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { formatSatang } from "@/lib/format";
import { notFound } from "@/server/errors";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

const getActor = vi.fn();
vi.mock("@/server/auth/session", () => ({ getActor: (...args: unknown[]) => getActor(...args) }));

const getProduct = vi.fn();
const getOrder = vi.fn();
const getSettings = vi.fn();
vi.mock("@/modules/admin", () => ({
  getProduct: (...args: unknown[]) => getProduct(...args),
  getOrder: (...args: unknown[]) => getOrder(...args),
  getSettings: (...args: unknown[]) => getSettings(...args),
}));

const api = {
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  approveApplication: vi.fn(),
  rejectApplication: vi.fn(),
  suspendStore: vi.fn(),
  reinstateStore: vi.fn(),
  approveProduct: vi.fn(),
  rejectProduct: vi.fn(),
  takedownProduct: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  changeSellerOrderStatus: vi.fn(),
  updateSettings: vi.fn(),
  hideReview: vi.fn(),
  unhideReview: vi.fn(),
};
vi.mock("@/lib/api-client/admin", () => ({
  deactivateUser: (...args: unknown[]) => api.deactivateUser(...args),
  reactivateUser: (...args: unknown[]) => api.reactivateUser(...args),
  approveApplication: (...args: unknown[]) => api.approveApplication(...args),
  rejectApplication: (...args: unknown[]) => api.rejectApplication(...args),
  suspendStore: (...args: unknown[]) => api.suspendStore(...args),
  reinstateStore: (...args: unknown[]) => api.reinstateStore(...args),
  approveProduct: (...args: unknown[]) => api.approveProduct(...args),
  rejectProduct: (...args: unknown[]) => api.rejectProduct(...args),
  takedownProduct: (...args: unknown[]) => api.takedownProduct(...args),
  createCategory: (...args: unknown[]) => api.createCategory(...args),
  updateCategory: (...args: unknown[]) => api.updateCategory(...args),
  deleteCategory: (...args: unknown[]) => api.deleteCategory(...args),
  changeSellerOrderStatus: (...args: unknown[]) => api.changeSellerOrderStatus(...args),
  updateSettings: (...args: unknown[]) => api.updateSettings(...args),
  hideReview: (...args: unknown[]) => api.hideReview(...args),
  unhideReview: (...args: unknown[]) => api.unhideReview(...args),
}));

import { AdminAction, AdminNoticeRegion } from "./action-button";
import { CategoriesTable, CategoryCreateForm } from "./categories-panel";
import { OrderSection } from "./order-section";
import { ProductSection } from "./product-section";
import { SettingsForm } from "./settings-form";

const admin = { userId: "a1", role: "ADMIN" };

function ok<T>(data: T) {
  return { ok: true as const, status: 200, data };
}

function failure(
  code: string,
  status: number,
  reason?: string,
  fields: { path: string; code: string }[] = [],
) {
  return { ok: false as const, status, code, reason, fields, requestId: null };
}

beforeEach(() => {
  getActor.mockReset();
  getProduct.mockReset();
  getOrder.mockReset();
  getSettings.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  refresh.mockReset();
});

function renderAction(spec: Parameters<typeof AdminAction>[0]["spec"]) {
  return render(
    <>
      <AdminNoticeRegion />
      <AdminAction spec={spec} returnTo="/admin/users" />
    </>,
  );
}

describe("AdminAction without a reason", () => {
  it("asks first, then sends one request, confirms, and refreshes", async () => {
    const user = userEvent.setup();
    api.deactivateUser.mockResolvedValue(ok({ id: "u2" }));
    renderAction({ kind: "user.deactivate", id: "u2" });
    await user.click(screen.getByRole("button", { name: th.admin.users.deactivate }));
    const dialog = screen.getByRole("alertdialog", { name: th.admin.users.deactivateConfirm });
    expect(within(dialog).getByText(th.admin.users.deactivateConfirmNote)).toBeTruthy();
    expect(api.deactivateUser).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: th.admin.users.deactivateConfirmAction }),
    );
    expect(api.deactivateUser).toHaveBeenCalledWith("u2");
    expect(await screen.findByText(th.admin.users.deactivated)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("disables the controls while pending and sends once", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    api.deactivateUser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAction({ kind: "user.deactivate", id: "u2" });
    await user.click(screen.getByRole("button", { name: th.admin.users.deactivate }));
    const confirm = screen.getByRole("button", { name: th.admin.users.deactivateConfirmAction });
    await user.click(confirm);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: th.admin.common.cancel }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(confirm);
    expect(api.deactivateUser).toHaveBeenCalledTimes(1);
    finish(ok({ id: "u2" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("closes on Escape without sending and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderAction({ kind: "user.deactivate", id: "u2" });
    const trigger = screen.getByRole("button", { name: th.admin.users.deactivate });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.deactivateUser).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("explains a refusal for the last admin in Thai and does not refresh", async () => {
    const user = userEvent.setup();
    api.deactivateUser.mockResolvedValue(failure("CONFLICT", 409, "LAST_ADMIN"));
    renderAction({ kind: "user.deactivate", id: "u2" });
    await user.click(screen.getByRole("button", { name: th.admin.users.deactivate }));
    await user.click(screen.getByRole("button", { name: th.admin.users.deactivateConfirmAction }));
    expect(await screen.findByText(th.admin.errors.reasons.LAST_ADMIN)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    // The dialog stays open and the confirm button works again.
    expect(
      (
        screen.getByRole("button", {
          name: th.admin.users.deactivateConfirmAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("refreshes to the stored state when the record moved under the admin", async () => {
    const user = userEvent.setup();
    api.reactivateUser.mockResolvedValue(failure("INVALID_STATE_TRANSITION", 409));
    renderAction({ kind: "user.reactivate", id: "u2" });
    await user.click(screen.getByRole("button", { name: th.admin.users.reactivate }));
    await user.click(screen.getByRole("button", { name: th.admin.users.reactivateConfirmAction }));
    expect(await screen.findByText(th.admin.errors.invalidTransition)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the sign-in link when the session ended", async () => {
    const user = userEvent.setup();
    api.deactivateUser.mockResolvedValue(failure("UNAUTHENTICATED", 401));
    renderAction({ kind: "user.deactivate", id: "u2" });
    await user.click(screen.getByRole("button", { name: th.admin.users.deactivate }));
    await user.click(screen.getByRole("button", { name: th.admin.users.deactivateConfirmAction }));
    expect(await screen.findByText(th.errors.unauthenticated)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.shell.header.signIn }).getAttribute("href")).toBe(
      "/sign-in?next=%2Fadmin%2Fusers",
    );
  });

  it("maps a network failure to Thai copy", async () => {
    const user = userEvent.setup();
    api.approveApplication.mockResolvedValue(failure("NETWORK_ERROR", 0));
    renderAction({ kind: "application.approve", id: "ap1" });
    await user.click(screen.getByRole("button", { name: th.admin.applications.approve }));
    await user.click(
      screen.getByRole("button", { name: th.admin.applications.approveConfirmAction }),
    );
    expect(await screen.findByText(th.errors.network)).toBeTruthy();
  });

  it("names the applicant refusal of an approval", async () => {
    const user = userEvent.setup();
    api.approveApplication.mockResolvedValue(failure("CONFLICT", 409, "APPLICANT_INACTIVE"));
    renderAction({ kind: "application.approve", id: "ap1" });
    await user.click(screen.getByRole("button", { name: th.admin.applications.approve }));
    await user.click(
      screen.getByRole("button", { name: th.admin.applications.approveConfirmAction }),
    );
    expect(await screen.findByText(th.admin.errors.reasons.APPLICANT_INACTIVE)).toBeTruthy();
  });
});

describe("AdminAction with a reason", () => {
  it("does not send a blank reason and puts the message on the field", async () => {
    const user = userEvent.setup();
    renderAction({ kind: "application.reject", id: "ap1" });
    await user.click(screen.getByRole("button", { name: th.admin.applications.reject }));
    await user.click(
      screen.getByRole("button", { name: th.admin.applications.rejectConfirmAction }),
    );
    const field = screen.getByLabelText(th.admin.common.reasonLabel);
    expect(screen.getByText(th.admin.common.reasonErrors.required)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(api.rejectApplication).not.toHaveBeenCalled();
  });

  it("does not send a reason over 500 characters", async () => {
    const user = userEvent.setup();
    renderAction({ kind: "store.suspend", id: "s1" });
    await user.click(screen.getByRole("button", { name: th.admin.stores.suspend }));
    await user.click(screen.getByLabelText(th.admin.common.reasonLabel));
    await user.paste("ก".repeat(501));
    await user.click(screen.getByRole("button", { name: th.admin.stores.suspendConfirmAction }));
    expect(screen.getByText(th.admin.common.reasonErrors.tooLong)).toBeTruthy();
    expect(api.suspendStore).not.toHaveBeenCalled();
  });

  it("sends the reason, then confirms", async () => {
    const user = userEvent.setup();
    api.rejectApplication.mockResolvedValue(ok({ application: {}, store: null }));
    renderAction({ kind: "application.reject", id: "ap1" });
    await user.click(screen.getByRole("button", { name: th.admin.applications.reject }));
    await user.type(screen.getByLabelText(th.admin.common.reasonLabel), "ข้อมูลไม่ครบ");
    await user.click(
      screen.getByRole("button", { name: th.admin.applications.rejectConfirmAction }),
    );
    expect(api.rejectApplication).toHaveBeenCalledWith("ap1", { reason: "ข้อมูลไม่ครบ" });
    expect(await screen.findByText(th.admin.applications.rejected)).toBeTruthy();
  });

  it("puts a server refusal of the reason on the field", async () => {
    const user = userEvent.setup();
    api.suspendStore.mockResolvedValue(
      failure("VALIDATION_ERROR", 400, undefined, [{ path: "reason", code: "invalid_format" }]),
    );
    renderAction({ kind: "store.suspend", id: "s1" });
    await user.click(screen.getByRole("button", { name: th.admin.stores.suspend }));
    await user.type(screen.getByLabelText(th.admin.common.reasonLabel), "x");
    await user.click(screen.getByRole("button", { name: th.admin.stores.suspendConfirmAction }));
    expect(await screen.findByText(th.admin.common.reasonErrors.invalid)).toBeTruthy();
  });

  it("starts the dialog with focus in the reason field", async () => {
    const user = userEvent.setup();
    renderAction({ kind: "store.reinstate", id: "s1" });
    await user.click(screen.getByRole("button", { name: th.admin.stores.reinstate }));
    expect(document.activeElement).toBe(screen.getByLabelText(th.admin.common.reasonLabel));
  });
});

describe("AdminAction on a review (optional reason)", () => {
  const hideButton = () => screen.getByRole("button", { name: th.admin.reviews.hide });
  const hideConfirm = () =>
    screen.getByRole("button", { name: th.admin.reviews.hideConfirmAction });

  it("hides with no reason: sends an empty body, confirms, refreshes", async () => {
    const user = userEvent.setup();
    api.hideReview.mockResolvedValue(ok({ id: "r1" }));
    renderAction({ kind: "review.hide", id: "r1" });
    await user.click(hideButton());
    await user.click(hideConfirm());
    expect(api.hideReview).toHaveBeenCalledWith("r1", {});
    expect(await screen.findByText(th.admin.reviews.hiddenDone)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("sends a typed reason", async () => {
    const user = userEvent.setup();
    api.hideReview.mockResolvedValue(ok({ id: "r1" }));
    renderAction({ kind: "review.hide", id: "r1" });
    await user.click(hideButton());
    await user.type(screen.getByLabelText(th.admin.common.reasonLabel), "ถ้อยคำไม่เหมาะสม");
    await user.click(hideConfirm());
    expect(api.hideReview).toHaveBeenCalledWith("r1", { reason: "ถ้อยคำไม่เหมาะสม" });
  });

  it("does not send a reason over 500 characters", async () => {
    const user = userEvent.setup();
    renderAction({ kind: "review.hide", id: "r1" });
    await user.click(hideButton());
    await user.click(screen.getByLabelText(th.admin.common.reasonLabel));
    await user.paste("ก".repeat(501));
    await user.click(hideConfirm());
    expect(screen.getByText(th.admin.common.reasonErrors.tooLong)).toBeTruthy();
    expect(api.hideReview).not.toHaveBeenCalled();
  });

  it("unhides with no reason", async () => {
    const user = userEvent.setup();
    api.unhideReview.mockResolvedValue(ok({ id: "r1" }));
    renderAction({ kind: "review.unhide", id: "r1" });
    await user.click(screen.getByRole("button", { name: th.admin.reviews.unhide }));
    await user.click(screen.getByRole("button", { name: th.admin.reviews.unhideConfirmAction }));
    expect(api.unhideReview).toHaveBeenCalledWith("r1", {});
    expect(await screen.findByText(th.admin.reviews.unhiddenDone)).toBeTruthy();
  });

  it("maps 409 to Thai copy and refreshes to the stored state", async () => {
    const user = userEvent.setup();
    api.hideReview.mockResolvedValue(failure("INVALID_STATE_TRANSITION", 409));
    renderAction({ kind: "review.hide", id: "r1" });
    await user.click(hideButton());
    await user.click(hideConfirm());
    expect(await screen.findByText(th.admin.errors.invalidTransition)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("maps 404 to Thai copy and refreshes", async () => {
    const user = userEvent.setup();
    api.hideReview.mockResolvedValue(failure("NOT_FOUND", 404));
    renderAction({ kind: "review.hide", id: "r1" });
    await user.click(hideButton());
    await user.click(hideConfirm());
    expect(await screen.findByText(th.errors.notFound)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("maps 403 to Thai copy", async () => {
    const user = userEvent.setup();
    api.hideReview.mockResolvedValue(failure("FORBIDDEN", 403));
    renderAction({ kind: "review.hide", id: "r1" });
    await user.click(hideButton());
    await user.click(hideConfirm());
    expect(await screen.findByText(th.errors.forbidden)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("product review page", () => {
  const product = {
    id: "p1",
    slug: "shirt",
    title: "เสื้อยืด",
    description: "นุ่ม\nใส่สบาย",
    sku: "SKU-1",
    category: { id: "c1", name: "เสื้อผ้า", isActive: true },
    priceSatang: 25_900,
    stock: 4,
    lowStock: true,
    soldOut: false,
    status: "PUBLISHED" as const,
    moderationStatus: "PENDING" as const,
    moderationNote: null,
    images: [],
    isSample: false,
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
    contentRevision: 7,
    moderationRequestedAt: "2026-10-11T12:00:00.000Z",
    store: { id: "s1", name: "ร้านสมชาย", slug: "ran-somchai", status: "APPROVED" as const },
  };

  it("shows the product and sends the revision it showed with an approval", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(admin);
    getProduct.mockResolvedValue(product);
    api.approveProduct.mockResolvedValue(ok(product));
    render(await ProductSection({ params: Promise.resolve({ id: "p1" }) }));
    expect(getProduct).toHaveBeenCalledWith(admin, "p1");
    expect(screen.getByText(formatSatang(25_900))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: th.admin.products.approve }));
    await user.click(screen.getByRole("button", { name: th.admin.products.approveConfirmAction }));
    expect(api.approveProduct).toHaveBeenCalledWith("p1", { contentRevision: 7 });
  });

  it("sends the same revision with a rejection and its reason", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(admin);
    getProduct.mockResolvedValue(product);
    api.rejectProduct.mockResolvedValue(ok(product));
    render(await ProductSection({ params: Promise.resolve({ id: "p1" }) }));
    await user.click(screen.getByRole("button", { name: th.admin.products.reject }));
    await user.type(screen.getByLabelText(th.admin.common.reasonLabel), "รูปไม่ตรงปก");
    await user.click(screen.getByRole("button", { name: th.admin.products.rejectConfirmAction }));
    expect(api.rejectProduct).toHaveBeenCalledWith("p1", {
      contentRevision: 7,
      reason: "รูปไม่ตรงปก",
    });
  });

  it("explains a stale revision in Thai and refreshes to the new content", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(admin);
    getProduct.mockResolvedValue(product);
    api.approveProduct.mockResolvedValue(failure("CONFLICT", 409, "STALE_REVISION"));
    render(await ProductSection({ params: Promise.resolve({ id: "p1" }) }));
    await user.click(screen.getByRole("button", { name: th.admin.products.approve }));
    await user.click(screen.getByRole("button", { name: th.admin.products.approveConfirmAction }));
    expect(await screen.findByText(th.admin.errors.reasons.STALE_REVISION)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("offers takedown, not approval, for an approved product", async () => {
    getActor.mockResolvedValue(admin);
    getProduct.mockResolvedValue({ ...product, moderationStatus: "APPROVED" as const });
    render(await ProductSection({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getByRole("button", { name: th.admin.products.takedown })).toBeTruthy();
    expect(screen.queryByRole("button", { name: th.admin.products.approve })).toBeNull();
  });

  it("explains that an unpublished product waiting for approval cannot be decided yet", async () => {
    getActor.mockResolvedValue(admin);
    getProduct.mockResolvedValue({ ...product, status: "DRAFT" as const });
    render(await ProductSection({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getByText(th.admin.products.notInQueueNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: th.admin.products.approve })).toBeNull();
  });

  it("shows the reason of an earlier decision and offers no decision on a rejected product", async () => {
    getActor.mockResolvedValue(admin);
    getProduct.mockResolvedValue({
      ...product,
      moderationStatus: "REJECTED" as const,
      moderationNote: "รูปไม่ตรงปก",
    });
    render(await ProductSection({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getByText(/รูปไม่ตรงปก/)).toBeTruthy();
    expect(screen.getByText(th.admin.products.noDecision)).toBeTruthy();
  });

  it("shows one not-found message for an unknown id and for one that cannot be an id", async () => {
    getActor.mockResolvedValue(admin);
    getProduct.mockRejectedValue(notFound());
    const { unmount } = render(await ProductSection({ params: Promise.resolve({ id: "nope" }) }));
    expect(screen.getByText(th.admin.guard.notFoundTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.admin.products.backToList }).getAttribute("href"),
    ).toBe("/admin/products");
    unmount();
    getProduct.mockClear();
    render(await ProductSection({ params: Promise.resolve({ id: "x".repeat(201) }) }));
    expect(screen.getByText(th.admin.guard.notFoundTitle)).toBeTruthy();
    expect(getProduct).not.toHaveBeenCalled();
  });

  it("renders the seller's text as text", async () => {
    getActor.mockResolvedValue(admin);
    getProduct.mockResolvedValue({ ...product, description: "<script>alert(1)</script>" });
    const { container } = render(await ProductSection({ params: Promise.resolve({ id: "p1" }) }));
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  });
});

describe("order detail page", () => {
  const sellerOrder = {
    id: "so1",
    storeId: "s1",
    commissionRateBps: 500,
    storeName: "ร้านสมชาย",
    storeSlug: "ran-somchai",
    fulfilmentStatus: "PENDING" as const,
    cancellationKind: null,
    itemsSubtotalSatang: 77_700,
    shippingFeeSatang: 4_000,
    shippingFeeIsSimulated: true,
    shipment: null,
    items: [
      {
        id: "i1",
        productId: "p1",
        productTitle: "เสื้อยืด",
        productSku: "SKU-1",
        image: null,
        unitPriceSatang: 25_900,
        quantity: 3,
        lineTotalSatang: 77_700,
        review: null,
      },
    ],
  };
  const order = {
    id: "o1",
    orderNumber: "OD2610110000042",
    createdAt: "2026-10-11T10:00:00.000Z",
    paidAt: "2026-10-11T10:05:00.000Z",
    paymentStatus: "PAID" as const,
    payment: { provider: "MOCK", isSimulated: true, failureReason: null },
    itemsSubtotalSatang: 77_700,
    shippingTotalSatang: 4_000,
    grandTotalSatang: 81_700,
    shippingAddress: {
      recipientName: "สมชาย ใจดี",
      phone: "0812345678",
      line1: "99/1 ถนนสุขุมวิท",
      subdistrict: "คลองเตย",
      district: "คลองเตย",
      province: "กรุงเทพมหานคร",
      postalCode: "10110",
    },
    sellerOrders: [sellerOrder],
    cartReturn: null,
    userId: "u1",
  };

  it("shows the paid time of a paid order, the stored amounts, and the server total", async () => {
    getActor.mockResolvedValue(admin);
    getOrder.mockResolvedValue(order);
    render(await OrderSection({ params: Promise.resolve({ id: "o1" }) }));
    expect(getOrder).toHaveBeenCalledWith(admin, "o1");
    expect(screen.getByText(th.admin.orders.paidAt)).toBeTruthy();
    expect(screen.getAllByText(th.notice.mockPayment).length).toBeGreaterThan(0);
    expect(screen.getAllByText(th.notice.simulatedShipping).length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatSatang(81_700)).length).toBeGreaterThan(0);
    expect(screen.getByText("5%")).toBeTruthy();
  });

  it("shows no paid time and no placeholder for an order that is not paid (BR-39)", async () => {
    getActor.mockResolvedValue(admin);
    getOrder.mockResolvedValue({ ...order, paymentStatus: "PENDING" as const, paidAt: null });
    render(await OrderSection({ params: Promise.resolve({ id: "o1" }) }));
    expect(screen.queryByText(th.admin.orders.paidAt)).toBeNull();
  });

  it("offers cancel for a pending part and sends the move after the confirmation", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(admin);
    getOrder.mockResolvedValue(order);
    api.changeSellerOrderStatus.mockResolvedValue(ok(order));
    render(
      <>
        <AdminNoticeRegion />
        {await OrderSection({ params: Promise.resolve({ id: "o1" }) })}
      </>,
    );
    expect(screen.queryByRole("button", { name: th.admin.orders.actions.deliver })).toBeNull();
    await user.click(screen.getByRole("button", { name: th.admin.orders.actions.cancel }));
    const dialog = screen.getByRole("alertdialog", {
      name: th.admin.orders.actions.cancelConfirm,
    });
    expect(within(dialog).getByText(/คืนเงินนอกระบบ/)).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: th.admin.orders.actions.cancelConfirmAction }),
    );
    expect(api.changeSellerOrderStatus).toHaveBeenCalledWith("so1", { to: "CANCELLED" });
    expect(await screen.findByText(th.admin.orders.actions.cancelled)).toBeTruthy();
  });

  it("offers delivery, not cancellation, for a shipped part (BR-29)", async () => {
    getActor.mockResolvedValue(admin);
    getOrder.mockResolvedValue({
      ...order,
      sellerOrders: [
        {
          ...sellerOrder,
          fulfilmentStatus: "SHIPPED" as const,
          shipment: {
            carrierName: "ขนส่งทดสอบ",
            trackingNumber: "TH123",
            isSimulated: true,
            shippedAt: "2026-10-12T04:00:00.000Z",
            deliveredAt: null,
          },
        },
      ],
    });
    render(await OrderSection({ params: Promise.resolve({ id: "o1" }) }));
    expect(screen.getByRole("button", { name: th.admin.orders.actions.deliver })).toBeTruthy();
    expect(screen.queryByRole("button", { name: th.admin.orders.actions.cancel })).toBeNull();
    expect(screen.getByText(th.admin.orders.actions.shippedLocked)).toBeTruthy();
    expect(screen.getByText("TH123")).toBeTruthy();
  });

  it("offers nothing for a delivered or cancelled part", async () => {
    getActor.mockResolvedValue(admin);
    getOrder.mockResolvedValue({
      ...order,
      sellerOrders: [{ ...sellerOrder, fulfilmentStatus: "DELIVERED" as const }],
    });
    render(await OrderSection({ params: Promise.resolve({ id: "o1" }) }));
    expect(screen.getByText(th.admin.orders.actions.none)).toBeTruthy();
  });

  it("gives a failed order the approved mark, no paid time, and no action (BR-20)", async () => {
    getActor.mockResolvedValue(admin);
    getOrder.mockResolvedValue({
      ...order,
      paymentStatus: "FAILED" as const,
      paidAt: null,
      sellerOrders: [
        {
          ...sellerOrder,
          fulfilmentStatus: "CANCELLED" as const,
          cancellationKind: "PAYMENT_FAILED" as const,
        },
      ],
    });
    render(await OrderSection({ params: Promise.resolve({ id: "o1" }) }));
    expect(screen.getAllByText("ชำระเงินไม่สำเร็จ").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(th.admin.orders.paidAt)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("ยกเลิกแล้ว คืนเงินนอกระบบ")).toBeNull();
  });

  it("marks a part cancelled after payment and keeps the payment as paid", async () => {
    getActor.mockResolvedValue(admin);
    getOrder.mockResolvedValue({
      ...order,
      sellerOrders: [
        {
          ...sellerOrder,
          fulfilmentStatus: "CANCELLED" as const,
          cancellationKind: "REFUND_OUTSIDE_SYSTEM" as const,
        },
      ],
    });
    render(await OrderSection({ params: Promise.resolve({ id: "o1" }) }));
    expect(screen.getByText("ยกเลิกแล้ว คืนเงินนอกระบบ")).toBeTruthy();
    expect(screen.getByText(th.admin.orders.refundOutsideNote)).toBeTruthy();
    expect(screen.getByText(th.admin.orders.paidAt)).toBeTruthy();
  });

  it("refuses an order the server does not know with the not-found message", async () => {
    getActor.mockResolvedValue(admin);
    getOrder.mockRejectedValue(notFound());
    render(await OrderSection({ params: Promise.resolve({ id: "nope" }) }));
    expect(screen.getByText(th.admin.guard.notFoundTitle)).toBeTruthy();
  });
});

describe("CategoryCreateForm", () => {
  it("validates before sending and puts each message on its field", async () => {
    const user = userEvent.setup();
    render(<CategoryCreateForm />);
    await user.click(screen.getByRole("button", { name: th.admin.categories.create }));
    expect(screen.getByText(th.admin.categories.fieldErrors.name.required)).toBeTruthy();
    expect(api.createCategory).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(th.admin.categories.name), "เสื้อผ้า");
    await user.type(screen.getByLabelText(th.admin.categories.sortOrder), "1.5");
    await user.click(screen.getByRole("button", { name: th.admin.categories.create }));
    expect(screen.getByText(th.admin.categories.fieldErrors.sortOrder.invalid)).toBeTruthy();
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it("sends the name without a sort order when it is blank, then confirms and clears", async () => {
    const user = userEvent.setup();
    api.createCategory.mockResolvedValue(ok({ id: "c1" }));
    render(
      <>
        <AdminNoticeRegion />
        <CategoryCreateForm />
      </>,
    );
    await user.type(screen.getByLabelText(th.admin.categories.name), "เสื้อผ้า");
    await user.click(screen.getByRole("button", { name: th.admin.categories.create }));
    expect(api.createCategory).toHaveBeenCalledWith({ name: "เสื้อผ้า" });
    expect(await screen.findByText(th.admin.categories.created)).toBeTruthy();
    expect((screen.getByLabelText(th.admin.categories.name) as HTMLInputElement).value).toBe("");
    expect(refresh).toHaveBeenCalled();
  });

  it("disables the submit button while pending", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    api.createCategory.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<CategoryCreateForm />);
    await user.type(screen.getByLabelText(th.admin.categories.name), "เสื้อผ้า");
    const submit = screen.getByRole("button", { name: th.admin.categories.create });
    await user.click(submit);
    // Loading, not natively disabled: focus stays and the click is ignored.
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(submit);
    await user.click(submit);
    expect(api.createCategory).toHaveBeenCalledTimes(1);
    finish(ok({ id: "c1" }));
    await waitFor(() => expect(submit.getAttribute("aria-disabled")).toBeNull());
  });

  it("shows the server refusal of a field under that field", async () => {
    const user = userEvent.setup();
    api.createCategory.mockResolvedValue(
      failure("VALIDATION_ERROR", 400, undefined, [{ path: "name", code: "invalid_format" }]),
    );
    render(<CategoryCreateForm />);
    await user.type(screen.getByLabelText(th.admin.categories.name), "x");
    await user.click(screen.getByRole("button", { name: th.admin.categories.create }));
    expect(await screen.findByText(th.admin.categories.fieldErrors.name.invalid)).toBeTruthy();
  });
});

describe("CategoriesTable edit", () => {
  const category = {
    id: "c1",
    name: "เสื้อผ้า",
    slug: "suea-pha",
    sortOrder: 3,
    isActive: true,
    isSample: false,
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
  };

  it("sends only the field that changed", async () => {
    const user = userEvent.setup();
    api.updateCategory.mockResolvedValue(ok(category));
    render(<CategoriesTable items={[category]} />);
    await user.click(screen.getByRole("button", { name: th.admin.categories.edit }));
    const dialog = screen.getByRole("dialog", { name: th.admin.categories.editTitle });
    const name = within(dialog).getByLabelText(th.admin.categories.name);
    await user.clear(name);
    await user.type(name, "เครื่องแต่งกาย");
    await user.click(within(dialog).getByRole("button", { name: th.admin.common.save }));
    expect(api.updateCategory).toHaveBeenCalledWith("c1", { name: "เครื่องแต่งกาย" });
  });

  it("says nothing changed instead of sending an empty request", async () => {
    const user = userEvent.setup();
    render(<CategoriesTable items={[category]} />);
    await user.click(screen.getByRole("button", { name: th.admin.categories.edit }));
    await user.click(screen.getByRole("button", { name: th.admin.common.save }));
    expect(screen.getByText(th.admin.categories.noChange)).toBeTruthy();
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it("deactivates with the effect on products stated, and deletes only after a confirmation", async () => {
    const user = userEvent.setup();
    api.updateCategory.mockResolvedValue(ok({ ...category, isActive: false }));
    render(<CategoriesTable items={[category]} />);
    await user.click(screen.getByRole("button", { name: th.admin.categories.deactivate }));
    expect(screen.getByText(th.admin.categories.deactivateConfirmNote)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: th.admin.categories.deactivateConfirmAction }),
    );
    expect(api.updateCategory).toHaveBeenCalledWith("c1", { isActive: false });
  });

  it("explains a refused delete of a category that has products", async () => {
    const user = userEvent.setup();
    api.deleteCategory.mockResolvedValue(failure("CONFLICT", 409, "CATEGORY_HAS_PRODUCTS"));
    render(<CategoriesTable items={[category]} />);
    await user.click(screen.getByRole("button", { name: th.admin.categories.delete }));
    expect(api.deleteCategory).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: th.admin.categories.deleteConfirmAction }));
    expect(await screen.findByText(th.admin.errors.reasons.CATEGORY_HAS_PRODUCTS)).toBeTruthy();
  });
});

describe("SettingsForm", () => {
  const settings = {
    flatShippingFeeSatang: 4000,
    commissionRateBps: 500,
    updatedAt: "2026-10-11T10:00:00.000Z",
    updatedById: null,
  };

  it("shows the stored values in baht and whole percent with labels and helper text", () => {
    render(<SettingsForm settings={settings} />);
    expect((screen.getByLabelText(th.admin.settings.shippingFee) as HTMLInputElement).value).toBe(
      "40",
    );
    expect((screen.getByLabelText(th.admin.settings.commission) as HTMLInputElement).value).toBe(
      "5",
    );
    expect(screen.getByText(th.admin.settings.commissionHelper)).toBeTruthy();
    expect(screen.getByText(th.notice.simulatedShipping)).toBeTruthy();
  });

  it("sends integer satang and basis points, only for what changed", async () => {
    const user = userEvent.setup();
    api.updateSettings.mockResolvedValue(
      ok({ ...settings, flatShippingFeeSatang: 4950, commissionRateBps: 700 }),
    );
    render(<SettingsForm settings={settings} />);
    const fee = screen.getByLabelText(th.admin.settings.shippingFee);
    await user.clear(fee);
    await user.type(fee, "49.50");
    await user.click(screen.getByRole("button", { name: th.admin.settings.save }));
    expect(api.updateSettings).toHaveBeenCalledWith({ flatShippingFeeSatang: 4950 });
    expect(await screen.findByText(th.admin.settings.saved)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a commission with a decimal and a fee above 1,000 baht before sending", async () => {
    const user = userEvent.setup();
    render(<SettingsForm settings={settings} />);
    const percent = screen.getByLabelText(th.admin.settings.commission);
    await user.clear(percent);
    await user.type(percent, "2.5");
    const fee = screen.getByLabelText(th.admin.settings.shippingFee);
    await user.clear(fee);
    await user.type(fee, "1000.01");
    await user.click(screen.getByRole("button", { name: th.admin.settings.save }));
    expect(screen.getByText(th.admin.settings.fieldErrors.commissionRateBps.invalid)).toBeTruthy();
    expect(
      screen.getByText(th.admin.settings.fieldErrors.flatShippingFeeSatang.tooLong),
    ).toBeTruthy();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("accepts the boundary values 0 and 1,000 baht, 0 and 100 percent", async () => {
    const user = userEvent.setup();
    api.updateSettings.mockResolvedValue(
      ok({ ...settings, flatShippingFeeSatang: 100_000, commissionRateBps: 10_000 }),
    );
    render(<SettingsForm settings={settings} />);
    const fee = screen.getByLabelText(th.admin.settings.shippingFee);
    await user.clear(fee);
    await user.type(fee, "1000");
    const percent = screen.getByLabelText(th.admin.settings.commission);
    await user.clear(percent);
    await user.type(percent, "100");
    await user.click(screen.getByRole("button", { name: th.admin.settings.save }));
    expect(api.updateSettings).toHaveBeenCalledWith({
      flatShippingFeeSatang: 100_000,
      commissionRateBps: 10_000,
    });
  });

  it("asks for a value instead of treating an empty field as zero", async () => {
    const user = userEvent.setup();
    render(<SettingsForm settings={settings} />);
    await user.clear(screen.getByLabelText(th.admin.settings.shippingFee));
    await user.click(screen.getByRole("button", { name: th.admin.settings.save }));
    expect(
      screen.getByText(th.admin.settings.fieldErrors.flatShippingFeeSatang.required),
    ).toBeTruthy();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("says nothing changed instead of sending an empty request", async () => {
    const user = userEvent.setup();
    render(<SettingsForm settings={settings} />);
    await user.click(screen.getByRole("button", { name: th.admin.settings.save }));
    expect(screen.getByText(th.admin.settings.noChange)).toBeTruthy();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("shows the server message of a refusal and keeps the form usable", async () => {
    const user = userEvent.setup();
    api.updateSettings.mockResolvedValue(failure("FORBIDDEN", 403));
    render(<SettingsForm settings={settings} />);
    const percent = screen.getByLabelText(th.admin.settings.commission);
    await user.clear(percent);
    await user.type(percent, "7");
    const submit = screen.getByRole("button", { name: th.admin.settings.save });
    await user.click(submit);
    expect(await screen.findByText(th.errors.forbidden)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the submit button while pending", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    api.updateSettings.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<SettingsForm settings={settings} />);
    const percent = screen.getByLabelText(th.admin.settings.commission);
    await user.clear(percent);
    await user.type(percent, "7");
    const submit = screen.getByRole("button", { name: th.admin.settings.save });
    await user.click(submit);
    // Loading, not natively disabled: focus stays and the click is ignored.
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(submit);
    await user.click(submit);
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    finish(ok({ ...settings, commissionRateBps: 700 }));
    await waitFor(() => expect(submit.getAttribute("aria-disabled")).toBeNull());
  });
});
