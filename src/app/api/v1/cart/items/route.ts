/**
 * POST /api/v1/cart/items (docs/API_CONTRACTS.md section 5.4; REQ-C-10, BR-16, BR-31). Access
 * `user`. Body `{ productId, quantity }`; adds to the caller's line for that product or creates
 * it. `201` when a line was created, `200` when an existing line changed.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 6 the body (413), 7 the schema (400), then the service (404, 409, 400 above 99). No rate limit
 * (section 6 lists none for the cart).
 */
import { addCartItem, addCartItemBodySchema } from "@/modules/cart";
import { requireActor } from "@/server/auth/session";
import { getEnv } from "@/server/env";
import {
  assertContentType,
  assertSameOrigin,
  created,
  JSON_CONTENT_TYPE,
  ok,
  parseInput,
  readJsonBody,
} from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const body = parseInput(addCartItemBodySchema, await readJsonBody(request));
    const result = await addCartItem(actor, body);
    return result.created ? created(result.line, { requestId }) : ok(result.line, { requestId });
  });
}
