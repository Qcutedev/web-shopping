/**
 * GET /api/v1/products/{slug}/reviews (docs/API_CONTRACTS.md section 5.2): public, paginated,
 * newest first; a product that is not visible is 404.
 */
import {
  listProductReviews,
  listProductReviewsQuerySchema,
  queryRecord,
  slugParamsSchema,
} from "@/modules/catalog";
import { paginated, parseInput } from "@/server/http";
import { handlePublicGet } from "@/server/public-get";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/products/[slug]/reviews">,
): Promise<Response> {
  return handlePublicGet(request, async ({ requestId }) => {
    const { slug } = parseInput(slugParamsSchema, await context.params);
    const query = parseInput(
      listProductReviewsQuerySchema,
      queryRecord(new URL(request.url).searchParams),
    );
    const page = await listProductReviews(slug, query);
    return paginated(page.items, page, { requestId });
  });
}
