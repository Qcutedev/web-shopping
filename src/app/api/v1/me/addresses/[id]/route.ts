/**
 * PATCH and DELETE /api/v1/me/addresses/{id} (docs/API_CONTRACTS.md section 5.3; REQ-C-04).
 * Access `user`, owner only: an address of another user is 404, exactly like an unknown id
 * (section 1.8). DELETE has no body (section 1.2).
 *
 * Order of checks (section 1.8): 1 `Origin`, 2 `Content-Type`, 3 the session, 6 the body (PATCH
 * only), 7 the path parameter and the body, then the service (404, or the change). No rate limit.
 */
import {
  addressIdParamsSchema,
  deleteAddress,
  updateAddress,
  updateAddressBodySchema,
} from "@/modules/profile";
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

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/v1/me/addresses/[id]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const raw = await readJsonBody(request);
    const { id } = parseInput(addressIdParamsSchema, await context.params);
    const body = parseInput(updateAddressBodySchema, raw);
    return ok(await updateAddress(actor, id, body), { requestId });
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/v1/me/addresses/[id]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const { id } = parseInput(addressIdParamsSchema, await context.params);
    return ok(await deleteAddress(actor, id), { requestId });
  });
}
