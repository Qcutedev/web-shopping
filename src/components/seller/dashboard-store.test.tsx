import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";
import { formatSatang } from "@/lib/format";

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

const getOwnStore = vi.fn();
vi.mock("@/modules/sellers", () => ({
  getOwnStore: (...args: unknown[]) => getOwnStore(...args),
  getOwnApplication: vi.fn(),
}));
const getSellerSummary = vi.fn();
vi.mock("@/modules/orders", () => ({
  getSellerSummary: (...args: unknown[]) => getSellerSummary(...args),
}));

const updateStore = vi.fn();
const uploadImage = vi.fn();
vi.mock("@/lib/api-client/seller", () => ({
  updateStore: (...args: unknown[]) => updateStore(...args),
  uploadImage: (...args: unknown[]) => uploadImage(...args),
}));

import { DashboardSection } from "./dashboard-section";
import { DashboardView } from "./dashboard-view";
import { StoreForm, storeChanges } from "./store-form";
import { StoreSection } from "./store-section";

const seller = { userId: "u2", role: "SELLER", storeId: "s1", storeStatus: "APPROVED" };

const summary = {
  productsByStatus: { DRAFT: 2, PUBLISHED: 14, ARCHIVED: 1 },
  lowStockCount: 3,
  soldOutCount: 1,
  ordersByStatus: { PENDING: 1, PROCESSING: 2, SHIPPED: 0, DELIVERED: 9, CANCELLED: 1 },
  paidSalesTotalSatang: 1_250_000,
};

const store = {
  id: "s1",
  name: "ร้านทดสอบ",
  slug: "ran-thotsop",
  description: "ขายของ",
  logo: null,
  contactPhone: "0812345678",
  status: "APPROVED" as const,
  statusReason: null,
  isSample: false,
};

beforeEach(() => {
  getActor.mockReset();
  getOwnStore.mockReset();
  getSellerSummary.mockReset();
  updateStore.mockReset();
  uploadImage.mockReset();
  refresh.mockReset();
});

describe("DashboardSection", () => {
  it("reads the summary and store of the session's actor and shows the real figures", async () => {
    getActor.mockResolvedValue(seller);
    getSellerSummary.mockResolvedValue(summary);
    getOwnStore.mockResolvedValue(store);
    render(await DashboardSection());
    expect(getSellerSummary).toHaveBeenCalledWith(seller);
    expect(getOwnStore).toHaveBeenCalledWith(seller);

    const products = screen.getByRole("list", { name: th.seller.dashboard.productsByStatusLabel });
    const published = within(products).getByRole("link", {
      name: new RegExp(th.seller.status.product.PUBLISHED),
    });
    expect(published.textContent).toContain("14");
    expect(published.getAttribute("href")).toBe("/seller/products?status=PUBLISHED");

    const orders = screen.getByRole("list", { name: th.seller.dashboard.ordersByStatusLabel });
    expect(
      within(orders).getByRole("link", { name: new RegExp(th.seller.status.fulfilment.DELIVERED) })
        .textContent,
    ).toContain("9");
    expect(screen.getByText(formatSatang(1_250_000))).toBeTruthy();
    expect(screen.getByText(th.seller.dashboard.salesNote)).toBeTruthy();
    expect(screen.getByText(th.seller.dashboard.lowStock).closest("a")?.getAttribute("href")).toBe(
      "/seller/products?lowStock=true",
    );
  });

  it("shows the error state with a retry when the summary cannot be read", async () => {
    getActor.mockResolvedValue(seller);
    getSellerSummary.mockRejectedValue(new Error("db down"));
    getOwnStore.mockResolvedValue(store);
    render(await DashboardSection());
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/seller",
    );
  });

  it("keeps the dashboard readable for a suspended store, with the notice", async () => {
    getActor.mockResolvedValue({ ...seller, storeStatus: "SUSPENDED" });
    getSellerSummary.mockResolvedValue(summary);
    getOwnStore.mockResolvedValue({ ...store, status: "SUSPENDED", statusReason: "ตรวจสอบ" });
    render(await DashboardSection());
    expect(screen.getByText(th.seller.suspended.title)).toBeTruthy();
    expect(screen.getByText(formatSatang(1_250_000))).toBeTruthy();
  });
});

