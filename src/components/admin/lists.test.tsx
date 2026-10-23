import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fill } from "@/i18n/fill";
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

const service = {
  listUsers: vi.fn(),
  listApplications: vi.fn(),
  listStores: vi.fn(),
  listProducts: vi.fn(),
  listCategories: vi.fn(),
  listOrders: vi.fn(),
  listAuditLogs: vi.fn(),
  getSummary: vi.fn(),
  getReport: vi.fn(),
  getSettings: vi.fn(),
};
vi.mock("@/modules/admin", () => ({
  listUsers: (...args: unknown[]) => service.listUsers(...args),
  listApplications: (...args: unknown[]) => service.listApplications(...args),
  listStores: (...args: unknown[]) => service.listStores(...args),
  listProducts: (...args: unknown[]) => service.listProducts(...args),
  listCategories: (...args: unknown[]) => service.listCategories(...args),
  listOrders: (...args: unknown[]) => service.listOrders(...args),
  listAuditLogs: (...args: unknown[]) => service.listAuditLogs(...args),
  getSummary: (...args: unknown[]) => service.getSummary(...args),
  getReport: (...args: unknown[]) => service.getReport(...args),
  getSettings: (...args: unknown[]) => service.getSettings(...args),
}));
vi.mock("@/lib/api-client/admin", () => ({}));

import { ApplicationsSection } from "./applications-section";
import { AuditSection } from "./audit-section";
import { CategoriesSection } from "./categories-section";
import { DashboardSection } from "./dashboard-section";
import { OrdersSection } from "./orders-section";
import { ProductsSection } from "./products-section";
import { ReportsSection } from "./reports-section";
import { StoresSection } from "./stores-section";
import { UsersSection } from "./users-section";

const admin = { userId: "a1", role: "ADMIN" };

function page<T>(items: T[], total = items.length, pageNumber = 1, pageSize = 20) {
  return { items, page: pageNumber, pageSize, total };
}

const user = {
  id: "u2",
  name: "สมชาย ใจดี",
  email: "somchai@example.com",
  phone: null,
  role: "SELLER" as const,
  isActive: true,
  createdAt: "2026-10-11T10:00:00.000Z",
  store: { id: "s1", name: "ร้านสมชาย", slug: "ran-somchai", status: "APPROVED" as const },
};

beforeEach(() => {
  getActor.mockReset();
  for (const fn of Object.values(service)) fn.mockReset();
  refresh.mockReset();
});

describe("access to every admin section", () => {
  it("sends a guest to sign-in with the page to come back to", async () => {
    getActor.mockResolvedValue(null);
    await expect(UsersSection({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      url: "/sign-in?next=%2Fadmin%2Fusers",
    });
    expect(service.listUsers).not.toHaveBeenCalled();
  });

  it.each(["CUSTOMER", "SELLER"])("shows a refusal to a %s and reads nothing", async (role) => {
    getActor.mockResolvedValue({ userId: "u9", role });
    render(await UsersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.guard.forbiddenTitle)).toBeTruthy();
    expect(service.listUsers).not.toHaveBeenCalled();
  });

  it("shows the refusal when the service itself answers 403", async () => {
    const { forbidden } = await import("@/server/errors");
    getActor.mockResolvedValue(admin);
    service.listUsers.mockRejectedValue(forbidden());
    render(await UsersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.guard.forbiddenTitle)).toBeTruthy();
  });

  it("shows the error state with a retry link when a read fails", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockRejectedValue(new Error("db down"));
    render(await UsersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe(
      "/admin/users",
    );
  });
});

