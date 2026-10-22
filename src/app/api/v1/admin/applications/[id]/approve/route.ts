/**
 * POST /api/v1/admin/applications/{id}/approve (docs/API_CONTRACTS.md section 5.9.2; REQ-A-03).
 * Access `admin`, no body (section 1.2). In one transaction the application becomes `APPROVED`,
 * the store is created, the role becomes `SELLER`, and an audit row is written (the sellers
 * module's service, T-040).
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `ADMIN` (403 FORBIDDEN), 7 the path parameter (400), then the service (404; 409
 * INVALID_STATE_TRANSITION, APPLICANT_NOT_CUSTOMER, APPLICANT_INACTIVE, STORE_NAME_RESERVED,
 * STORE_NAME_TAKEN). The body is never read.
 */
import { applicationIdParamsSchema, approveApplication } from "@/modules/admin";
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
  context: RouteContext<"/api/v1/admin/applications/[id]/approve">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const { id } = parseInput(applicationIdParamsSchema, await context.params);
    return ok(await approveApplication(actor, id), { requestId });
  });
}
