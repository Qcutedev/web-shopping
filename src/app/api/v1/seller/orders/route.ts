/**
 * GET /api/v1/seller/orders (docs/API_CONTRACTS.md section 5.7.3; REQ-S-07, BR-14, BR-35).
 * Access `seller (any store status)`: a suspended store still lists its seller orders. Only the
 * session's store's seller orders of paid orders; a `storeId` in the query is not interpreted.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `SELLER` (403 FORBIDDEN), 7 the
 * query (400), then the service. Paginated, newest first. An entry carries neither `paidAt` nor
 * the buyer's shipping address (owner ruling on Q42); `GET /seller/orders/{id}` does.
 */
import { listOwnSellerOrders, listSellerOrdersQuerySchema, queryRecord } from "@/modules/orders";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { paginated, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "SELLER");
    const query = parseInput(
      listSellerOrdersQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listOwnSellerOrders(actor, query);
    return paginated(page.items, page, { requestId });
  });
}
