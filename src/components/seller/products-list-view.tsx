import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Pagination } from "@/components/ui/pagination";
import { Price } from "@/components/ui/price";
import { SelectField } from "@/components/ui/select";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import {
  type ListSellerProductsQuery,
  MODERATION_STATUSES,
  PRODUCT_STATUSES,
  type SellerProductDto,
} from "@/modules/inventory/schema";
import { hasProductFilter, productsHref } from "./products-query";
import { SELLER_ROUTES, sellerProductHref } from "./routes";
import { ModerationBadge, ProductStatusBadge } from "./status-badges";

function FilterForm({ query }: { query: ListSellerProductsQuery }) {
  return (
    <form
      method="get"
      action={SELLER_ROUTES.products}
      aria-label={th.seller.products.filter.title}
      className="border-border bg-surface flex flex-col gap-4 rounded-md border p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          name="status"
          label={th.seller.products.filter.status}
          defaultValue={query.status ?? ""}
        >
          <option value="">{th.seller.products.filter.all}</option>
          {PRODUCT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {th.seller.status.product[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="moderationStatus"
          label={th.seller.products.filter.moderation}
          defaultValue={query.moderationStatus ?? ""}
        >
          <option value="">{th.seller.products.filter.all}</option>
          {MODERATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {th.seller.status.moderation[status]}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-col sm:flex-row sm:gap-6">
        <Checkbox
          name="lowStock"
          value="true"
          defaultChecked={query.lowStock === true}
          label={th.seller.products.filter.lowStock}
        />
        <Checkbox
          name="soldOut"
          value="true"
          defaultChecked={query.soldOut === true}
          label={th.seller.products.filter.soldOut}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{th.seller.products.filter.apply}</Button>
        <Link
          href={SELLER_ROUTES.products}
          className="type-label focus-ring inline-flex min-h-11 items-center rounded-sm underline underline-offset-4"
        >
          {th.seller.products.filter.reset}
        </Link>
      </div>
    </form>
  );
}

function ProductRow({ product }: { product: SellerProductDto }) {
  return (
    <Card as="li" className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <ProductImage
        image={product.images[0] ?? null}
        alt=""
        sizes="80px"
        className="size-20 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className={`type-card-title ${USER_NAME_CONTAINER_CLASS}`}>
          <Link
            href={sellerProductHref(product.id)}
            className="focus-ring rounded-sm underline-offset-4 hover:underline"
          >
            <UserName>{product.title}</UserName>
          </Link>
        </h2>
        <p className={`type-small text-foreground-secondary ${USER_NAME_CONTAINER_CLASS}`}>
          {th.seller.products.row.sku}: <UserName>{product.sku}</UserName>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ProductStatusBadge status={product.status} />
          <ModerationBadge status={product.moderationStatus} />
          {product.lowStock ? (
            <Badge variant="warning">{th.seller.products.row.lowStock}</Badge>
          ) : null}
          {product.soldOut ? (
            <Badge variant="danger">{th.seller.products.row.soldOut}</Badge>
          ) : null}
          {product.isSample ? <NoticeLabel>{th.notice.sampleData}</NoticeLabel> : null}
        </div>
      </div>
      <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-1 sm:text-right">
        <div>
          <dt className="sr-only">{th.seller.products.form.price}</dt>
          <dd className="type-label">
            <Price satang={product.priceSatang} />
          </dd>
        </div>
        <div>
          <dt className="sr-only">{th.seller.products.row.stock}</dt>
          <dd className="type-small text-foreground-secondary">
            {th.seller.products.row.stock}:{" "}
            {fill(th.seller.products.row.stockCount, { count: product.stock })}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/**
 * One page of the seller's products with the filter form (REQ-S-04). Presentation of the rows the
 * service returned; the counts and flags (`lowStock`, `soldOut`) are the server's.
 */
export function ProductsListView({
  query,
  items,
  total,
  canAdd,
  notice,
}: {
  query: ListSellerProductsQuery;
  items: readonly SellerProductDto[];
  total: number;
  canAdd: boolean;
  /** A confirmation to show above the list, for example after a delete. */
  notice?: string | undefined;
}) {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const filtered = hasProductFilter(query);

  let body;
  if (items.length > 0) {
    body = (
      <>
        <p role="status" className="type-small text-foreground-secondary">
          {fill(th.seller.products.count, { count: total })}
        </p>
        <ul aria-label={th.seller.products.listLabel} className="flex flex-col gap-3">
          {items.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </ul>
      </>
    );
  } else if (total > 0) {
    // A page past the last one.
    body = (
      <EmptyState
        title={th.seller.products.pageEmptyTitle}
        action={
          <Link href={productsHref(query, 1)} className={buttonVariants({ variant: "secondary" })}>
            {th.seller.products.pageEmptyAction}
          </Link>
        }
      />
    );
  } else if (filtered) {
    body = (
      <EmptyState
        title={th.seller.products.filteredEmptyTitle}
        description={th.seller.products.filteredEmptyDescription}
        action={
          <Link href={SELLER_ROUTES.products} className={buttonVariants({ variant: "secondary" })}>
            {th.seller.products.filter.reset}
          </Link>
        }
      />
    );
  } else {
    body = (
      <EmptyState
        title={th.seller.products.emptyTitle}
        description={th.seller.products.emptyDescription}
        action={
          canAdd ? (
            <Link href={SELLER_ROUTES.newProduct} className={buttonVariants()}>
              {th.seller.products.add}
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {canAdd ? (
        <div>
          {/* A convenience link: the create endpoint refuses a suspended store. */}
          <Link href={SELLER_ROUTES.newProduct} className={buttonVariants()}>
            {th.seller.products.add}
          </Link>
        </div>
      ) : null}
      <FilterForm query={query} />
      {body}
      {totalPages > 1 ? (
        <Pagination
          page={query.page}
          totalPages={totalPages}
          hrefForPage={(page) => productsHref(query, page)}
          label={th.pagination.label}
          previousLabel={th.pagination.previous}
          nextLabel={th.pagination.next}
          pageLabel={(page) => fill(th.pagination.page, { page })}
        />
      ) : null}
    </div>
  );
}
