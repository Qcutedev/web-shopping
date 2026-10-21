import { th } from "@/i18n/th";
import { getOwnSellerOrder } from "@/modules/orders";
import { sellerOrderIdParamsSchema } from "@/modules/orders/seller-schema";
import { notFound } from "@/server/errors";
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
    async (actor) => {
      // An id that cannot be one (NUL, too long) is the same not-found as an unknown id.
      const parsed = sellerOrderIdParamsSchema.safeParse({ id });
      if (!parsed.success) throw notFound();
      return <OrderDetailView order={await getOwnSellerOrder(actor, parsed.data.id)} />;
    },
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
