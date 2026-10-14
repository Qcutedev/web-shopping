/**
 * GET and PATCH /api/v1/seller/store (docs/API_CONTRACTS.md section 5.7.1; REQ-S-02, REQ-S-09,
 * BR-14). The store is the session's; no request names one.
 *
 * GET, access `seller (any store status)`: 3 the session (401), 4 the role `SELLER` (403
 * FORBIDDEN for a customer, a pending or rejected applicant included, and for an admin), then the
 * service. A suspended store's seller reads the settings.
 * PATCH, access `seller`: 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401), 4 the
 * role `SELLER` and an `APPROVED` store (403 FORBIDDEN, or 403 SELLER_NOT_APPROVED for a
 * suspended store, before the body is read; D-032 point 1), 6 the body (413), 7 the schema (400),
 * then the service (403 SELLER_NOT_APPROVED again under the store row's lock; 404 `upload`).
 * No rate limit (section 6 lists none for these).
 */
import { getOwnStore, updateOwnStore, updateStoreBodySchema } from "@/modules/sellers";
import { requireApprovedSeller, requireRole } from "@/server/auth/actor";
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

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "SELLER");
    return ok(await getOwnStore(actor), { requestId });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireApprovedSeller(actor);
    const body = parseInput(updateStoreBodySchema, await readJsonBody(request));
    return ok(await updateOwnStore(actor, body), { requestId });
  });
}
