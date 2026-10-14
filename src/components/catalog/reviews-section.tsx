import { notFound, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { ReviewsView } from "@/components/catalog/reviews-view";
import { th } from "@/i18n/th";
import { listProductReviews } from "@/modules/catalog";
import type { ReviewDto } from "@/modules/catalog/schema";
import { isAppError } from "@/server/errors";

const REVIEWS_SHOWN = 10;

/** Server Component. Reviews are secondary: a failed read shows a short note, not a page error. */
export async function ReviewsSection({ slug }: { slug: string }) {
  await connection();
  let reviews: ReviewDto[];
  try {
    reviews = (await listProductReviews(slug, { page: 1, pageSize: REVIEWS_SHOWN })).items;
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    return (
      <p role="alert" className="type-body text-foreground-secondary">
        {th.catalog.product.reviewsFailed}
      </p>
    );
  }
  return <ReviewsView reviews={reviews} />;
}
