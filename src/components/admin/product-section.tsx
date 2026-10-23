import Link from "next/link";
import type { ReactNode } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import {
  ModerationBadge,
  ProductStatusBadge,
  StoreStatusBadge,
} from "@/components/seller/status-badges";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import { getProduct } from "@/modules/admin";
import { type AdminProductDto, idParamsSchema } from "@/modules/admin/schema";
import { notFound } from "@/server/errors";
import { AdminAction } from "./action-button";
import { formatCount } from "./format-count";
import { AdminNotFoundState } from "./load-state";
import { ADMIN_ROUTES, adminProductHref } from "./routes";
import { renderForAdmin } from "./with-admin";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="type-label text-foreground-secondary">{label}</dt>
      <dd className={USER_NAME_CONTAINER_CLASS}>{children}</dd>
    </>
  );
}

/**
 * Decisions for a product (REQ-A-05). The buttons shown follow the rules of the server only to
 * save the admin a refused click: approve and reject for a published product awaiting approval,
 * takedown for an approved one. The revision shown on this page travels with every decision, so
 * the server refuses a decision on content that changed since (409 STALE_REVISION).
 */
function DecisionPanel({ product }: { product: AdminProductDto }) {
  const returnTo = adminProductHref(product.id);
  const decidable = product.moderationStatus === "PENDING" && product.status === "PUBLISHED";
  const takedown = product.moderationStatus === "APPROVED";
  const text = th.admin.products;
  return (
    <Card as="section" padding="panel" aria-labelledby="product-decision-title">
      <CardTitle as="h2" size="panel" id="product-decision-title">
        {text.decisionTitle}
      </CardTitle>
      <p className="type-small text-foreground-muted mt-1">{text.decisionNote}</p>
      <div className="mt-4 flex flex-col gap-3">
        {product.moderationStatus === "PENDING" && !decidable ? (
          <p className="type-body text-foreground-secondary">{text.notInQueueNote}</p>
        ) : null}
        {!decidable && !takedown && product.moderationStatus !== "PENDING" ? (
          <p className="type-body text-foreground-secondary">{text.noDecision}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {decidable ? (
            <>
              <AdminAction
                size="md"
                spec={{
                  kind: "product.approve",
                  id: product.id,
                  contentRevision: product.contentRevision,
                }}
                returnTo={returnTo}
              />
              <AdminAction
                size="md"
                spec={{
                  kind: "product.reject",
                  id: product.id,
                  contentRevision: product.contentRevision,
                }}
                returnTo={returnTo}
              />
            </>
          ) : null}
          {takedown ? (
            <AdminAction
              size="md"
              spec={{
                kind: "product.takedown",
                id: product.id,
                contentRevision: product.contentRevision,
              }}
              returnTo={returnTo}
            />
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** One product as an admin reviews it: what the seller wrote, its states, and the decisions. */
export function ProductDetailView({ product }: { product: AdminProductDto }) {
  const text = th.admin.products;
  return (
    <div className="flex flex-col gap-6">
      <Card as="section" padding="panel" aria-labelledby="product-summary-title">
        <h2 id="product-summary-title" className={`type-panel-title ${USER_NAME_CONTAINER_CLASS}`}>
          <UserName>{product.title}</UserName>
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ProductStatusBadge status={product.status} />
          <ModerationBadge status={product.moderationStatus} />
          {product.isSample ? <NoticeLabel>{th.notice.sampleData}</NoticeLabel> : null}
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
          <Row label={th.admin.products.columns.store}>
            <span className="flex flex-wrap items-center gap-2">
              <UserName>{product.store.name}</UserName>
              <StoreStatusBadge status={product.store.status} />
            </span>
          </Row>
          <Row label={text.sku}>
            <UserName>{product.sku}</UserName>
          </Row>
          <Row label={text.category}>
            <UserName>{product.category.name}</UserName>
            {product.category.isActive ? "" : ` ${text.categoryInactive}`}
          </Row>
          <Row label={th.admin.products.columns.price}>
            <Price satang={product.priceSatang} />
          </Row>
          <Row label={text.stock}>
            {fill(text.stockCount, { count: formatCount(product.stock) })}
          </Row>
          <Row label={text.revision}>{formatCount(product.contentRevision)}</Row>
          <Row label={text.requestedAt}>{formatDateTime(product.moderationRequestedAt)}</Row>
          <Row label={text.updatedAt}>{formatDateTime(product.updatedAt)}</Row>
        </dl>
        {product.moderationNote ? (
          <Alert tone="info" className="mt-4" role="note">
            <p className={`whitespace-pre-line ${USER_NAME_CONTAINER_CLASS}`}>
              {text.moderationNote}: <UserName>{product.moderationNote}</UserName>
            </p>
          </Alert>
        ) : null}
      </Card>

      <DecisionPanel product={product} />

      <Card as="section" padding="panel" aria-labelledby="product-description-title">
        <CardTitle as="h2" size="panel" id="product-description-title">
          {text.descriptionLabel}
        </CardTitle>
        <p className={`type-body mt-4 whitespace-pre-line ${USER_NAME_CONTAINER_CLASS}`}>
          <UserName>{product.description}</UserName>
        </p>
      </Card>

      <Card as="section" padding="panel" aria-labelledby="product-images-title">
        <CardTitle as="h2" size="panel" id="product-images-title">
          {text.images}
        </CardTitle>
        {product.images.length === 0 ? (
          <p className="type-body text-foreground-secondary mt-4">{text.noImages}</p>
        ) : (
          <ul aria-label={text.images} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {product.images.map((image) => (
              <li key={image.key}>
                <ProductImage image={image} alt="" sizes="200px" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div>
        <Link href={ADMIN_ROUTES.products} className={buttonVariants({ variant: "secondary" })}>
          {text.backToList}
        </Link>
      </div>
    </div>
  );
}

/**
 * Server Component: one product, whatever its state, through the module service. An id that cannot
 * be one is the same not-found as an unknown id, without a service call.
 */
export async function ProductSection({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderForAdmin(
    adminProductHref(id),
    async (actor) => {
      const parsed = idParamsSchema.safeParse({ id });
      if (!parsed.success) throw notFound();
      return <ProductDetailView product={await getProduct(actor, parsed.data.id)} />;
    },
    {
      notFound: (
        <AdminNotFoundState
          backHref={ADMIN_ROUTES.products}
          backLabel={th.admin.products.backToList}
        />
      ),
    },
  );
}
