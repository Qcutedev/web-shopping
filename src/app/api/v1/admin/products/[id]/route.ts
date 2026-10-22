/**
 * GET /api/v1/admin/products/{id} (docs/API_CONTRACTS.md section 5.9.3; REQ-A-05). Access
 * `admin`. Any product, whatever its state, with `contentRevision`.
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 7 the
 * path parameter (400), then the service (404).
 */
import { getProduct, idParamsSchema } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { ok, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/admin/products/[id]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const { id } = parseInput(idParamsSchema, await context.params);
    return ok(await getProduct(actor, id), { requestId });
  });
}
