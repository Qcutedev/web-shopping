import { listOwnSellerOrders } from "@/modules/orders";
import { orderListQueryFrom } from "./orders-query";
import { OrdersListView } from "./orders-list-view";
import { SELLER_ROUTES } from "./routes";
import { renderForSeller } from "./with-seller";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Server Component: one page of the session's store's paid orders through the module service
 * (readable for a suspended store, BR-14). The filter passes through the endpoint's own query
 * schema. Renders behind a Suspense boundary.
 */
export async function OrdersSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = orderListQueryFrom(await searchParams);
  return renderForSeller(SELLER_ROUTES.orders, async (actor) => {
    const page = await listOwnSellerOrders(actor, query);
    return <OrdersListView query={query} items={page.items} total={page.total} />;
  });
}
