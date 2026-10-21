import { SELLER_ROUTES } from "./routes";
import { StoreForm } from "./store-form";
import { renderForSeller } from "./with-seller";

/**
 * Server Component: the seller's own store through the module service. A suspended store is
 * readable (BR-14); the form is then read-only. Renders behind a Suspense boundary.
 */
export async function StoreSection() {
  return renderForSeller(SELLER_ROUTES.store, async (_actor, { getStore }) => {
    const store = await getStore();
    return <StoreForm store={store} />;
  });
}
