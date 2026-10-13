/**
 * GET and POST /api/v1/me/addresses (docs/API_CONTRACTS.md section 5.3; REQ-C-04). Access `user`.
 *
 * Order of checks (section 1.8): POST 1 `Origin`, 2 `Content-Type`, 3 the session, 6 the body,
 * 7 the schema, then the service; GET 3 the session, 7 the query, then the service. No rate limit
 * (section 6). The list is paginated (section 1.7) and holds the caller's own addresses only.
 */
import {
  createAddress,
  createAddressBodySchema,
  listAddresses,
  paginationQuerySchema,
  queryRecord,
} from "@/modules/profile";
import { requireActor } from "@/server/auth/session";
import { getEnv } from "@/server/env";
import {
  assertContentType,
  assertSameOrigin,
  created,
  JSON_CONTENT_TYPE,
  paginated,
  parseInput,
  readJsonBody,
} from "@/server/http";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    const query = parseInput(paginationQuerySchema, queryRecord(new URL(request.url).searchParams));
    const page = await listAddresses(actor, query);
    return paginated(page.items, page, { requestId });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const body = parseInput(createAddressBodySchema, await readJsonBody(request));
    return created(await createAddress(actor, body), { requestId });
  });
}
