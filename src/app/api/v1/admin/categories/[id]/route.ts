/**
 * PATCH and DELETE /api/v1/admin/categories/{id} (docs/API_CONTRACTS.md section 5.9.4; REQ-A-06,
 * BR-23). Access `admin`.
 *
 * PATCH: any of `name`, `sortOrder`, `isActive`; a rename keeps the slug; an audit row is written
 * when something changes. Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type`
 * (415), 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 6 the body (413), 7 the path
 * parameter and the body (400), then the service (404).
 *
 * DELETE: no body (section 1.2). Only a category no product references (409 CONFLICT
 * CATEGORY_HAS_PRODUCTS otherwise); an audit row is written. Order of checks: 1, 2, 3, 4 as above,
 * 7 the path parameter (400), then the service (404, 409). The body is never read.
 */
import {
  deleteCategory,
  idParamsSchema,
  updateCategory,
  updateCategoryBodySchema,
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

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/v1/admin/categories/[id]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const raw = await readJsonBody(request);
    const { id } = parseInput(idParamsSchema, await context.params);
    const body = parseInput(updateCategoryBodySchema, raw);
    return ok(await updateCategory(actor, id, body), { requestId });
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/v1/admin/categories/[id]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const { id } = parseInput(idParamsSchema, await context.params);
    return ok(await deleteCategory(actor, id), { requestId });
  });
}
