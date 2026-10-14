/**
 * GET /api/v1/categories/{slug} (docs/API_CONTRACTS.md section 5.2): public; the name and slug
 * of an active category. Unknown or inactive: 404.
 */
import { getCategory, slugParamsSchema } from "@/modules/catalog";
import { ok, parseInput } from "@/server/http";
import { handlePublicGet } from "@/server/public-get";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/categories/[slug]">,
): Promise<Response> {
  return handlePublicGet(request, async ({ requestId }) => {
    const { slug } = parseInput(slugParamsSchema, await context.params);
    return ok(await getCategory(slug), { requestId });
  });
}
