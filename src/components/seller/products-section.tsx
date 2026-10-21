import { th } from "@/i18n/th";
import { listOwnProducts } from "@/modules/inventory";
import { REMOVED_PARAM } from "./product-actions";
import { productListQueryFrom } from "./products-query";
import { ProductsListView } from "./products-list-view";
import { SELLER_ROUTES } from "./routes";
import { renderForSeller } from "./with-seller";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Server Component: one page of the session's store's products through the module service. The
 * filters come from the address bar and pass through the endpoint's own query schema; an invalid
 * query falls back to the unfiltered first page. Renders behind a Suspense boundary.
 */
export async function ProductsSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const query = productListQueryFrom(raw);
  // Set by the product page after a delete, so the list can confirm it.
  const notice = raw[REMOVED_PARAM] === "deleted" ? th.seller.products.actions.deleted : undefined;
  return renderForSeller(SELLER_ROUTES.products, async (actor) => {
    const page = await listOwnProducts(actor, query);
    return (
      <ProductsListView
        query={query}
        items={page.items}
        total={page.total}
        canAdd={actor.storeStatus === "APPROVED"}
        notice={notice}
      />
    );
  });
}
