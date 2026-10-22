/**
 * GET and PATCH /api/v1/admin/settings (docs/API_CONTRACTS.md section 5.9.6; REQ-A-09, BR-08,
 * BR-13, BR-17, BR-28). Access `admin`. Exactly two settings; no moderation switch.
 *
 * GET: the single row. Order of checks (section 1.8): 3 the session (401), 4 the role `ADMIN`
 * (403 FORBIDDEN), then the service. The query is not read.
 *
 * PATCH: one or both of `flatShippingFeeSatang` (0 to 100,000) and `commissionRateBps` (0 to
 * 10,000, a multiple of 100); a value out of bounds is 400 and nothing changes; an audit row is
 * written when a value changes. Order of checks: 1 `Origin` (403), 2 `Content-Type` (415), 3 the
 * session (401), 4 the role `ADMIN` (403 FORBIDDEN), 6 the body (413), 7 the body (400), then the
 * service.
 */
import { getSettings, updateSettings, updateSettingsBodySchema } from "@/modules/admin";
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

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    return ok(await getSettings(actor), { requestId });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const body = parseInput(updateSettingsBodySchema, await readJsonBody(request));
    return ok(await updateSettings(actor, body), { requestId });
  });
}
