import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { UserName, USER_NAME_CONTAINER_CLASS } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { stripIsolateControls } from "@/lib/bidi";
import { categoryHref, ROUTES, storeHref } from "@/lib/routes";
import type { ProductDetailDto } from "@/modules/catalog/schema";

/** First-strong isolate and pop: wrap a user title inside an attribute, where `<bdi>` cannot go (SEC-057). */
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

/**
 * Product page content from a loaded product. Price, stock state, and sold-out mark are what the
 * server sent; nothing is computed here. The purchase control (quantity, add to cart) belongs to
 * the cart task and is not on this page yet.
 */
export function ProductDetailView({ product }: { product: ProductDetailDto }) {
  const { images, title } = product;
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        label={th.catalog.breadcrumbLabel}
        items={[
          { label: th.site.name, href: ROUTES.home },
          { label: product.category.name, href: categoryHref(product.category.slug) },
          { label: <UserName>{product.title}</UserName> },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        <section aria-label={th.catalog.product.gallery} className="flex flex-col gap-3">
          {images.length === 0 ? (
            <ProductImage image={null} alt="" sizes="(min-width: 1024px) 50vw, 100vw" />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
              {images.map((image, index) => (
                <li
                  key={image.key}
                  className={index === 0 ? "col-span-2 sm:col-span-3 lg:col-span-2" : ""}
                >
                  <ProductImage
                    image={image}
                    alt={fill(th.catalog.product.imageAlt, {
                      title: `${FSI}${stripIsolateControls(title)}${PDI}`,
                      index: index + 1,
                      count: images.length,
                    })}
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    priority={index === 0}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex flex-col gap-4">
          <h1 className="type-page-title text-foreground [overflow-wrap:anywhere]">
            <UserName>{product.title}</UserName>
          </h1>
          {product.reviewSummary !== null ? (
            <p className="type-small text-foreground-secondary">
              {fill(th.catalog.product.ratingSummary, {
                // One decimal place, as the service rounded it. Not money.
                rating: product.reviewSummary.averageRating.toFixed(1),
                count: product.reviewSummary.count,
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Price satang={product.priceSatang} size="page" />
            {product.soldOut ? <Badge variant="neutral">{th.catalog.soldOut}</Badge> : null}
            {product.isSample ? <NoticeLabel>{th.notice.sampleData}</NoticeLabel> : null}
          </div>
          <dl className="type-body grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-foreground-muted">{th.catalog.product.store}</dt>
            <dd className={USER_NAME_CONTAINER_CLASS}>
              <Link
                href={storeHref(product.store.slug)}
                className="focus-ring inline-flex min-h-11 items-center rounded-sm underline underline-offset-4"
              >
                <UserName>{product.store.name}</UserName>
              </Link>
              {product.store.isSample ? (
                <>
                  {" "}
                  <NoticeLabel>{th.notice.sampleData}</NoticeLabel>
                </>
              ) : null}
            </dd>
            <dt className="text-foreground-muted">{th.catalog.product.category}</dt>
            <dd>
              <Link
                href={categoryHref(product.category.slug)}
                className="focus-ring inline-flex min-h-11 items-center rounded-sm underline underline-offset-4"
              >
                {product.category.name}
              </Link>
            </dd>
          </dl>
          <section aria-labelledby="product-description" className="flex flex-col gap-2">
            <h2 id="product-description" className="type-section-title">
              {th.catalog.product.description}
            </h2>
            {/* Plain text: React escapes it, line breaks are kept by CSS. */}
            <p className="type-body text-foreground-secondary [overflow-wrap:anywhere] whitespace-pre-line">
              {product.description}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Loading state: the two-column page in outline, with a text that assistive technology announces. */
export function ProductDetailSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-6 lg:grid-cols-2 lg:gap-10">
      <span role="status" className="sr-only">
        {th.catalog.loading}
      </span>
      <Skeleton className="aspect-square w-full rounded-lg" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-9 w-1/3" />
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}
