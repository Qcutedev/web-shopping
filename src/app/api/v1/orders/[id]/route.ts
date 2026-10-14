/**
 * GET /api/v1/orders/{id} (docs/API_CONTRACTS.md section 5.5; REQ-C-13, BR-37). Access `user`,
 * own order only: another user's order is 404 exactly like an unknown id (section 1.8).
 *
 * Order of checks (section 1.8): 3 the session (401), 7 the path parameter (400), then the
 * service (404).
 */
import { getOrder, orderIdParamsSchema } from "@/modules/orders";
import { requireActor } from "@/server/auth/session";
import { ok, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/orders/[id]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    const { id } = parseInput(orderIdParamsSchema, await context.params);
    return ok(await getOrder(actor, id), { requestId });
  });
}
