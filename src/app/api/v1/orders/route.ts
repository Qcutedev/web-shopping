/**
 * GET /api/v1/orders (docs/API_CONTRACTS.md section 5.5; REQ-C-13). Access `user`. The caller's
 * own orders only, newest first, paginated (section 1.7), each in the order shape of section
 * 5.5.2, failed orders included (BR-20).
 *
 * Order of checks (section 1.8): 3 the session (401), 7 the query (400), then the service.
 */
import { listOrders, paginationQuerySchema, queryRecord } from "@/modules/orders";
import { requireActor } from "@/server/auth/session";
import { paginated, parseInput } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    const query = parseInput(paginationQuerySchema, queryRecord(new URL(request.url).searchParams));
    const page = await listOrders(actor, query);
    return paginated(page.items, page, { requestId });
  });
}