describe("suspended store is read once per request (CR-108)", () => {
  const suspendedStore = { ...store, status: "SUSPENDED" as const, statusReason: "ตรวจสอบ" };
  const suspended = { ...seller, storeStatus: "SUSPENDED" };

  it("dashboard: one getOwnStore call serves the banner and the view", async () => {
    getActor.mockResolvedValue(suspended);
    getSellerSummary.mockResolvedValue(summary);
    getOwnStore.mockResolvedValue(suspendedStore);
    render(await DashboardSection());
    expect(getOwnStore).toHaveBeenCalledTimes(1);
    expect(screen.getByText("ตรวจสอบ")).toBeTruthy();
  });

  it("store page: one getOwnStore call serves the banner and the form", async () => {
    getActor.mockResolvedValue(suspended);
    getOwnStore.mockResolvedValue(suspendedStore);
    render(await StoreSection());
    expect(getOwnStore).toHaveBeenCalledTimes(1);
    expect(screen.getByText("ตรวจสอบ")).toBeTruthy();
  });

  it("a failed read for the banner is retried by the section instead of cached", async () => {
    getActor.mockResolvedValue(suspended);
    getOwnStore.mockRejectedValueOnce(new Error("db blip")).mockResolvedValue(suspendedStore);
    render(await StoreSection());
    expect(getOwnStore).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(new RegExp(th.seller.store.fields.name))).toBeTruthy();
  });
});

describe("DashboardView", () => {
  it("shows the empty state with the way to add a product when nothing exists", () => {
    render(
      <DashboardView
        store={store}
        summary={{
          productsByStatus: { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 },
          lowStockCount: 0,
          soldOutCount: 0,
          ordersByStatus: { PENDING: 0, PROCESSING: 0, SHIPPED: 0, DELIVERED: 0, CANCELLED: 0 },
          paidSalesTotalSatang: 0,
        }}
      />,
    );
    expect(screen.getByText(th.seller.dashboard.emptyTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.seller.dashboard.emptyAction }).getAttribute("href"),
    ).toBe("/seller/products/new");
  });

  it("marks sample stores with the notice label", () => {
    render(<DashboardView store={{ ...store, isSample: true }} summary={summary} />);
    expect(screen.getByText(th.notice.sampleData)).toBeTruthy();
  });
});

describe("storeChanges", () => {
  const base = { ...store };
  const same = {
    name: base.name,
    description: "ขายของ",
    contactPhone: base.contactPhone,
    logo: null,
  };

  it("is empty when nothing differs", () => {
    expect(storeChanges(base, same)).toEqual({});
  });

  it("sends only what changed and null for a cleared description or logo", () => {
    expect(storeChanges(base, { ...same, name: "ใหม่" })).toEqual({ name: "ใหม่" });
    expect(storeChanges(base, { ...same, description: "  " })).toEqual({ description: null });
    expect(storeChanges({ ...base, logo: { key: "k", url: "/api/files/k" } }, same)).toEqual({
      logoKey: null,
    });
    expect(storeChanges(base, { ...same, logo: { key: "k2", url: "/api/files/k2" } })).toEqual({
      logoKey: "k2",
    });
  });
});

