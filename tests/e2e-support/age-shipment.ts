/**
 * SEC-072 e2e setup, run as `tsx tests/e2e-support/age-shipment.ts <sellerOrderId>`. A seller may
 * set `DELIVERED` only `SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED` hours after `Shipment.shippedAt`,
 * by the database clock. A journey that delivers right after shipping first moves that seller
 * order's `shippedAt` back by exactly that many hours in the e2e database: a time shift in the
 * data, never a weaker check. Under tests/ because only tests/** may import the database client
 * (CLAUDE.md rule 7).
 *
 * Refuses to do anything unless the connection is to `marketplace_e2e`.
 */
import { SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED } from "@/modules/orders/state";
import { db } from "@/server/db";
import { E2E_DATABASE_NAME } from "../../e2e/support/constants";

async function main(): Promise<void> {
  const sellerOrderId = process.argv[2];
  if (sellerOrderId === undefined || sellerOrderId === "") {
    throw new Error("usage: age-shipment.ts <sellerOrderId>");
  }
  const rows = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (rows[0]?.name !== E2E_DATABASE_NAME) {
    throw new Error("e2e age-shipment refused: the connection is not to the end-to-end database.");
  }
  const updated = await db.$executeRaw`
    UPDATE "Shipment"
       SET "shippedAt" = "shippedAt"
                         - ${SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED}::int * interval '1 hour'
     WHERE "sellerOrderId" = ${sellerOrderId} AND "deliveredAt" IS NULL`;
  if (updated !== 1) throw new Error("e2e age-shipment: no undelivered shipment for that id.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "e2e age-shipment failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
