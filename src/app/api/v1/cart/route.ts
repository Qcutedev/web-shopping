/**
 * GET /api/v1/cart (docs/API_CONTRACTS.md section 5.4; REQ-C-10). Access `user`: the caller's own
 * cart, grouped by store, with server-computed totals. Not paginated (section 1.7: the cart is a
 * single resource). Writes nothing (D-029 point 1).
 *
 * Order of checks (section 1.8): 3 the session (401), then the service. The query string is not
 * read: no parameter is defined, and a `userId` or `storeId` in it changes nothing. No rate limit.
 */
import { getCart } from "@/modules/cart";
import { requireActor } from "@/server/auth/session";
import { ok } from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    return ok(await getCart(actor), { requestId });
  });
}
