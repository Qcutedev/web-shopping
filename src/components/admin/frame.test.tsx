import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { th } from "@/i18n/th";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/api-client/admin", () => ({}));

import { AdminFrame } from "./admin-frame";
import { AdminSkeleton } from "./load-state";

describe("AdminFrame", () => {
  it("has one h1, a named navigation to every admin page, and marks the current one", () => {
    render(
      <AdminFrame current="orders" heading="คำสั่งซื้อ" description="รายละเอียด">
        <p>เนื้อหา</p>
      </AdminFrame>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: th.admin.navLabel });
    expect(within(nav).getAllByRole("link")).toHaveLength(11);
    const current = within(nav).getByRole("link", { name: th.admin.nav.orders });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("href")).toBe("/admin/orders");
    expect(
      within(nav).getByRole("link", { name: th.admin.nav.users }).hasAttribute("aria-current"),
    ).toBe(false);
    expect(
      within(nav).getByRole("link", { name: th.admin.nav.auditLogs }).getAttribute("href"),
    ).toBe("/admin/audit-logs");
  });
});

describe("AdminSkeleton", () => {
  it("announces the loading state and is busy", () => {
    const { container } = render(<AdminSkeleton rows={2} />);
    expect(screen.getByRole("status").textContent).toBe(th.admin.loading);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });
});
