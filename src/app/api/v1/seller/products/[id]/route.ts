/**
 * GET, PATCH, and DELETE /api/v1/seller/products/{id} (docs/API_CONTRACTS.md section 5.7.2;
 * REQ-S-04, BR-12, BR-14, BR-18, BR-19). Another store's product is 404, exactly like an unknown
 * id (section 1.8): the service looks it up by id and the session's store together.
 *
 * GET, access `seller (any store status)`: 3 the session (401), 4 the role `SELLER` (403), 7 the
 * path parameter (400), then the service (404).
 * PATCH, access `seller`: 1 `Origin`, 2 `Content-Type`, 3 the session, 4 role `SELLER` and an
 * `APPROVED` store (403 before the body is read), 6 the body (413), 7 the path parameter and the
 * body (400), then the service (403 SELLER_NOT_APPROVED, 404, 404 `category` or `upload`, 409).
 * DELETE, access `seller`, no body (section 1.2): 1, 2, 3, 4, 7 the path parameter, then the
 * service; `200` with `{ outcome: "DELETED" | "ARCHIVED" }`.
 */
import {
  deleteProduct,
  getOwnProduct,
  productIdParamsSchema,
  updateProduct,
  updateProductBodySchema,
} from "@/modules/inventory";
import { requireApprovedSeller, requireRole } from "@/server/auth/actor";
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

type Context = RouteContext<"/api/v1/seller/products/[id]">;

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "SELLER");
    const { id } = parseInput(productIdParamsSchema, await context.params);
    return ok(await getOwnProduct(actor, id), { requestId });
  });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireApprovedSeller(actor);
    const raw = await readJsonBody(request);
    const { id } = parseInput(productIdParamsSchema, await context.params);
    const body = parseInput(updateProductBodySchema, raw);
    return ok(await updateProduct(actor, id, body), { requestId });
  });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireApprovedSeller(actor);
    const { id } = parseInput(productIdParamsSchema, await context.params);
    return ok(await deleteProduct(actor, id), { requestId });
  });
}
