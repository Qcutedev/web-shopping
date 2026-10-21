import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { notFound } from "@/server/errors";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super("redirect");
  }
}

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
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
const listOwnProducts = vi.fn();
const getOwnProduct = vi.fn();
vi.mock("@/modules/inventory", () => ({
  listOwnProducts: (...args: unknown[]) => listOwnProducts(...args),
  getOwnProduct: (...args: unknown[]) => getOwnProduct(...args),
}));
const listCategories = vi.fn();
vi.mock("@/modules/catalog", () => ({
  listCategories: (...args: unknown[]) => listCategories(...args),
}));

const api = {
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  changeStock: vi.fn(),
  runProductAction: vi.fn(),
  deleteProduct: vi.fn(),
  uploadImage: vi.fn(),
};
vi.mock("@/lib/api-client/seller", () => ({
  createProduct: (...args: unknown[]) => api.createProduct(...args),
  updateProduct: (...args: unknown[]) => api.updateProduct(...args),
  changeStock: (...args: unknown[]) => api.changeStock(...args),
  runProductAction: (...args: unknown[]) => api.runProductAction(...args),
  deleteProduct: (...args: unknown[]) => api.deleteProduct(...args),
  uploadImage: (...args: unknown[]) => api.uploadImage(...args),
}));

import { ProductActions } from "./product-actions";
import { ProductForm } from "./product-form";
import { NewProductSection, ProductDetailSection } from "./product-sections";
import { ProductsSection } from "./products-section";
import { StockPanel } from "./stock-panel";

const seller = { userId: "u2", role: "SELLER", storeId: "s1", storeStatus: "APPROVED" };

