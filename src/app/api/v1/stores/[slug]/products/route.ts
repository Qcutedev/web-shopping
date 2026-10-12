/**
 * GET /api/v1/stores/{slug}/products (docs/API_CONTRACTS.md section 5.2): public, paginated, the
 * store's visible products with the query of `GET /products`; a store that is not public is 404.
 */
import {
  listStoreProducts,
  listStoreProductsQuerySchema,
  queryRecord,
  slugParamsSchema,
} from "@/modules/catalog";
import { paginated, parseInput } from "@/server/http";
import { handlePublicGet } from "@/server/public-get";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/stores/[slug]/products">,
): Promise<Response> {
  return handlePublicGet(request, async ({ requestId }) => {
    const { slug } = parseInput(slugParamsSchema, await context.params);
    const query = parseInput(
      listStoreProductsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listStoreProducts(slug, query);
    return paginated(page.items, page, { requestId });
  });
}
