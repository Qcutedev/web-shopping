import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import type { SellerProductDto } from "@/modules/inventory/schema";
import { ProductActions } from "./product-actions";
import { type CategoryOption, ProductForm } from "./product-form";
import { StockPanel } from "./stock-panel";
import { Badge } from "@/components/ui/badge";
import { ModerationBadge, ProductStatusBadge } from "./status-badges";

/**
 * One product as its seller sees it: state badges, the moderation message, then the actions, the
 * stock, and the edit form. `suspended` and the archived state disable the write controls for
 * convenience; the server refuses those writes either way (BR-14).
 */
export function ProductDetailView({
  product,
  categories,
  suspended,
  created,
}: {
  product: SellerProductDto;
  categories: readonly CategoryOption[];
  suspended: boolean;
  created: boolean;
}) {
  const archived = product.status === "ARCHIVED";
  const rejected = product.moderationStatus === "REJECTED";
  const takenDown = product.moderationStatus === "TAKEN_DOWN";

  return (
    <div className="flex flex-col gap-6">
      {created ? <Alert tone="success">{th.seller.products.created}</Alert> : null}

      <Card as="section" padding="panel" aria-labelledby="product-summary-title">
        <h2 id="product-summary-title" className={`type-panel-title ${USER_NAME_CONTAINER_CLASS}`}>
          <UserName>{product.title}</UserName>
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
        <p className="type-body mt-3">
          <Price satang={product.priceSatang} />
        </p>
      </Card>

      {suspended ? (
        <Alert tone="warning" role="note">
          {th.seller.products.suspendedNote}
        </Alert>
      ) : null}
      {archived ? (
        <Alert tone="info" role="note">
          {th.seller.products.archivedNote}
        </Alert>
      ) : null}
      {rejected || takenDown ? (
        <Alert
          tone="danger"
          title={rejected ? th.seller.products.rejectedTitle : th.seller.products.takenDownTitle}
          role="note"
        >
          {product.moderationNote ? (
            <p className={`whitespace-pre-line ${USER_NAME_CONTAINER_CLASS}`}>
              {th.seller.products.moderationNote}: <UserName>{product.moderationNote}</UserName>
            </p>
          ) : null}
          {!archived ? <p className="mt-1">{th.seller.products.resubmitNote}</p> : null}
        </Alert>
      ) : null}
      {!archived && product.moderationStatus === "PENDING" ? (
        <Alert tone="info" role="note">
          {product.status === "DRAFT"
            ? th.seller.products.draftNote
            : th.seller.products.pendingNote}
        </Alert>
      ) : null}

      <ProductActions product={product} disabled={suspended} />
      <StockPanel product={product} disabled={suspended || archived} />
      <ProductForm product={product} categories={categories} disabled={suspended || archived} />
    </div>
  );
}
