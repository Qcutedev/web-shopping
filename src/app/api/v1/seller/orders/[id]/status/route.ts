/**
 * POST /api/v1/seller/orders/{id}/status (docs/API_CONTRACTS.md sections 3.2 and 5.7.3;
 * REQ-S-08, BR-14, BR-15, BR-21, BR-29, BR-35). Body `{ to, carrierName?, trackingNumber? }`.
 * Access `seller (any store status)`: the seller of a suspended store still fulfils (BR-14), so
 * the store status is not judged. Shipping is simulated: no carrier is contacted.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `SELLER` (403 FORBIDDEN), 6 the body (413), 7 the path parameter and the body (400),
 * then the service (404 for an unknown, foreign, or unpaid seller order; 409
 * INVALID_STATE_TRANSITION for a move the table does not allow). No rate limit (section 6).
 */
import {
  changeSellerOrderStatus,
  sellerOrderIdParamsSchema,
  sellerOrderStatusBodySchema,
} from "@/modules/orders";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { getEnv } from "@/server/env";
import {
  assertContentType,
  assertSameOrigin,
  JSON_CONTENT_TYPE,
  ok,
  parseInput,
  readJsonBody,
} from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/seller/orders/[id]/status">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "SELLER");
    const raw = await readJsonBody(request);
    const { id } = parseInput(sellerOrderIdParamsSchema, await context.params);
    const body = parseInput(sellerOrderStatusBodySchema, raw);
    return ok(await changeSellerOrderStatus(actor, id, body), { requestId });
  });
}
