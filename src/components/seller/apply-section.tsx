import { unstable_rethrow } from "next/navigation";
import { getOwnApplication, type SellerApplicationDto } from "@/modules/sellers";
import { isAppError } from "@/server/errors";
import { ApplyView } from "./apply-view";
import { SELLER_ROUTES } from "./routes";
import { renderForSeller } from "./with-seller";

/**
 * Server Component: the signed-in customer's latest application through the module service. A
 * person who never applied (404) gets the form. A seller is sent to the dashboard. Reads the
 * session, so it renders behind a Suspense boundary (Cache Components).
 */
export async function ApplySection() {
  return renderForSeller(
    SELLER_ROUTES.apply,
    async (actor) => {
      let application: SellerApplicationDto | null = null;
      try {
        application = await getOwnApplication(actor);
      } catch (error) {
        unstable_rethrow(error);
        if (!(isAppError(error) && error.code === "NOT_FOUND")) throw error;
      }
      return <ApplyView application={application} />;
    },
    { access: "applicant" },
  );
}
