/**
 * GET /api/v1/categories (docs/API_CONTRACTS.md section 5.2): public, paginated, active
 * categories only.
 */
import { listCategories, listCategoriesQuerySchema, queryRecord } from "@/modules/catalog";
import { paginated, parseInput } from "@/server/http";
import { handlePublicGet } from "@/server/public-get";

export async function GET(request: Request): Promise<Response> {
  return handlePublicGet(request, async ({ requestId }) => {
    const query = parseInput(
      listCategoriesQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listCategories(query);
    return paginated(page.items, page, { requestId });
  });
}