const product = {
  id: "p1",
  slug: "s",
  title: "เสื้อยืด",
  description: "รายละเอียด",
  sku: "SKU-1",
  category: { id: "c1", name: "แฟชั่น", isActive: true },
  priceSatang: 25_900,
  stock: 4,
  lowStock: true,
  soldOut: false,
  status: "PUBLISHED" as const,
  moderationStatus: "APPROVED" as const,
  moderationNote: null,
  images: [],
  isSample: false,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

function failure(code: string, status: number, reason?: string) {
  return {
    ok: false as const,
    status,
    code,
    ...(reason ? { reason } : {}),
    fields: [],
    requestId: null,
  };
}

beforeEach(() => {
  getActor.mockReset();
  getOwnStore.mockReset();
  listOwnProducts.mockReset();
  getOwnProduct.mockReset();
  listCategories.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  refresh.mockReset();
  push.mockReset();
  listCategories.mockResolvedValue({
    items: [{ id: "c1", name: "แฟชั่น", slug: "fashion", isSample: false }],
    page: 1,
    pageSize: 50,
    total: 1,
  });
});

describe("ProductsSection", () => {
  it("lists with the query of the address bar, scoped to the session's actor", async () => {
    getActor.mockResolvedValue(seller);
    listOwnProducts.mockResolvedValue({ items: [product], page: 1, pageSize: 20, total: 21 });
    render(
      await ProductsSection({
        searchParams: Promise.resolve({ lowStock: "true", status: "PUBLISHED" }),
      }),
    );
    expect(listOwnProducts).toHaveBeenCalledWith(seller, {
      page: 1,
      pageSize: 20,
      lowStock: true,
      status: "PUBLISHED",
    });
    const list = screen.getByRole("list", { name: th.seller.products.listLabel });
    expect(within(list).getByText("เสื้อยืด")).toBeTruthy();
    expect(within(list).getByText(th.seller.products.row.lowStock)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: th.pagination.label })).toBeTruthy();
    expect(screen.getByRole("link", { name: th.pagination.next }).getAttribute("href")).toBe(
      "/seller/products?status=PUBLISHED&lowStock=true&page=2",
    );
  });

  it("falls back to the unfiltered first page for an invalid query", async () => {
    getActor.mockResolvedValue(seller);
    listOwnProducts.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    render(await ProductsSection({ searchParams: Promise.resolve({ status: "NOPE" }) }));
    expect(listOwnProducts).toHaveBeenCalledWith(seller, { page: 1, pageSize: 20 });
  });

  it("shows the empty state with the add action when the store has no products", async () => {
    getActor.mockResolvedValue(seller);
    listOwnProducts.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    render(await ProductsSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.seller.products.emptyTitle)).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: th.seller.products.add })[0]?.getAttribute("href"),
    ).toBe("/seller/products/new");
  });

  it("shows a filtered empty state with a reset link", async () => {
    getActor.mockResolvedValue(seller);
    listOwnProducts.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    render(await ProductsSection({ searchParams: Promise.resolve({ soldOut: "true" }) }));
    expect(screen.getByText(th.seller.products.filteredEmptyTitle)).toBeTruthy();
  });

  it("shows a link to the first page when the page is past the last", async () => {
    getActor.mockResolvedValue(seller);
    listOwnProducts.mockResolvedValue({ items: [], page: 9, pageSize: 20, total: 3 });
    render(await ProductsSection({ searchParams: Promise.resolve({ page: "9" }) }));
    expect(screen.getByText(th.seller.products.pageEmptyTitle)).toBeTruthy();
  });

  it("confirms a delete announced by the product page", async () => {
    getActor.mockResolvedValue(seller);
    listOwnProducts.mockResolvedValue({ items: [product], page: 1, pageSize: 20, total: 1 });
    render(await ProductsSection({ searchParams: Promise.resolve({ removed: "deleted" }) }));
    expect(screen.getByText(th.seller.products.actions.deleted)).toBeTruthy();
  });

  it("hides the add link for a suspended store but still lists", async () => {
    getActor.mockResolvedValue({ ...seller, storeStatus: "SUSPENDED" });
    getOwnStore.mockResolvedValue({ statusReason: null });
    listOwnProducts.mockResolvedValue({ items: [product], page: 1, pageSize: 20, total: 1 });
    render(await ProductsSection({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("link", { name: th.seller.products.add })).toBeNull();
    expect(screen.getByText("เสื้อยืด")).toBeTruthy();
    expect(screen.getByText(th.seller.suspended.title)).toBeTruthy();
  });

  it("shows the error state when the list cannot be read", async () => {
    getActor.mockResolvedValue(seller);
    listOwnProducts.mockRejectedValue(new Error("db down"));
    render(await ProductsSection({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(th.errors.loadFailed)).toBeTruthy();
  });
});

describe("ProductDetailSection", () => {
  const props = (id = "p1", search: Record<string, string> = {}) => ({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(search),
  });

  it("reads the product of the actor by id and shows the moderation message", async () => {
    getActor.mockResolvedValue(seller);
    getOwnProduct.mockResolvedValue({
      ...product,
      moderationStatus: "REJECTED",
      moderationNote: "รูปไม่ชัด",
    });
    render(await ProductDetailSection(props("p1", { created: "1" })));
    expect(getOwnProduct).toHaveBeenCalledWith(seller, "p1");
    expect(screen.getByText(th.seller.products.rejectedTitle)).toBeTruthy();
    expect(screen.getByText("รูปไม่ชัด")).toBeTruthy();
    expect(screen.getByText(th.seller.products.created)).toBeTruthy();
    expect(screen.getByText(th.seller.products.resubmitNote)).toBeTruthy();
  });

  it("shows the same not-found state for an unknown or foreign id", async () => {
    getActor.mockResolvedValue(seller);
    getOwnProduct.mockRejectedValue(notFound());
    render(await ProductDetailSection(props("someone-elses")));
    expect(screen.getByText(th.seller.guard.notFoundTitle)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: th.seller.products.backToList }).getAttribute("href"),
    ).toBe("/seller/products");
  });

  it("locks the write controls of a suspended store", async () => {
    getActor.mockResolvedValue({ ...seller, storeStatus: "SUSPENDED" });
    getOwnStore.mockResolvedValue({ statusReason: null });
    getOwnProduct.mockResolvedValue(product);
    render(await ProductDetailSection(props()));
    expect(screen.getByText(th.seller.products.suspendedNote)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: th.seller.products.form.save }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: th.seller.products.actions.archive,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("locks an archived product", async () => {
    getActor.mockResolvedValue(seller);
    getOwnProduct.mockResolvedValue({ ...product, status: "ARCHIVED" });
    render(await ProductDetailSection(props()));
    expect(screen.getByText(th.seller.products.archivedNote)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: th.seller.products.form.save }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("create product", () => {
  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(new RegExp(th.seller.products.form.title)), "เสื้อ");
    await user.type(screen.getByLabelText(new RegExp(th.seller.products.form.description)), "ดี");
    await user.type(screen.getByLabelText(new RegExp("รหัสสินค้า \\(SKU\\)")), "SKU-9");
    await user.selectOptions(
      screen.getByLabelText(new RegExp(th.seller.products.form.category)),
      "c1",
    );
    await user.type(screen.getByLabelText(new RegExp("ราคา \\(บาท\\)")), "259.50");
    await user.type(screen.getByLabelText(new RegExp(th.seller.products.form.stock)), "10");
  }

  it("shows Thai messages for an empty form and sends nothing", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(seller);
    render(await NewProductSection());
    await user.click(screen.getByRole("button", { name: th.seller.products.form.create }));
    expect(screen.getByText(th.seller.fieldErrors.title.required)).toBeTruthy();
    expect(screen.getByText(th.seller.fieldErrors.priceSatang.required)).toBeTruthy();
    expect(api.createProduct).not.toHaveBeenCalled();
  });

  it("sends price in satang, disables submit while pending, and opens the new product", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(seller);
    let finish: (value: unknown) => void = () => {};
    api.createProduct.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(await NewProductSection());
    await fillForm(user);
    const submit = screen.getByRole("button", { name: th.seller.products.form.create });
    await user.click(submit);
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(api.createProduct).toHaveBeenCalledTimes(1);
    expect(api.createProduct).toHaveBeenCalledWith({
      title: "เสื้อ",
      description: "ดี",
      sku: "SKU-9",
      categoryId: "c1",
      priceSatang: 25_950,
      stock: 10,
    });
    finish({ ok: true, status: 201, data: { ...product, id: "new1" } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/seller/products/new1?created=1"));
  });

  it("puts a duplicate SKU under the SKU field and re-enables submit", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(seller);
    api.createProduct.mockResolvedValue(failure("CONFLICT", 409, "DUPLICATE_SKU"));
    render(await NewProductSection());
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: th.seller.products.form.create }));
    expect(await screen.findByText(th.seller.errors.reasons.DUPLICATE_SKU)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: th.seller.products.form.create }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows the product limit message from the server's reason", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(seller);
    api.createProduct.mockResolvedValue(failure("CONFLICT", 409, "PRODUCT_LIMIT"));
    render(await NewProductSection());
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: th.seller.products.form.create }));
    expect(await screen.findByText(th.seller.errors.reasons.PRODUCT_LIMIT)).toBeTruthy();
  });
});

