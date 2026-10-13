import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { AddressDto } from "@/modules/profile/schema";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const api = {
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
};
vi.mock("@/lib/api-client/me", () => ({
  createAddress: (...args: unknown[]) => api.createAddress(...args),
  updateAddress: (...args: unknown[]) => api.updateAddress(...args),
  deleteAddress: (...args: unknown[]) => api.deleteAddress(...args),
}));

import { AddressBook } from "./address-book";

const NAME = "สมชาย ใจดี";

function address(overrides: Partial<AddressDto> = {}): AddressDto {
  return {
    id: "a1",
    recipientName: NAME,
    phone: "0812345678",
    line1: "99/1 ถนนสุขุมวิท",
    subdistrict: "คลองตัน",
    district: "คลองเตย",
    province: "กรุงเทพมหานคร",
    postalCode: "10110",
    isDefault: false,
    ...overrides,
  };
}

const NOT_FOUND = { ok: false, status: 404, code: "NOT_FOUND", fields: [], requestId: null };

function renderBook(addresses: AddressDto[], total = addresses.length) {
  return render(
    <AddressBook addresses={addresses} total={total} firstPageHref="/account/addresses" />,
  );
}

function button(name: string) {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  refresh.mockReset();
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe("AddressBook", () => {
  it("shows the empty state with the add action when there is no address", () => {
    renderBook([]);
    expect(screen.getByText(th.account.addresses.emptyTitle)).toBeTruthy();
    expect(button(th.account.addresses.add)).toBeTruthy();
  });

  it("offers a way back when the page is past the last one", () => {
    renderBook([], 3);
    const link = screen.getByRole("link", { name: th.account.addresses.pageEmptyAction });
    expect(link.getAttribute("href")).toBe("/account/addresses");
  });

  it("renders every user-typed value through bdi and marks the default", () => {
    const { container } = renderBook([address({ isDefault: true, recipientName: "<b>x</b>" })]);
    const texts = [...container.querySelectorAll("bdi")].map((node) => node.textContent);
    expect(texts).toContain("<b>x</b>");
    expect(texts).toContain("99/1 ถนนสุขุมวิท");
    expect(container.querySelector("li b")).toBeNull();
    expect(screen.getByText(th.account.addresses.defaultBadge)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ตั้งที่อยู่ของ/ })).toBeNull();
  });

  it("creates an address through the form, confirms, and refreshes", async () => {
    const user = userEvent.setup();
    api.createAddress.mockResolvedValue({ ok: true, status: 201, data: address() });
    renderBook([]);
    await user.click(button(th.account.addresses.add));
    const f = th.account.addresses.fields;
    await user.type(screen.getByLabelText(f.recipientName), "สมชาย");
    await user.type(screen.getByLabelText(f.phone), "0812345678");
    await user.type(screen.getByLabelText(f.line1), "99/1");
    await user.type(screen.getByLabelText(f.subdistrict), "คลองตัน");
    await user.type(screen.getByLabelText(f.district), "คลองเตย");
    await user.type(screen.getByLabelText(f.province), "กรุงเทพมหานคร");
    await user.type(screen.getByLabelText(f.postalCode), "10110");
    await user.click(screen.getByLabelText(th.account.addresses.isDefault));
    await user.click(button(th.account.common.save));

    expect(api.createAddress).toHaveBeenCalledWith({
      recipientName: "สมชาย",
      phone: "0812345678",
      line1: "99/1",
      subdistrict: "คลองตัน",
      district: "คลองเตย",
      province: "กรุงเทพมหานคร",
      postalCode: "10110",
      isDefault: true,
    });
    expect(await screen.findByText(th.account.addresses.created)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a four-digit postal code on the client and sends nothing", async () => {
    const user = userEvent.setup();
    renderBook([]);
    await user.click(button(th.account.addresses.add));
    const f = th.account.addresses.fields;
    await user.type(screen.getByLabelText(f.recipientName), "ก");
    await user.type(screen.getByLabelText(f.phone), "0812345678");
    await user.type(screen.getByLabelText(f.line1), "1");
    await user.type(screen.getByLabelText(f.subdistrict), "ก");
    await user.type(screen.getByLabelText(f.district), "ก");
    await user.type(screen.getByLabelText(f.province), "ก");
    await user.type(screen.getByLabelText(f.postalCode), "1011");
    await user.click(button(th.account.common.save));
    expect(api.createAddress).not.toHaveBeenCalled();
    expect(screen.getByText(th.account.fieldErrors.postalCode.invalid)).toBeTruthy();
  });

  it("edits an address with the stored values prefilled", async () => {
    const user = userEvent.setup();
    api.updateAddress.mockResolvedValue({
      ok: true,
      status: 200,
      data: address({ province: "นนทบุรี" }),
    });
    renderBook([address()]);
    await user.click(button(fill(th.account.addresses.editLabel, { name: NAME })));
    const province = screen.getByLabelText(th.account.addresses.fields.province);
    expect((province as HTMLInputElement).value).toBe("กรุงเทพมหานคร");
    await user.clear(province);
    await user.type(province, "นนทบุรี");
    await user.click(button(th.account.common.save));
    expect(api.updateAddress).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ province: "นนทบุรี", postalCode: "10110" }),
    );
    expect(await screen.findByText(th.account.addresses.updated)).toBeTruthy();
  });

  it("sets the default with only isDefault in the body", async () => {
    const user = userEvent.setup();
    api.updateAddress.mockResolvedValue({
      ok: true,
      status: 200,
      data: address({ isDefault: true }),
    });
    renderBook([address()]);
    await user.click(button(fill(th.account.addresses.setDefaultLabel, { name: NAME })));
    expect(api.updateAddress).toHaveBeenCalledWith("a1", { isDefault: true });
    expect(await screen.findByText(th.account.addresses.defaultSet)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("asks for confirmation before deleting, and deletes only after it", async () => {
    const user = userEvent.setup();
    api.deleteAddress.mockResolvedValue({ ok: true, status: 200, data: { deleted: true } });
    renderBook([address()]);
    await user.click(button(fill(th.account.addresses.deleteLabel, { name: NAME })));
    expect(api.deleteAddress).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: th.account.addresses.deleteConfirmAction }),
    );
    expect(api.deleteAddress).toHaveBeenCalledWith("a1");
    expect(await screen.findByText(th.account.addresses.deleted)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("cancels a deletion without a request", async () => {
    const user = userEvent.setup();
    renderBook([address()]);
    await user.click(button(fill(th.account.addresses.deleteLabel, { name: NAME })));
    await user.click(button(th.account.common.cancel));
    expect(api.deleteAddress).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows a Thai error and refreshes when the address is already gone (404)", async () => {
    const user = userEvent.setup();
    api.deleteAddress.mockResolvedValue(NOT_FOUND);
    renderBook([address()]);
    await user.click(button(fill(th.account.addresses.deleteLabel, { name: NAME })));
    await user.click(button(th.account.addresses.deleteConfirmAction));
    expect(await screen.findByText(th.errors.notFound)).toBeTruthy();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the network error and keeps the list when a request cannot be sent", async () => {
    const user = userEvent.setup();
    api.updateAddress.mockResolvedValue({
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      fields: [],
      requestId: null,
    });
    renderBook([address()]);
    await user.click(button(fill(th.account.addresses.setDefaultLabel, { name: NAME })));
    expect(await screen.findByText(th.errors.network)).toBeTruthy();
    expect(screen.getByText(NAME)).toBeTruthy();
  });
});

describe("AddressBook clipping (SEC-042 display part)", () => {
  it("clips every user-typed value, and its row, when a value carries 1,000 combining marks", () => {
    const stacked = "ก" + "́".repeat(1000);
    const { container } = renderBook([
      address({ recipientName: stacked, line1: stacked, province: stacked }),
    ]);
    const names = [...container.querySelectorAll("li bdi")];
    expect(names.length).toBe(5);
    for (const node of names) {
      expect(node.parentElement?.classList.contains("overflow-hidden")).toBe(true);
      expect(node.parentElement?.classList.contains("max-w-full")).toBe(true);
    }
    expect(names[0]?.textContent).toBe(stacked);
  });
});
