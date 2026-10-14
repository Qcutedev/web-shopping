import { type ListProductsQuery, listProductsQuerySchema } from "@/modules/catalog/schema";

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Parses the query string of a list page with the catalog schema (the server's own rules).
 * `category` set by the caller (a category page takes it from the path) replaces any `category`
 * in the query string. `null` means the query is invalid; the page shows its own message.
 */
export function parseListQuery(
  raw: RawSearchParams,
  forced: { category?: string } = {},
): ListProductsQuery | null {
  const input: Record<string, unknown> = { ...raw };
  // Next hands over undefined for absent keys only; drop them so defaults apply.
  for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
  if (forced.category !== undefined) input.category = forced.category;
  const parsed = listProductsQuerySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
