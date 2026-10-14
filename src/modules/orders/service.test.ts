/**
 * The orders service against a mocked repository: ownership scoping of the reads, the mapping of
 * a missing or foreign order to 404, and the sweep's use of the guarded failure transaction. The
 * transactions themselves (locks, guards, the cart return) run against a real database in
 * tests/integration (qa, T-033).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

import type { OrderRow } from "./mapping";
import * as repository from "./repository";
import {
  completeOrderPayment,
  failOrderPayment,
  failOverdueOrders,
  getOrder,
  listOrders,
  readOrderOfUser,
} from "./service";

vi.mock("./repository", () => ({
  findOwnedOrder: vi.fn(),
  findOrdersOfUser: vi.fn(),
  findOverdueOrderIds: vi.fn(),
  markOrderPaid: vi.fn(),
  failOrder: vi.fn(),
}));

const repo = vi.mocked(repository);

const ME: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});

const ROW: OrderRow = {
  id: "order_1",
  orderNumber: "OD2610140000001",
  createdAt: new Date("2026-10-14T00:00:00Z"),
  paidAt: null,
  paymentStatus: "PENDING",
  itemsSubtotalSatang: 100,
  shippingTotalSatang: 0,
  grandTotalSatang: 100,
  shipRecipientName: "a",
  shipPhone: "0812345678",
  shipLine1: "b",
  shipSubdistrict: "c",
  shipDistrict: "d",
  shipProvince: "e",
  shipPostalCode: "10110",
  payment: { provider: "MOCK", failureReason: null },
  sellerOrders: [],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getOrder (REQ-C-13)", () => {
  it("reads the order scoped by the actor's own user id", async () => {
    repo.findOwnedOrder.mockResolvedValue(ROW);
    const dto = await getOrder(ME, "order_1");
    expect(dto.id).toBe("order_1");
    expect(repo.findOwnedOrder).toHaveBeenCalledWith("user_me", "order_1");
  });

  it("a missing or another user's order is 404 with empty details", async () => {
    repo.findOwnedOrder.mockResolvedValue(null);
    const error = await getOrder(ME, "order_x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(404);
    expect((error as AppError).details).toEqual({});
  });
});

describe("listOrders (REQ-C-13, REQ-N-06)", () => {
  it("lists the actor's own orders only, with the page envelope", async () => {
    repo.findOrdersOfUser.mockResolvedValue({ rows: [ROW], total: 41 });
    const page = await listOrders(ME, { page: 3, pageSize: 20 });
    expect(repo.findOrdersOfUser).toHaveBeenCalledWith("user_me", { page: 3, pageSize: 20 });
    expect(page).toMatchObject({ page: 3, pageSize: 20, total: 41 });
    expect(page.items.map((order) => order.id)).toEqual(["order_1"]);
  });
});

describe("readOrderOfUser", () => {
  it("is scoped by the user and fails loudly when the order is not there", async () => {
    repo.findOwnedOrder.mockResolvedValue(null);
    await expect(readOrderOfUser("user_me", "order_1")).rejects.toThrow();
    expect(repo.findOwnedOrder).toHaveBeenCalledWith("user_me", "order_1");
  });
});

describe("payment moves (D-023 point 5)", () => {
  it("completion and decline go through the guarded transactions", async () => {
    repo.markOrderPaid.mockResolvedValue(true);
    repo.failOrder.mockResolvedValue(false);
    await expect(completeOrderPayment("order_1", "MOCK-x")).resolves.toBe(true);
    await expect(failOrderPayment("order_1", "SIMULATED_DECLINE")).resolves.toBe(false);
    expect(repo.markOrderPaid).toHaveBeenCalledWith("order_1", "MOCK-x");
    expect(repo.failOrder).toHaveBeenCalledWith(
      "order_1",
      "PROVIDER_DECLINED",
      "SIMULATED_DECLINE",
    );
  });
});

describe("failOverdueOrders (BR-20 timeout, D-028)", () => {
  it("fails each overdue order through the same failure transaction, reason TIMEOUT", async () => {
    repo.findOverdueOrderIds.mockResolvedValue(["o1", "o2", "o3"]);
    repo.failOrder.mockImplementation(async (id) => id !== "o2");
    await expect(failOverdueOrders(15)).resolves.toEqual({ found: 3, failed: 2 });
    expect(repo.findOverdueOrderIds).toHaveBeenCalledWith(15, 100);
    expect(repo.failOrder.mock.calls).toEqual([
      ["o1", "TIMEOUT", "TIMEOUT"],
      ["o2", "TIMEOUT", "TIMEOUT"],
      ["o3", "TIMEOUT", "TIMEOUT"],
    ]);
  });

  it("refuses a timeout that is not a whole number of minutes of at least 1", async () => {
    for (const minutes of [0, -15, 1.5, Number.NaN]) {
      await expect(failOverdueOrders(minutes)).rejects.toThrow(RangeError);
    }
    expect(repo.findOverdueOrderIds).not.toHaveBeenCalled();
  });
});