describe("UsersSection", () => {
  it("lists users with the filters from the address bar and a labelled form", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([user]));
    render(
      await UsersSection({
        searchParams: Promise.resolve({ q: "สม", role: "SELLER", isActive: "true" }),
      }),
    );
    expect(service.listUsers).toHaveBeenCalledWith(admin, {
      page: 1,
      pageSize: 20,
      q: "สม",
      role: "SELLER",
      isActive: true,
    });
    const table = screen.getByRole("table", { name: th.admin.users.listLabel });
    expect(within(table).getByText("somchai@example.com")).toBeTruthy();
    expect(within(table).getByText("ร้านสมชาย")).toBeTruthy();
    expect(screen.getByRole("form", { name: th.admin.users.filter.formLabel })).toBeTruthy();
  });

  it("labels each filter control", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([user]));
    render(await UsersSection({ searchParams: Promise.resolve({ role: "SELLER" }) }));
    expect(screen.getByLabelText(th.admin.users.filter.q)).toBeTruthy();
    expect((screen.getByLabelText(th.admin.users.filter.role) as HTMLSelectElement).value).toBe(
      "SELLER",
    );
    expect(screen.getByLabelText(th.admin.users.filter.active)).toBeTruthy();
    expect(screen.getByRole("button", { name: th.admin.common.apply })).toBeTruthy();
  });

  it("offers reactivate for a deactivated user and no deactivate on the admin's own row", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(
      page([
        { ...user, id: "u3", isActive: false },
        { ...user, id: "a1", name: "ผู้ดูแล", role: "ADMIN", store: null },
      ]),
    );
    render(await UsersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: th.admin.users.reactivate })).toBeTruthy();
    expect(screen.queryByRole("button", { name: th.admin.users.deactivate })).toBeNull();
    expect(screen.getByText(th.admin.users.self)).toBeTruthy();
  });

  it("shows the empty state", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([]));
    render(await UsersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.users.emptyTitle)).toBeTruthy();
  });

  it("shows the filtered empty state with a way to reset", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([]));
    render(await UsersSection({ searchParams: Promise.resolve({ q: "zzz" }) }));
    expect(screen.getByText(th.admin.common.filteredEmptyTitle)).toBeTruthy();
    const resets = screen.getAllByRole("link", { name: th.admin.common.reset });
    expect(resets.every((link) => link.getAttribute("href") === "/admin/users")).toBe(true);
  });

  it("pages: the total gives the pages and the links keep the filter", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([user], 45, 2, 20));
    render(await UsersSection({ searchParams: Promise.resolve({ role: "SELLER", page: "2" }) }));
    expect(screen.getByText(fill(th.admin.common.count, { count: "45" }))).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: th.pagination.label });
    expect(within(nav).getByRole("link", { name: th.pagination.next }).getAttribute("href")).toBe(
      "/admin/users?role=SELLER&page=3",
    );
    expect(
      within(nav).getByRole("link", { name: th.pagination.previous }).getAttribute("href"),
    ).toBe("/admin/users?role=SELLER");
  });

  it("offers the first page when the requested page is past the end", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([], 3, 9, 20));
    render(await UsersSection({ searchParams: Promise.resolve({ page: "9" }) }));
    expect(screen.getByText(th.admin.common.pageEmptyTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.admin.common.pageEmptyAction }).getAttribute("href"),
    ).toBe("/admin/users");
  });

  it("tells the admin when a filter value was refused and left out", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([user]));
    render(await UsersSection({ searchParams: Promise.resolve({ role: "ROOT" }) }));
    expect(screen.getByText(th.admin.common.ignoredFilters)).toBeTruthy();
    expect(service.listUsers).toHaveBeenCalledWith(admin, { page: 1, pageSize: 20 });
  });

  it("renders a user name as text, never as markup", async () => {
    getActor.mockResolvedValue(admin);
    service.listUsers.mockResolvedValue(page([{ ...user, name: "<img src=x onerror=alert(1)>" }]));
    const { container } = render(await UsersSection({ searchParams: Promise.resolve({}) }));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});

describe("ApplicationsSection", () => {
  const application = {
    id: "ap1",
    applicant: { id: "u5", name: "มาลี", email: "malee@example.com", isActive: true },
    storeName: "ร้านมาลี",
    description: "ขายของ",
    contactPhone: "0812345678",
    status: "PENDING" as const,
    reviewNote: null,
    reviewedAt: null,
    createdAt: "2026-10-11T10:00:00.000Z",
  };

  it("offers approve and reject on a pending application only", async () => {
    getActor.mockResolvedValue(admin);
    service.listApplications.mockResolvedValue(
      page([
        application,
        {
          ...application,
          id: "ap2",
          status: "REJECTED" as const,
          reviewNote: "ไม่ครบ",
          reviewedAt: "2026-10-12T10:00:00.000Z",
        },
      ]),
    );
    render(await ApplicationsSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByRole("button", { name: th.admin.applications.approve })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: th.admin.applications.reject })).toHaveLength(1);
    expect(screen.getByText(/ไม่ครบ/)).toBeTruthy();
  });

  it("passes the status filter to the service and marks an inactive applicant", async () => {
    getActor.mockResolvedValue(admin);
    service.listApplications.mockResolvedValue(
      page([{ ...application, applicant: { ...application.applicant, isActive: false } }]),
    );
    render(await ApplicationsSection({ searchParams: Promise.resolve({ status: "PENDING" }) }));
    expect(service.listApplications).toHaveBeenCalledWith(admin, {
      page: 1,
      pageSize: 20,
      status: "PENDING",
    });
    expect(screen.getByText(th.admin.applications.applicantInactive)).toBeTruthy();
  });

  it("shows the empty state", async () => {
    getActor.mockResolvedValue(admin);
    service.listApplications.mockResolvedValue(page([]));
    render(await ApplicationsSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.applications.emptyTitle)).toBeTruthy();
  });
});

