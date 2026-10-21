"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { th } from "@/i18n/th";
import { deleteProduct, type ProductAction, runProductAction } from "@/lib/api-client/seller";
import type { SellerProductDto } from "@/modules/inventory/schema";
import { SellerRequestError, type SellerFailure } from "./request-error";
import { SELLER_ROUTES, sellerProductHref } from "./routes";

type Pending = ProductAction | "delete";
type Confirming = "archive" | "delete";

export const REMOVED_PARAM = "removed";

/**
 * Publish, unpublish, archive, and delete (REQ-S-04, BR-12). Archive and delete ask for
 * confirmation first. One request at a time. The buttons that the state table cannot allow are
 * disabled for convenience; the server judges every move and answers 409 when it is not allowed.
 * The page is refreshed after a change so the badges come from the stored product.
 */
export function ProductActions({
  product,
  disabled = false,
}: {
  product: Pick<SellerProductDto, "id" | "status" | "moderationStatus">;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<SellerFailure | null>(null);

  const returnTo = sellerProductHref(product.id);
  const busy = pending !== null;
  const archived = product.status === "ARCHIVED";

  async function run(action: ProductAction) {
    if (busy) return;
    setFailure(null);
    setNotice(null);
    setPending(action);
    const response = await runProductAction(product.id, action);
    setPending(null);
    setConfirming(null);
    if (response.ok) {
      setNotice(
        action === "publish"
          ? response.data.moderationStatus === "APPROVED"
            ? th.seller.products.actions.published
            : th.seller.products.actions.publishedPending
          : action === "unpublish"
            ? th.seller.products.actions.unpublished
            : th.seller.products.actions.archived,
      );
      router.refresh();
      return;
    }
    if (
      response.code === "INVALID_STATE_TRANSITION" ||
      response.code === "NOT_FOUND" ||
      response.code === "SELLER_NOT_APPROVED"
    ) {
      router.refresh();
    }
    setFailure(response);
  }

  async function remove() {
    if (busy) return;
    setFailure(null);
    setNotice(null);
    setPending("delete");
    const response = await deleteProduct(product.id);
    setPending(null);
    setConfirming(null);
    if (response.ok) {
      if (response.data.outcome === "DELETED") {
        router.push(`${SELLER_ROUTES.products}?${REMOVED_PARAM}=deleted`);
        return;
      }
      setNotice(th.seller.products.actions.deletedArchived);
      router.refresh();
      return;
    }
    if (response.code !== "VALIDATION_ERROR") router.refresh();
    setFailure(response);
  }

  const confirm = th.seller.products.actions;

  return (
    <Card as="section" padding="panel" aria-labelledby="product-actions-title">
      <CardTitle as="h2" size="panel" id="product-actions-title">
        {th.seller.products.actions.title}
      </CardTitle>
      <div className="mt-4 flex flex-col gap-4">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {failure ? <SellerRequestError failure={failure} returnTo={returnTo} /> : null}

        {confirming !== null ? (
          <Alert
            tone="warning"
            role="alertdialog"
            title={confirming === "archive" ? confirm.archiveConfirm : confirm.deleteConfirm}
            action={
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  size="sm"
                  loading={pending === (confirming === "archive" ? "archive" : "delete")}
                  disabled={busy}
                  onClick={() => void (confirming === "archive" ? run("archive") : remove())}
                >
                  {confirming === "archive"
                    ? confirm.archiveConfirmAction
                    : confirm.deleteConfirmAction}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                >
                  {th.seller.common.cancel}
                </Button>
              </div>
            }
          >
            {confirming === "archive" ? confirm.archiveConfirmNote : confirm.deleteConfirmNote}
          </Alert>
        ) : (
          <div className="flex flex-wrap gap-3">
            {product.status === "DRAFT" ? (
              <Button
                loading={pending === "publish"}
                disabled={disabled || busy}
                onClick={() => void run("publish")}
              >
                {th.seller.products.actions.publish}
              </Button>
            ) : null}
            {product.status === "PUBLISHED" ? (
              <Button
                variant="secondary"
                loading={pending === "unpublish"}
                disabled={disabled || busy}
                onClick={() => void run("unpublish")}
              >
                {th.seller.products.actions.unpublish}
              </Button>
            ) : null}
            {!archived ? (
              <Button
                variant="secondary"
                disabled={disabled || busy}
                onClick={() => setConfirming("archive")}
              >
                {th.seller.products.actions.archive}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => setConfirming("delete")}
            >
              {th.seller.products.actions.delete}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
