/**
 * The orders service against a mocked repository: ownership scoping of the reads, the mapping of
 * a missing or foreign order to 404, and the sweep's use of the guarded failure transaction. The
 * transactions themselves (locks, guards, the cart return) run against a real database in
 * tests/integration (qa, T-033).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";
import type { Logger } from "@/server/logger";

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

function fakeLogger() {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  return log as typeof log & Logger;
}

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
    await expect(failOverdueOrders(15)).resolves.toEqual({ found: 3, failed: 2, errored: 0 });
    expect(repo.findOverdueOrderIds).toHaveBeenCalledWith(15, 100);
    expect(repo.failOrder.mock.calls).toEqual([
      ["o1", "TIMEOUT", "TIMEOUT"],
      ["o2", "TIMEOUT", "TIMEOUT"],
      ["o3", "TIMEOUT", "TIMEOUT"],
    ]);
  });

  it("an order that throws does not stop the sweep: counted, logged by class only (CR-T032-01)", async () => {
    const log = fakeLogger();
    repo.findOverdueOrderIds.mockResolvedValue(["o1", "o2", "o3", "o4"]);
    const timeout = Object.assign(new Error("row of Somchai 0812345678, 12 Sukhumvit"), {
      name: "PrismaClientKnownRequestError",
      code: "P2028",
    });
    repo.failOrder.mockImplementation(async (id) => {
      if (id === "o1") throw timeout;
      if (id === "o3") throw "not an error object 0899999999";
      return true;
    });

    await expect(failOverdueOrders(15, 100, log)).resolves.toEqual({
      found: 4,
      failed: 2,
      errored: 2,
    });
    expect(repo.failOrder.mock.calls.map(([id]) => id)).toEqual(["o1", "o2", "o3", "o4"]);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error.mock.calls[0]?.[1]).toEqual({
      component: "payment-timeout-sweep",
      errorName: "PrismaClientKnownRequestError",
      errorCode: "P2028",
    });
    expect(log.error.mock.calls[1]?.[1]).toEqual({
      component: "payment-timeout-sweep",
      errorName: undefined,
      errorCode: undefined,
    });
    const written = JSON.stringify(log.error.mock.calls);
    for (const leaked of ["0812345678", "Somchai", "Sukhumvit", "0899999999", "o1", "o3"]) {
      expect(written).not.toContain(leaked);
    }
  });

  it("a failure of the overdue lookup itself still rejects the run", async () => {
    repo.findOverdueOrderIds.mockRejectedValue(new Error("connection lost"));
    await expect(failOverdueOrders(15, 100, fakeLogger())).rejects.toThrow("connection lost");
    expect(repo.failOrder).not.toHaveBeenCalled();
  });

  it("refuses a timeout that is not a whole number of minutes of at least 1", async () => {
    for (const minutes of [0, -15, 1.5, Number.NaN]) {
      await expect(failOverdueOrders(minutes)).rejects.toThrow(RangeError);
    }
    expect(repo.findOverdueOrderIds).not.toHaveBeenCalled();
  });
});