describe("StoresSection", () => {
  const store = {
    id: "s1",
    name: "ร้านสมชาย",
    slug: "ran-somchai",
    description: null,
    logo: null,
    contactPhone: "0812345678",
    status: "APPROVED" as const,
    statusReason: null,
    isSample: false,
    ownerId: "u2",
    ownerIsActive: true,
    createdAt: "2026-10-11T10:00:00.000Z",
  };

  it("offers suspend for an approved store and reinstate for a suspended one", async () => {
    getActor.mockResolvedValue(admin);
    service.listStores.mockResolvedValue(
      page([
        store,
        {
          ...store,
          id: "s2",
          name: "ร้านสอง",
          status: "SUSPENDED" as const,
          statusReason: "ขายของปลอม",
        },
      ]),
    );
    render(await StoresSection({ searchParams: Promise.resolve({ q: "ร้าน" }) }));
    expect(screen.getAllByRole("button", { name: th.admin.stores.suspend })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: th.admin.stores.reinstate })).toHaveLength(1);
    expect(screen.getByText(/ขายของปลอม/)).toBeTruthy();
    expect(service.listStores).toHaveBeenCalledWith(admin, { page: 1, pageSize: 20, q: "ร้าน" });
  });

  it("says when the owner of a store is deactivated", async () => {
    getActor.mockResolvedValue(admin);
    service.listStores.mockResolvedValue(page([{ ...store, ownerIsActive: false }]));
    render(await StoresSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.stores.ownerInactive)).toBeTruthy();
  });
});

describe("ProductsSection", () => {
  const product = {
    id: "p1",
    slug: "shirt",
    title: "เสื้อยืด",
    description: "นุ่ม",
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
    contentRevision: 3,
    moderationRequestedAt: "2026-10-11T12:00:00.000Z",
    store: { id: "s1", name: "ร้านสมชาย", slug: "ran-somchai", status: "APPROVED" as const },
  };

  it("shows the approval queue by default and asks the service for the queue", async () => {
    getActor.mockResolvedValue(admin);
    service.listProducts.mockResolvedValue(page([product]));
    render(await ProductsSection({ searchParams: Promise.resolve({}) }));
    expect(service.listProducts).toHaveBeenCalledWith(admin, {
      page: 1,
      pageSize: 20,
      queue: true,
    });
    const table = screen.getByRole("table", { name: th.admin.products.listLabel });
    const link = within(table).getByRole("link", { name: /เสื้อยืด/ });
    expect(link.getAttribute("href")).toBe("/admin/products/p1");
    expect(within(table).getByText(formatSatang(25_900))).toBeTruthy();
  });

  it("shows the good-news empty state for an empty queue", async () => {
    getActor.mockResolvedValue(admin);
    service.listProducts.mockResolvedValue(page([]));
    render(await ProductsSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.products.queueEmptyTitle)).toBeTruthy();
  });

  it("lists every product with the status filters when the view is all", async () => {
    getActor.mockResolvedValue(admin);
    service.listProducts.mockResolvedValue(page([product]));
    render(
      await ProductsSection({
        searchParams: Promise.resolve({ view: "all", moderationStatus: "REJECTED" }),
      }),
    );
    expect(service.listProducts).toHaveBeenCalledWith(admin, {
      page: 1,
      pageSize: 20,
      moderationStatus: "REJECTED",
    });
  });
});

describe("CategoriesSection", () => {
  const category = {
    id: "c1",
    name: "เสื้อผ้า",
    slug: "suea-pha",
    sortOrder: 1,
    isActive: true,
    isSample: true,
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
  };

  it("shows the create form with the list and the row actions, sample data labelled", async () => {
    getActor.mockResolvedValue(admin);
    service.listCategories.mockResolvedValue(
      page([category, { ...category, id: "c2", isActive: false }]),
    );
    render(await CategoriesSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText(th.admin.categories.name)).toBeTruthy();
    expect(screen.getAllByText(th.notice.sampleData).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: th.admin.categories.deactivate })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: th.admin.categories.reactivate })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: th.admin.categories.delete })).toHaveLength(2);
  });

  it("shows the empty state beside the form that adds the first category", async () => {
    getActor.mockResolvedValue(admin);
    service.listCategories.mockResolvedValue(page([]));
    render(await CategoriesSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.categories.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: th.admin.categories.create })).toBeTruthy();
  });
});

