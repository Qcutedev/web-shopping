import { getSellerSummary } from "@/modules/orders";
import { getOwnStore } from "@/modules/sellers";
import { DashboardView } from "./dashboard-view";
import { SELLER_ROUTES } from "./routes";
import { renderForSeller } from "./with-seller";

/**
 * Server Component: the summary figures and the store, both read through the module services for
 * the session's store. Reads the session, so it renders behind a Suspense boundary.
 */
export async function DashboardSection() {
  return renderForSeller(SELLER_ROUTES.dashboard, async (actor) => {
    const [summary, store] = await Promise.all([getSellerSummary(actor), getOwnStore(actor)]);
    return <DashboardView summary={summary} store={store} />;
  });
}
