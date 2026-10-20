/**
 * GET and POST /api/v1/seller/products (docs/API_CONTRACTS.md section 5.7.2; REQ-S-04, REQ-S-09,
 * BR-14, BR-25). The store is the session's; no request names one (a `storeId` in the query is
 * not interpreted, one in the body is 400).
 *
 * GET, access `seller (any store status)`: 3 the session (401), 4 the role `SELLER` (403
 * FORBIDDEN), 7 the query (400), then the service. Paginated.
 * POST, access `seller`: 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401), 4 the
 * role `SELLER` and an `APPROVED` store (403 FORBIDDEN, or 403 SELLER_NOT_APPROVED before the body
 * is read; D-032 point 1), 6 the body (413), 7 the schema (400), then the service (403
 * SELLER_NOT_APPROVED again, 404 `category` or `upload`, 409). `201`. No rate limit (section 6).
 */
import {
  createProduct,
  createProductBodySchema,
  listOwnProducts,
  listSellerProductsQuerySchema,
  queryRecord,
} from "@/modules/inventory";
import { requireApprovedSeller, requireRole } from "@/server/auth/actor";
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
    requireRole(actor, "SELLER");
    const query = parseInput(
      listSellerProductsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listOwnProducts(actor, query);
    return paginated(page.items, page, { requestId });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    assertSameOrigin(request, getEnv().appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireApprovedSeller(actor);
    const body = parseInput(createProductBodySchema, await readJsonBody(request));
    return created(await createProduct(actor, body), { requestId });
  });
}