describe("AuditSection", () => {
  const entry = {
    id: "l1",
    actorId: "a1",
    action: "STORE_SUSPENDED",
    targetType: "Store",
    targetId: "s1",
    metadata: {
      reason: "<b>x</b>",
      before: { status: "APPROVED" },
      after: { status: "SUSPENDED" },
    },
    createdAt: "2026-10-11T10:00:00.000Z",
  };

  it("lists entries read-only with their details as text", async () => {
    getActor.mockResolvedValue(admin);
    service.listAuditLogs.mockResolvedValue(page([entry]));
    const { container } = render(
      await AuditSection({
        searchParams: Promise.resolve({ action: "STORE_SUSPENDED", from: "2026-10-11" }),
      }),
    );
    expect(service.listAuditLogs).toHaveBeenCalledWith(admin, {
      page: 1,
      pageSize: 20,
      action: "STORE_SUSPENDED",
      from: new Date("2026-10-10T17:00:00.000Z"),
    });
    expect(screen.getAllByText("STORE_SUSPENDED").length).toBeGreaterThan(0);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<b>x<\/b>/)).toBeTruthy();
    // Nothing edits or deletes an entry: the log has no button besides the filter.
    expect(screen.queryByRole("button", { name: /ลบ|แก้ไข/ })).toBeNull();
  });

  it("shows the empty state", async () => {
    getActor.mockResolvedValue(admin);
    service.listAuditLogs.mockResolvedValue(page([]));
    render(await AuditSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.audit.emptyTitle)).toBeTruthy();
  });
});

describe("DashboardSection", () => {
  const summary = {
    pendingApplicationCount: 3,
    pendingProductCount: 11,
    userCount: 1240,
    storesByStatus: { APPROVED: 18, SUSPENDED: 1 },
    orderCount: 420,
    paidRevenueSatang: 31_200_000,
  };

  it("shows the four groups of figures exactly as the server sent them", async () => {
    getActor.mockResolvedValue(admin);
    service.getSummary.mockResolvedValue(summary);
    render(await DashboardSection());
    expect(screen.getByRole("link", { name: /11/ }).getAttribute("href")).toBe("/admin/products");
    expect(screen.getByText("1,240")).toBeTruthy();
    expect(screen.getByText("420")).toBeTruthy();
    expect(screen.getByText(formatSatang(31_200_000))).toBeTruthy();
    const stores = screen.getByRole("list", { name: th.admin.dashboard.storesByStatusLabel });
    expect(within(stores).getByText("18")).toBeTruthy();
    expect(within(stores).getByText("1")).toBeTruthy();
    // The user figure is one total with no split into active and deactivated (D-033 point 5).
    expect(screen.queryByText(th.admin.users.inactive)).toBeNull();
  });

  it("shows the error state when the summary cannot be read", async () => {
    getActor.mockResolvedValue(admin);
    service.getSummary.mockRejectedValue(new Error("db down"));
    render(await DashboardSection());
    expect(screen.getByRole("link", { name: th.errors.retry }).getAttribute("href")).toBe("/admin");
  });
});

describe("ReportsSection", () => {
  const report = {
    from: "2026-10-10T17:00:00.000Z",
    to: "2026-10-11T17:00:00.000Z",
    orderCount: 42,
    paidRevenueSatang: 3_120_000,
    newUserCount: 17,
    newSellerCount: 2,
  };

  it("asks for a range when none is given and reads nothing", async () => {
    getActor.mockResolvedValue(admin);
    render(await ReportsSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.reports.emptyTitle)).toBeTruthy();
    expect(service.getReport).not.toHaveBeenCalled();
    expect(screen.getByLabelText(th.admin.common.dateFrom)).toBeTruthy();
    expect(screen.getByLabelText(th.admin.common.dateTo)).toBeTruthy();
  });

  it("says so when the range is refused", async () => {
    getActor.mockResolvedValue(admin);
    render(
      await ReportsSection({
        searchParams: Promise.resolve({ from: "2026-10-12", to: "2026-10-11" }),
      }),
    );
    expect(screen.getByText(th.admin.reports.rangeInvalid)).toBeTruthy();
    expect(service.getReport).not.toHaveBeenCalled();
  });

  it("sends the Bangkok day range as instants and shows the figures", async () => {
    getActor.mockResolvedValue(admin);
    service.getReport.mockResolvedValue(report);
    render(
      await ReportsSection({
        searchParams: Promise.resolve({ from: "2026-10-11", to: "2026-10-11" }),
      }),
    );
    expect(service.getReport).toHaveBeenCalledWith(admin, {
      from: new Date("2026-10-10T17:00:00.000Z"),
      to: new Date("2026-10-11T17:00:00.000Z"),
    });
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText(formatSatang(3_120_000))).toBeTruthy();
    expect(screen.getByText("17")).toBeTruthy();
    // The orders behind the figure are the order list for the same paid-date range (BR-40).
    expect(
      screen.getByRole("link", { name: th.admin.reports.viewOrders }).getAttribute("href"),
    ).toBe("/admin/orders?paidFrom=2026-10-11&paidTo=2026-10-11");
  });
});

