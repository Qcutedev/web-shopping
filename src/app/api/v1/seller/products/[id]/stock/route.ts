/**
 * PATCH /api/v1/seller/products/{id}/stock (docs/API_CONTRACTS.md section 5.7.2; REQ-S-06,
 * BR-34). Access `seller`. Body `{ set }` or `{ adjust }`, exactly one. Another store's product is
 * 404, exactly like an unknown id (section 1.8).
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `SELLER` and an `APPROVED` store (403 before the body is read), 6 the body (413),
 * 7 the path parameter and the body (400), then the service (403 SELLER_NOT_APPROVED, 404, 409
 * INVALID_STATE_TRANSITION, NEGATIVE_STOCK, STOCK_LIMIT). No rate limit.
 */
import { changeStock, productIdParamsSchema, stockBodySchema } from "@/modules/inventory";
import { requireApprovedSeller } from "@/server/auth/actor";
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

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/v1/seller/products/[id]/stock">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireApprovedSeller(actor);
    const raw = await readJsonBody(request);
    const { id } = parseInput(productIdParamsSchema, await context.params);
    const body = parseInput(stockBodySchema, raw);
    return ok(await changeStock(actor, id, body), { requestId });
  });
}
