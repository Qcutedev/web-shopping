/**
 * POST /api/v1/admin/users/{id}/reactivate (docs/API_CONTRACTS.md section 5.9.1; REQ-A-02,
 * BR-27). Access `admin`, no body (section 1.2). The user must sign in again; an audit row is
 * written.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `ADMIN` (403 FORBIDDEN), 7 the path parameter (400), then the service (404; 409
 * INVALID_STATE_TRANSITION). The body is never read.
 */
import { idParamsSchema, reactivateUser } from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
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
  context: RouteContext<"/api/v1/admin/users/[id]/reactivate">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const { id } = parseInput(idParamsSchema, await context.params);
    return ok(await reactivateUser(actor, id), { requestId });
  });
}