describe("edit product", () => {
  it("sends only the changed field, then shows the saved confirmation", async () => {
    const user = userEvent.setup();
    getActor.mockResolvedValue(seller);
    getOwnProduct.mockResolvedValue(product);
    api.updateProduct.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...product, title: "ชื่อใหม่", moderationStatus: "PENDING" },
    });
    render(
      await ProductDetailSection({
        params: Promise.resolve({ id: "p1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    const title = screen.getByLabelText(new RegExp(th.seller.products.form.title));
    await user.clear(title);
    await user.type(title, "ชื่อใหม่");
    await user.click(screen.getByRole("button", { name: th.seller.products.form.save }));
    expect(api.updateProduct).toHaveBeenCalledWith("p1", { title: "ชื่อใหม่" });
    expect(await screen.findByText(th.seller.products.form.saved)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("ProductActions", () => {
  const draft = { id: "p1", status: "DRAFT" as const, moderationStatus: "PENDING" as const };

  it("publishes and says it waits for review when not yet approved", async () => {
    const user = userEvent.setup();
    api.runProductAction.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...product, status: "PUBLISHED", moderationStatus: "PENDING" },
    });
    render(<ProductActions product={draft} />);
    await user.click(screen.getByRole("button", { name: th.seller.products.actions.publish }));
    expect(api.runProductAction).toHaveBeenCalledWith("p1", "publish");
    expect(await screen.findByText(th.seller.products.actions.publishedPending)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("asks before archiving, and cancelling sends nothing", async () => {
    const user = userEvent.setup();
    render(<ProductActions product={{ ...draft, status: "PUBLISHED" }} />);
    await user.click(screen.getByRole("button", { name: th.seller.products.actions.archive }));
    expect(screen.getByText(th.seller.products.actions.archiveConfirm)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: th.seller.common.cancel }));
    expect(api.runProductAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: th.seller.products.actions.archive }));
    api.runProductAction.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...product, status: "ARCHIVED" },
    });
    await user.click(
      screen.getByRole("button", { name: th.seller.products.actions.archiveConfirmAction }),
    );
    expect(api.runProductAction).toHaveBeenCalledWith("p1", "archive");
    expect(await screen.findByText(th.seller.products.actions.archived)).toBeTruthy();
  });

  it("goes back to the list after a real delete", async () => {
    const user = userEvent.setup();
    api.deleteProduct.mockResolvedValue({ ok: true, status: 200, data: { outcome: "DELETED" } });
    render(<ProductActions product={draft} />);
    await user.click(screen.getByRole("button", { name: th.seller.products.actions.delete }));
    await user.click(
      screen.getByRole("button", { name: th.seller.products.actions.deleteConfirmAction }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/seller/products?removed=deleted"));
  });

  it("explains that a product with orders was archived instead of deleted", async () => {
    const user = userEvent.setup();
    api.deleteProduct.mockResolvedValue({ ok: true, status: 200, data: { outcome: "ARCHIVED" } });
    render(<ProductActions product={draft} />);
    await user.click(screen.getByRole("button", { name: th.seller.products.actions.delete }));
    await user.click(
      screen.getByRole("button", { name: th.seller.products.actions.deleteConfirmAction }),
    );
    expect(await screen.findByText(th.seller.products.actions.deletedArchived)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the server's refusal as Thai copy and refreshes the page", async () => {
    const user = userEvent.setup();
    api.runProductAction.mockResolvedValue(failure("INVALID_STATE_TRANSITION", 409));
    render(<ProductActions product={draft} />);
    await user.click(screen.getByRole("button", { name: th.seller.products.actions.publish }));
    expect(await screen.findByText(th.seller.errors.invalidTransition)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("StockPanel", () => {
  it("sets an absolute stock and shows the server's new stock", async () => {
    const user = userEvent.setup();
    api.changeStock.mockResolvedValue({ ok: true, status: 200, data: { ...product, stock: 50 } });
    render(<StockPanel product={{ id: "p1", stock: 4 }} />);
    await user.type(screen.getByLabelText(th.seller.products.stock.set), "50");
    await user.click(screen.getByRole("button", { name: th.seller.products.stock.setAction }));
    expect(api.changeStock).toHaveBeenCalledWith("p1", { set: 50 });
    expect(await screen.findByText(th.seller.products.stock.updated)).toBeTruthy();
    expect(screen.getByText("50 ชิ้น")).toBeTruthy();
  });

  it("sends a negative adjustment and shows the refusal without changing the stock", async () => {
    const user = userEvent.setup();
    api.changeStock.mockResolvedValue(failure("CONFLICT", 409, "NEGATIVE_STOCK"));
    render(<StockPanel product={{ id: "p1", stock: 4 }} />);
    await user.type(screen.getByLabelText(th.seller.products.stock.adjust), "-9");
    await user.click(screen.getByRole("button", { name: th.seller.products.stock.adjustAction }));
    expect(api.changeStock).toHaveBeenCalledWith("p1", { adjust: -9 });
    expect(await screen.findByText(th.seller.errors.reasons.NEGATIVE_STOCK)).toBeTruthy();
    expect(screen.getByText("4 ชิ้น")).toBeTruthy();
  });

  it("refuses zero and fractions before any request", async () => {
    const user = userEvent.setup();
    render(<StockPanel product={{ id: "p1", stock: 4 }} />);
    await user.type(screen.getByLabelText(th.seller.products.stock.adjust), "0");
    await user.click(screen.getByRole("button", { name: th.seller.products.stock.adjustAction }));
    expect(screen.getByText(th.seller.fieldErrors.adjust.invalid)).toBeTruthy();
    expect(api.changeStock).not.toHaveBeenCalled();
  });

  it("is disabled for a suspended store", () => {
    render(<StockPanel product={{ id: "p1", stock: 4 }} disabled />);
    expect(
      (
        screen.getByRole("button", {
          name: th.seller.products.stock.setAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("StockPanel follows the stored stock (CR-99)", () => {
  it("shows the new stock when the page passes a new value", () => {
    const { rerender } = render(<StockPanel product={{ id: "p1", stock: 4 }} />);
    rerender(<StockPanel product={{ id: "p1", stock: 9 }} />);
    expect(
      screen.getByText(fill(th.seller.products.stock.currentCount, { count: 9 })),
    ).toBeTruthy();
  });
});

describe("ProductForm follows the stored product (CR-99)", () => {
  it("shows the stored title when the page passes a changed product", () => {
    const categories = [{ id: "c1", name: "x", isActive: true }];
    const { rerender } = render(<ProductForm product={product} categories={categories} />);
    rerender(
      <ProductForm product={{ ...product, title: "stored-title" }} categories={categories} />,
    );
    expect(
      (screen.getByLabelText(new RegExp(th.seller.products.form.title)) as HTMLInputElement).value,
    ).toBe("stored-title");
  });
});

describe("ProductForm images and copy (CR-101, CR-103)", () => {
  const categories = [{ id: "c1", name: "x", isActive: true }];

  it("says a product description may be 5,000 characters, not 2,000", async () => {
    const user = userEvent.setup();
    render(<ProductForm categories={categories} />);
    fireEvent.change(screen.getByLabelText(new RegExp(th.seller.products.form.description)), {
      target: { value: "ก".repeat(5001) },
    });
    await user.click(screen.getByRole("button", { name: th.seller.products.form.create }));
    expect(screen.getByText(th.seller.fieldErrors.productDescription.tooLong)).toBeTruthy();
    expect(
      screen.getByText(th.seller.fieldErrors.productDescription.tooLong).textContent,
    ).toContain("5,000");
  });

  it("holds the save button while a picture uploads", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    api.uploadImage.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { container } = render(<ProductForm categories={categories} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["abc"], "a.png", { type: "image/png" }));
    const save = screen.getByRole("button", {
      name: th.seller.products.form.create,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    finish({
      ok: true,
      status: 201,
      data: { key: "k1", url: "/api/files/k1", contentType: "image/png", sizeBytes: 3 },
    });
    await screen.findByText(th.seller.images.uploaded);
    expect(save.disabled).toBe(false);
  });

  it("says when files beyond the limit are left out", async () => {
    const user = userEvent.setup();
    const images = Array.from({ length: 7 }, (_, index) => ({ key: `k${index}`, url: "/x" }));
    api.uploadImage.mockResolvedValue({
      ok: true,
      status: 201,
      data: { key: "new", url: "/api/files/new", contentType: "image/png", sizeBytes: 3 },
    });
    const { container } = render(
      <ProductForm product={{ ...product, images }} categories={categories} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
      new File(["c"], "c.png", { type: "image/png" }),
    ]);
    expect(await screen.findByText(fill(th.seller.images.skipped, { count: 2 }))).toBeTruthy();
    expect(api.uploadImage).toHaveBeenCalledTimes(1);
  });
});

describe("product page ids (CR-106) and counts (CR-105)", () => {
  it("shows not-found for an id that cannot be one, without calling the service", async () => {
    getActor.mockResolvedValue(seller);
    render(
      await ProductDetailSection({
        params: Promise.resolve({ id: "x".repeat(201) }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText(th.seller.guard.notFoundTitle)).toBeTruthy();
    expect(getOwnProduct).not.toHaveBeenCalled();
  });

  it("groups thousands in the stock panel", () => {
    render(<StockPanel product={{ id: "p1", stock: 12345 }} />);
    expect(
      screen.getByText(fill(th.seller.products.stock.currentCount, { count: "12,345" })),
    ).toBeTruthy();
  });
});
