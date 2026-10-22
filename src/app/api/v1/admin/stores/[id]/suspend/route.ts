/**
 * POST /api/v1/admin/stores/{id}/suspend (docs/API_CONTRACTS.md section 5.9.2; REQ-A-04, BR-14).
 * Access `admin`. Body `{ reason }`, required. `APPROVED` to `SUSPENDED`; an audit row is written.
 * The seller's sessions are not ended and existing orders stay fulfillable (BR-14).
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `ADMIN` (403 FORBIDDEN), 6 the body (413), 7 the path parameter and the body (400),
 * then the service (404; 409 INVALID_STATE_TRANSITION).
 */
import { idParamsSchema, storeReasonBodySchema, suspendStore } from "@/modules/admin";
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

export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/admin/stores/[id]/suspend">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const raw = await readJsonBody(request);
    const { id } = parseInput(idParamsSchema, await context.params);
    const body = parseInput(storeReasonBodySchema, raw);
    return ok(await suspendStore(actor, id, body), { requestId });
  });
}
