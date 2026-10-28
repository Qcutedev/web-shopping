/**
 * POST /api/v1/admin/reviews/{id}/unhide (docs/API_CONTRACTS.md section 5.9.9; SECURITY.md
 * SEC-092). Access `admin`. Body `{ reason? }`, written to the audit row only. The review is public
 * again and counts in the rating summary; an audit row is written in the same transaction.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `ADMIN` (403 FORBIDDEN), 6 the body (413), 7 the path parameter and the body (400),
 * then the service (404; 409 INVALID_STATE_TRANSITION when not hidden).
 */
import { idParamsSchema, reviewModerationBodySchema, unhideReview } from "@/modules/admin";
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
  context: RouteContext<"/api/v1/admin/reviews/[id]/unhide">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const raw = await readJsonBody(request);
    const { id } = parseInput(idParamsSchema, await context.params);
    const body = parseInput(reviewModerationBodySchema, raw);
    return ok(await unhideReview(actor, id, body), { requestId });
  });
}
