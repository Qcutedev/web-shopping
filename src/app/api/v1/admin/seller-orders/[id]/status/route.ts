/**
 * POST /api/v1/admin/seller-orders/{id}/status (docs/API_CONTRACTS.md sections 3.2 and 5.9.5;
 * REQ-A-07, BR-15, BR-20, BR-21, BR-27, BR-29). Access `admin`. Body `{ to }`, `CANCELLED` or
 * `DELIVERED`. Answers the whole order after the change; an audit row is written. Shipping is
 * simulated; no refund is recorded.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `ADMIN` (403 FORBIDDEN), 6 the body (413), 7 the path parameter and the body (400),
 * then the service (404; 409 INVALID_STATE_TRANSITION).
 */
import {
  adminSellerOrderStatusBodySchema,
  changeSellerOrderStatus,
  idParamsSchema,
} from "@/modules/admin";
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
  context: RouteContext<"/api/v1/admin/seller-orders/[id]/status">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const raw = await readJsonBody(request);
    const { id } = parseInput(idParamsSchema, await context.params);
    const body = parseInput(adminSellerOrderStatusBodySchema, raw);
    return ok(await changeSellerOrderStatus(actor, id, body), { requestId });
  });
}
