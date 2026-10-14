import { Card } from "@/components/ui/card";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDate } from "@/lib/format";
import type { ReviewDto } from "@/modules/catalog/schema";

/** Pure view of reviews. The comment is customer text: plain text only, never markup. */
export function ReviewsView({ reviews }: { reviews: readonly ReviewDto[] }) {
  return (
    <section aria-labelledby="product-reviews" className="flex flex-col gap-3">
      <h2 id="product-reviews" className="type-section-title">
        {th.catalog.product.reviewsTitle}
      </h2>
      {reviews.length === 0 ? (
        <p className="type-body text-foreground-secondary">{th.catalog.product.reviewsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <Card as="article" className="flex flex-col gap-1">
                <p className="type-label">
                  {fill(th.catalog.product.reviewRating, { rating: review.rating })}
                </p>
                <p className="type-body text-foreground-secondary [overflow-wrap:anywhere] whitespace-pre-line">
                  {review.comment ?? th.catalog.product.noComment}
                </p>
                <p className="type-caption text-foreground-muted">
                  <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
