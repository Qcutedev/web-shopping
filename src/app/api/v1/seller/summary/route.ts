/**
 * GET /api/v1/seller/summary (docs/API_CONTRACTS.md section 5.7.4; REQ-S-03, BR-14, BR-21,
 * BR-25, BR-33, BR-35). Access `seller (any store status)`: the seller of a suspended store still
 * reads the summary. Every figure is computed from rows of the session's store; nothing of the
 * request names a store (a `storeId` in the query is ignored).
 *
 * Order of checks (section 1.8): 3 the session (401), 4 the role `SELLER` (403 FORBIDDEN), then
 * the service. The query is not read.
 */
import { getSellerSummary } from "@/modules/orders";
import { requireRole } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { ok } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "SELLER");
    return ok(await getSellerSummary(actor), { requestId });
  });
}
