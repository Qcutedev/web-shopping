/**
 * GET /api/v1/stores/{slug} (docs/API_CONTRACTS.md section 5.2): public; a store that is not
 * `APPROVED`, or whose owner is deactivated, is 404.
 */
import { getStore, slugParamsSchema } from "@/modules/catalog";
import { ok, parseInput } from "@/server/http";
import { handlePublicGet } from "@/server/public-get";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/stores/[slug]">,
): Promise<Response> {
  return handlePublicGet(request, async ({ requestId }) => {
    const { slug } = parseInput(slugParamsSchema, await context.params);
    return ok(await getStore(slug), { requestId });
  });
}
