/**
 * POST /api/v1/seller/products/{id}/publish (docs/API_CONTRACTS.md sections 3.3 and 5.7.2;
 * BR-17, BR-36). Access `seller`, no body (section 1.2). `DRAFT` to `PUBLISHED`; anything else is
 * 409 INVALID_STATE_TRANSITION. Publishing never makes a product visible without approval.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `SELLER` and an `APPROVED` store (403), 7 the path parameter (400), then the service
 * (403 SELLER_NOT_APPROVED, 404, 409). The body is never read.
 */
import { productIdParamsSchema, publishProduct } from "@/modules/inventory";
import { requireApprovedSeller } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { getEnv } from "@/server/env";
import {
  assertContentType,
  assertSameOrigin,
  JSON_CONTENT_TYPE,
  ok,
  parseInput,
} from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/seller/products/[id]/publish">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireApprovedSeller(actor);
    const { id } = parseInput(productIdParamsSchema, await context.params);
    return ok(await publishProduct(actor, id), { requestId });
  });
}
