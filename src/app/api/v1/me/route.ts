/**
 * GET and PATCH /api/v1/me (docs/API_CONTRACTS.md section 5.3; REQ-C-03). Access `user`.
 *
 * Order of checks (section 1.8): PATCH 1 `Origin`, 2 `Content-Type`, 3 the session, 6 the body,
 * 7 the schema, then the service; GET 3 the session, then the service. No rate limit (section 6).
 */
import { getProfile, updateProfile, updateProfileBodySchema } from "@/modules/profile";
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
    return ok(await getProfile(actor), { requestId });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const body = parseInput(updateProfileBodySchema, await readJsonBody(request));
    return ok(await updateProfile(actor, body), { requestId });
  });
}
