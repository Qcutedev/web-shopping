import { th } from "@/i18n/th";
import { getOwnSellerOrder } from "@/modules/orders";
import { SellerNotFoundState } from "./load-state";
import { OrderDetailView } from "./order-detail-view";
import { SELLER_ROUTES, sellerOrderHref } from "./routes";
import { renderForSeller } from "./with-seller";

/**
 * Server Component: one seller order through the module service, by the seller order id and the
 * session's store. Another store's order, an unknown id, and an unpaid order all answer 404 and
 * show the same message (BR-35). Readable and fulfillable for a suspended store (BR-14).
 */
export async function OrderSection({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderForSeller(
    sellerOrderHref(id),
    async (actor) => <OrderDetailView order={await getOwnSellerOrder(actor, id)} />,
    {
      notFound: (
        <SellerNotFoundState
          backHref={SELLER_ROUTES.orders}
          backLabel={th.seller.orders.backToList}
        />
      ),
    },
  );
}