describe("StoreSection and StoreForm", () => {
  it("renders the store read through the service", async () => {
    getActor.mockResolvedValue(seller);
    getOwnStore.mockResolvedValue(store);
    render(await StoreSection());
    expect(getOwnStore).toHaveBeenCalledWith(seller);
    expect(
      (screen.getByLabelText(new RegExp(th.seller.store.fields.name)) as HTMLInputElement).value,
    ).toBe("ร้านทดสอบ");
  });

  it("says nothing changed and sends nothing when the form is unchanged", async () => {
    const user = userEvent.setup();
    render(<StoreForm store={store} />);
    await user.click(screen.getByRole("button", { name: th.seller.store.save }));
    expect(screen.getByText(th.seller.store.noChange)).toBeTruthy();
    expect(updateStore).not.toHaveBeenCalled();
  });

  it("sends only the changed field, shows the saved confirmation, and refreshes", async () => {
    const user = userEvent.setup();
    updateStore.mockResolvedValue({ ok: true, status: 200, data: { ...store, name: "ชื่อใหม่" } });
    render(<StoreForm store={store} />);
    const name = screen.getByLabelText(new RegExp(th.seller.store.fields.name));
    await user.clear(name);
    await user.type(name, "ชื่อใหม่");
    await user.click(screen.getByRole("button", { name: th.seller.store.save }));
    expect(updateStore).toHaveBeenCalledWith({ name: "ชื่อใหม่" });
    expect(await screen.findByText(th.seller.store.saved)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("puts a name conflict under the name field", async () => {
    const user = userEvent.setup();
    updateStore.mockResolvedValue({
      ok: false,
      status: 409,
      code: "CONFLICT",
      reason: "STORE_NAME_TAKEN",
      fields: [],
      requestId: null,
    });
    render(<StoreForm store={store} />);
    const name = screen.getByLabelText(new RegExp(th.seller.store.fields.name));
    await user.clear(name);
    await user.type(name, "ซ้ำ");
    await user.click(screen.getByRole("button", { name: th.seller.store.save }));
    expect(await screen.findByText(th.seller.errors.reasons.STORE_NAME_TAKEN)).toBeTruthy();
  });

  it("disables the controls of a suspended store and sends nothing", async () => {
    render(<StoreForm store={{ ...store, status: "SUSPENDED" }} />);
    expect(screen.getByText(th.seller.store.suspendedNote)).toBeTruthy();
    expect(
      (screen.getByLabelText(new RegExp(th.seller.store.fields.name)) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: th.seller.store.save }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("uploads a logo, keeps it unsaved, and saves its key with the form", async () => {
    const user = userEvent.setup();
    uploadImage.mockResolvedValue({
      ok: true,
      status: 201,
      data: { key: "abc", url: "/api/files/abc", contentType: "image/png", sizeBytes: 3 },
    });
    updateStore.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...store, logo: { key: "abc", url: "/api/files/abc" } },
    });
    const { container } = render(<StoreForm store={store} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["abc"], "logo.png", { type: "image/png" }));
    expect(await screen.findByText(th.seller.images.uploaded)).toBeTruthy();
    expect(updateStore).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: th.seller.store.save }));
    await waitFor(() => expect(updateStore).toHaveBeenCalledWith({ logoKey: "abc" }));
  });

  it("refuses a file of the wrong type before any request", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<StoreForm store={store} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["x"], "a.gif", { type: "image/gif" }));
    expect(await screen.findByText(th.seller.images.wrongType)).toBeTruthy();
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

describe("StoreForm follows the stored store (CR-99)", () => {
  it("shows the form read-only when the page passes a suspended store", () => {
    const { rerender } = render(<StoreForm store={store} />);
    rerender(<StoreForm store={{ ...store, status: "SUSPENDED" }} />);
    expect(screen.getByText(th.seller.store.suspendedNote)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: th.seller.store.save }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps a typed name when only the status changes (CR-109)", () => {
    const { rerender } = render(<StoreForm store={store} />);
    fireEvent.change(screen.getByLabelText(new RegExp(th.seller.store.fields.name)), {
      target: { value: "typed-name" },
    });
    rerender(<StoreForm store={{ ...store, status: "SUSPENDED" }} />);
    expect(
      (screen.getByLabelText(new RegExp(th.seller.store.fields.name)) as HTMLInputElement).value,
    ).toBe("typed-name");
    expect(screen.getByText(th.seller.store.suspendedNote)).toBeTruthy();
  });
});

describe("StoreForm holds save during an upload (CR-103)", () => {
  it("disables the save button until the picture has arrived", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    uploadImage.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { container } = render(<StoreForm store={store} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["abc"], "logo.png", { type: "image/png" }));
    const save = screen.getByRole("button", { name: th.seller.store.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    finish({
      ok: true,
      status: 201,
      data: { key: "abc", url: "/api/files/abc", contentType: "image/png", sizeBytes: 3 },
    });
    await screen.findByText(th.seller.images.uploaded);
    expect(save.disabled).toBe(false);
  });
});

describe("DashboardView tiles (CR-105)", () => {
  it("renders the counts as stat cards with grouped thousands, each linking to its list", () => {
    render(
      <DashboardView
        summary={{ ...summary, lowStockCount: 1234 }}
        store={{ name: "x", status: "APPROVED", isSample: false }}
      />,
    );
    const link = screen.getByText(th.seller.dashboard.lowStock).closest("a");
    expect(link?.getAttribute("href")).toBe("/seller/products?lowStock=true");
    expect(within(link as HTMLElement).getByText("1,234")).toBeTruthy();
    expect(link?.closest("li")).toBeTruthy();
    // Only StatCard puts a space between label and value (accessible name reads label, then value)
    // and gives the link the surface card classes. The old hand-written tile had neither.
    expect(link?.textContent).toBe(`${th.seller.dashboard.lowStock} 1,234`);
    expect(link?.className).toContain("bg-surface");
  });
});
