import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { Badge } from "@/components/ui/badge";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { th } from "@/i18n/th";
import { productHref } from "@/lib/routes";
import type { ProductListItemDto } from "@/modules/catalog/schema";

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
      <div className="relative overflow-hidden rounded-lg transition-transform duration-300 group-hover:-translate-y-1 group-hover:shadow-lg">
        <ProductImage
          image={product.image}
          alt=""
          sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
          priority={priority}
        />
        {product.soldOut ? (
          <Badge variant="neutral" className="absolute top-2 left-2">
            {th.catalog.soldOut}
          </Badge>
        ) : null}
      </div>
      <Title className="type-card-title text-foreground line-clamp-2 group-hover:underline">
        <UserName>{product.title}</UserName>
      </Title>
      <p className={`type-small text-foreground-muted ${USER_NAME_CONTAINER_CLASS}`}>
        <UserName>{product.store.name}</UserName>
      </p>
      <Price satang={product.priceSatang} size="card" />
      {product.isSample ? (
        <span>
          <NoticeLabel>{th.notice.sampleData}</NoticeLabel>
        </span>
      ) : null}
    </Link>
  );
}