describe("OrdersSection", () => {
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
    items: [],
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
      recipientName: "สมชาย",
      phone: "0812345678",
      line1: "1",
      subdistrict: "a",
      district: "b",
      province: "c",
      postalCode: "10110",
    },
    sellerOrders: [sellerOrder],
    cartReturn: null,
    userId: "u1",
  };

  it("lists orders with the server total and the labelled filters", async () => {
    getActor.mockResolvedValue(admin);
    service.listOrders.mockResolvedValue(page([order]));
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    const table = screen.getByRole("table", { name: th.admin.orders.listLabel });
    expect(within(table).getByText(formatSatang(81_700))).toBeTruthy();
    expect(within(table).getByText(th.notice.mockPayment)).toBeTruthy();
    expect(
      within(table)
        .getAllByRole("link", { name: /OD2610110000042/ })[0]!
        .getAttribute("href"),
    ).toBe("/admin/orders/o1");
    for (const label of [
      th.admin.orders.filter.orderNumber,
      th.admin.orders.filter.payment,
      th.admin.orders.filter.fulfilment,
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole("group", { name: th.admin.orders.filter.paidRange })).toBeTruthy();
    expect(screen.getByRole("group", { name: th.admin.orders.filter.createdRange })).toBeTruthy();
  });

  it("filters by paid date as Bangkok days, last day included (BR-40)", async () => {
    getActor.mockResolvedValue(admin);
    service.listOrders.mockResolvedValue(page([order]));
    render(
      await OrdersSection({
        searchParams: Promise.resolve({ paidFrom: "2026-10-11", paidTo: "2026-10-11" }),
      }),
    );
    expect(service.listOrders).toHaveBeenCalledWith(admin, {
      page: 1,
      pageSize: 20,
      paidFrom: new Date("2026-10-10T17:00:00.000Z"),
      paidTo: new Date("2026-10-11T17:00:00.000Z"),
    });
    expect((screen.getAllByLabelText(th.admin.common.dateFrom)[1] as HTMLInputElement).value).toBe(
      "2026-10-11",
    );
  });

  it("marks the parts of a failed order with the approved text and never as a cancellation", async () => {
    getActor.mockResolvedValue(admin);
    service.listOrders.mockResolvedValue(
      page([
        {
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
        },
      ]),
    );
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("ชำระเงินไม่สำเร็จ").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(th.admin.orders.refundOutside)).toBeNull();
  });

  it("marks a part an admin cancelled after payment as refunded outside the system", async () => {
    getActor.mockResolvedValue(admin);
    service.listOrders.mockResolvedValue(
      page([
        {
          ...order,
          sellerOrders: [
            {
              ...sellerOrder,
              fulfilmentStatus: "CANCELLED" as const,
              cancellationKind: "REFUND_OUTSIDE_SYSTEM" as const,
            },
          ],
        },
      ]),
    );
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("ยกเลิกแล้ว คืนเงินนอกระบบ")).toBeTruthy();
  });

  it("shows the empty state", async () => {
    getActor.mockResolvedValue(admin);
    service.listOrders.mockResolvedValue(page([]));
    render(await OrdersSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.admin.orders.emptyTitle)).toBeTruthy();
  });

  it("drops a one-ended paid range and says so", async () => {
    getActor.mockResolvedValue(admin);
    service.listOrders.mockResolvedValue(page([order]));
    render(await OrdersSection({ searchParams: Promise.resolve({ paidFrom: "2026-10-11" }) }));
    expect(screen.getByText(th.admin.common.ignoredFilters)).toBeTruthy();
    expect(service.listOrders).toHaveBeenCalledWith(admin, { page: 1, pageSize: 20 });
  });
});
