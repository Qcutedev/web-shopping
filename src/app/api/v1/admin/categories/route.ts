/**
 * GET and POST /api/v1/admin/categories (docs/API_CONTRACTS.md section 5.9.4; REQ-A-06,
 * REQ-N-06). Access `admin`.
 *
 * GET: paginated (at most 50), by `sortOrder`, inactive categories included. Order of checks
 * (section 1.8): 3 the session (401), 4 the role `ADMIN` (403 FORBIDDEN), 7 the query (400), then
 * the service.
 *
 * POST: body `{ name, sortOrder? }`; the slug is generated; `201`; an audit row is written. Order
 * of checks: 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401), 4 the role `ADMIN`
 * (403 FORBIDDEN), 6 the body (413), 7 the body (400), then the service.
 */
import {
  createCategory,
  createCategoryBodySchema,
  listCategories,
  listCategoriesQuerySchema,
  queryRecord,
} from "@/modules/admin";
import { requireRole } from "@/server/auth/actor";
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
    requireRole(actor, "ADMIN");
    const query = parseInput(
      listCategoriesQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listCategories(actor, query);
    return paginated(page.items, page, { requestId });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "ADMIN");
    const body = parseInput(createCategoryBodySchema, await readJsonBody(request));
    return created(await createCategory(actor, body), { requestId });
  });
}
