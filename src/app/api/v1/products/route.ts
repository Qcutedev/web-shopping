/**
 * GET /api/v1/products (docs/API_CONTRACTS.md section 5.2): public, paginated, visible products
 * only, with search, filters, and sort.
 */
import { listProducts, listProductsQuerySchema, queryRecord } from "@/modules/catalog";
import { paginated, parseInput } from "@/server/http";
import { handlePublicGet } from "@/server/public-get";

export async function GET(request: Request): Promise<Response> {
  return handlePublicGet(request, async ({ requestId }) => {
    const query = parseInput(
      listProductsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listProducts(query);
    return paginated(page.items, page, { requestId });
  });
}
