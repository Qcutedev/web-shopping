/**
 * GET /api/v1/products/{slug} (docs/API_CONTRACTS.md section 5.2): public; a product that is not
 * visible is 404.
 */
import { getProduct, slugParamsSchema } from "@/modules/catalog";
import { ok, parseInput } from "@/server/http";
import { handlePublicGet } from "@/server/public-get";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/products/[slug]">,
): Promise<Response> {
  return handlePublicGet(request, async ({ requestId }) => {
    const { slug } = parseInput(slugParamsSchema, await context.params);
    return ok(await getProduct(slug), { requestId });
  });
}
