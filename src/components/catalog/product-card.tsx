import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { Badge } from "@/components/ui/badge";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { productHref } from "@/lib/routes";
import type { ProductListItemDto } from "@/modules/catalog/schema";

/** A product counts as new for this long after it was listed. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="size-4 fill-current">
      <path d="M10 1.8l2.4 5 5.5.7-4 3.8 1 5.4L10 14.1l-4.9 2.6 1-5.4-4-3.8 5.5-.7z" />
    </svg>
  );
}

function isNew(createdAt: string): boolean {
  return Date.now() - Date.parse(createdAt) < NEW_FOR_MS;
}

/**
 * One product in a list. The whole card is one link; it holds no other interactive element.
 * The title is a heading inside the link so a list can be scanned by heading. Sold-out and sample
 * marks are text (BR-24, CLAUDE.md: sample data is labelled).
 */
export function ProductCard({
  product,
  titleAs: Title = "h3",
  priority = false,
}: {
  product: ProductListItemDto;
  titleAs?: "h2" | "h3";
  priority?: boolean;
}) {
  return (
    <Link
      href={productHref(product.slug)}
      className="group focus-ring flex h-full flex-col gap-2 rounded-lg"
    >
      <div className="product-card-media relative overflow-hidden rounded-lg transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lg">
        <ProductImage
          image={product.image}
          alt=""
          sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
          priority={priority}
        />
        <span aria-hidden="true" className="product-card-cta">
          {th.catalog.viewProduct}
        </span>
        {product.soldOut ? (
          <Badge variant="neutral" className="absolute top-2 left-2">
            {th.catalog.soldOut}
          </Badge>
        ) : isNew(product.createdAt) ? (
          <Badge variant="primary" className="absolute top-2 left-2">
            {th.catalog.home.newBadge}
          </Badge>
        ) : null}
      </div>
      <Title className="type-card-title text-foreground line-clamp-2 group-hover:underline">
        <UserName>{product.title}</UserName>
      </Title>
      <p className={`type-small text-foreground-muted ${USER_NAME_CONTAINER_CLASS}`}>
        <UserName>{product.store.name}</UserName>
      </p>
      {product.reviewSummary !== null ? (
        <p
          className="type-small text-foreground-secondary flex items-center gap-1"
          aria-label={fill(th.catalog.product.ratingSummary, {
            rating: product.reviewSummary.averageRating.toFixed(1),
            count: product.reviewSummary.count,
          })}
        >
          <span aria-hidden="true" className="text-warning flex items-center gap-1">
            <StarIcon />
            {product.reviewSummary.averageRating.toFixed(1)}
          </span>
          <span aria-hidden="true">({product.reviewSummary.count})</span>
        </p>
      ) : null}
      <Price satang={product.priceSatang} size="card" />
      {product.isSample ? (
        <span>
          <NoticeLabel>{th.notice.sampleData}</NoticeLabel>
        </span>
      ) : null}
    </Link>
  );
}
