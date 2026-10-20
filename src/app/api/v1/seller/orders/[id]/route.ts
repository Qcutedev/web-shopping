/**
 * GET /api/v1/seller/orders/{id} (docs/API_CONTRACTS.md section 5.7.3; REQ-S-07, BR-09, BR-14,
 * BR-35, BR-39). `{id}` is a seller order id. Access `seller (any store status)`. Another store's
 * seller order, and one whose order is not paid, is 404 exactly like an unknown id: the service
 * looks it up by id, the session's store, and a paid order together.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `SELLER` (403), 7 the path
 * parameter (400), then the service (404).
 */
import { getOwnSellerOrder, sellerOrderIdParamsSchema } from "@/modules/orders";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { ok, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/seller/orders/[id]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "SELLER");
    const { id } = parseInput(sellerOrderIdParamsSchema, await context.params);
    return ok(await getOwnSellerOrder(actor, id), { requestId });
  });
}
