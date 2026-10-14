/**
 * PATCH and DELETE /api/v1/cart/items/{itemId} (docs/API_CONTRACTS.md section 5.4; REQ-C-10,
 * BR-30, BR-31, BR-38). Access `user`, own line only: a line of another user is 404, exactly like
 * an unknown id (section 1.8). DELETE has no body (section 1.2).
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 6 the body (413; PATCH only), 7 the path parameter and the body (400), then the service (404,
 * 409, or the change). No rate limit.
 */
import {
  cartItemIdParamsSchema,
  deleteCartItem,
  updateCartItem,
  updateCartItemBodySchema,
} from "@/modules/cart";
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
  context: RouteContext<"/api/v1/cart/items/[itemId]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const raw = await readJsonBody(request);
    const { itemId } = parseInput(cartItemIdParamsSchema, await context.params);
    const body = parseInput(updateCartItemBodySchema, raw);
    return ok(await updateCartItem(actor, itemId, body), { requestId });
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/v1/cart/items/[itemId]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const { itemId } = parseInput(cartItemIdParamsSchema, await context.params);
    return ok(await deleteCartItem(actor, itemId), { requestId });
  });
}
