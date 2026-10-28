"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { InputField } from "@/components/ui/input";
import { NoticeLabel } from "@/components/ui/notice-label";
import { th } from "@/i18n/th";
import { changeOrderStatus } from "@/lib/api-client/seller";
import {
  SELLER_TARGET_STATUSES,
  type SellerOrderStatusBody,
  type SellerTargetStatus,
  sellerOrderStatusBodySchema,
} from "@/modules/orders/seller-schema";
import { type FulfilmentStatusValue, isFulfilmentTransitionAllowed } from "@/modules/orders/state";
import {
  type FieldErrors,
  messageForCode,
  serverFieldErrors,
  validateWith,
} from "./form-validation";
import { SellerRequestError, type SellerFailure } from "./request-error";
import { sellerOrderHref } from "./routes";
import { useSyncedState } from "./use-synced-state";

const SHIP_FIELDS = ["carrierName", "trackingNumber"] as const;
type ShipField = (typeof SHIP_FIELDS)[number];

/**
 * The moves the table of API_CONTRACTS 3.2 allows a seller from `status`. Drawn from the same
 * table the server enforces (`FULFILMENT_TRANSITIONS`), only to decide which controls to show;
 * the server judges every move and answers 409 when it is not allowed.
 */
export function allowedSellerMoves(status: FulfilmentStatusValue): SellerTargetStatus[] {
  return SELLER_TARGET_STATUSES.filter((to) => isFulfilmentTransitionAllowed(status, to, "SELLER"));
}

const DONE_MESSAGE: Record<SellerTargetStatus, string> = {
  PROCESSING: th.seller.orders.actions.confirmed,
  SHIPPED: th.seller.orders.actions.shipped,
  DELIVERED: th.seller.orders.actions.delivered,
  CANCELLED: th.seller.orders.actions.cancelled,
};

/**
 * Status changes of one seller order (REQ-S-08, BR-14, BR-29, BR-35). A suspended store may still
 * use it. One request at a time; cancelling asks first and says the refund is outside the system.
 * Shipping is simulated and the carrier and tracking number are typed by the seller.
 */
export function OrderStatusPanel({
  orderId,
  status: serverStatus,
}: {
  orderId: string;
  status: FulfilmentStatusValue;
}) {
  const router = useRouter();
  // Follows the stored status the page passes in, so a refresh after a refused move (409) or a
  // missing order replaces the moves offered instead of keeping the stale ones.
  const [status, setStatus] = useSyncedState(serverStatus);
  const [pending, setPending] = useState<SellerTargetStatus | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [carrierName, setCarrierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [errors, setErrors] = useState<FieldErrors<ShipField>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<SellerFailure | null>(null);

  const returnTo = sellerOrderHref(orderId);
  const moves = allowedSellerMoves(status);
  const busy = pending !== null;

  async function send(body: SellerOrderStatusBody) {
    if (busy) return;
    setFailure(null);
    setNotice(null);
    setPending(body.to);
    const response = await changeOrderStatus(orderId, body);
    setPending(null);
    setConfirmingCancel(false);
    if (response.ok) {
      setStatus(response.data.fulfilmentStatus);
      setNotice(DONE_MESSAGE[body.to]);
      setCarrierName("");
      setTrackingNumber("");
      router.refresh();
      return;
    }
    if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, SHIP_FIELDS, (field, code) =>
        messageForCode(th.seller.fieldErrors[field], code),
      );
      setErrors(mapped.errors);
      if (mapped.unplaced) setFailure(response);
      return;
    }
    // The order moved under us (another tab, or the other path of a race): show the truth.
    if (response.code === "INVALID_STATE_TRANSITION" || response.code === "NOT_FOUND") {
      router.refresh();
    }
    setFailure(response);
  }

  function onShip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // A blank entry is left out of the request: the server reads a blank value as an error.
    const input: Record<string, string> = { to: "SHIPPED" };
    if (carrierName.trim() !== "") input.carrierName = carrierName;
    if (trackingNumber.trim() !== "") input.trackingNumber = trackingNumber;
    const result = validateWith<SellerOrderStatusBody, ShipField>(
      sellerOrderStatusBodySchema,
      input,
      SHIP_FIELDS,
      th.seller.fieldErrors,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    void send(result.body);
  }

  return (
    <Card as="section" padding="panel" aria-labelledby="order-actions-title">
      <CardTitle as="h2" size="panel" id="order-actions-title">
        {th.seller.orders.actions.title}
      </CardTitle>
      <div className="mt-4 flex flex-col gap-4">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {failure ? <SellerRequestError failure={failure} returnTo={returnTo} /> : null}

        {moves.length === 0 ? (
          <p className="type-body text-foreground-secondary">
            {th.seller.orders.actions.noActions}
          </p>
        ) : null}
        {status === "SHIPPED" ? (
          <p className="type-small text-foreground-muted">
            {th.seller.orders.actions.shippedLocked}
          </p>
        ) : null}

        {moves.includes("SHIPPED") ? (
          <form onSubmit={onShip} noValidate className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="type-card-title">{th.seller.orders.actions.shipTitle}</h3>
              <NoticeLabel>{th.notice.simulatedShipping}</NoticeLabel>
            </div>
            <p className="type-small text-foreground-muted">
              {th.seller.orders.detail.simulatedNote}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField
                label={th.seller.orders.actions.carrierName}
                name="carrierName"
                value={carrierName}
                onChange={(event) => setCarrierName(event.target.value)}
                errorText={errors.carrierName}
                autoComplete="off"
                disabled={busy}
              />
              <InputField
                label={th.seller.orders.actions.trackingNumber}
                name="trackingNumber"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                errorText={errors.trackingNumber}
                autoComplete="off"
                disabled={busy}
              />
            </div>
            <div>
              <Button
                type="submit"
                loading={pending === "SHIPPED"}
                disabled={busy && pending !== "SHIPPED"}
              >
                {th.seller.orders.actions.ship}
              </Button>
            </div>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {moves.includes("PROCESSING") ? (
            <Button
              loading={pending === "PROCESSING"}
              disabled={busy && pending !== "PROCESSING"}
              onClick={() => void send({ to: "PROCESSING" })}
            >
              {th.seller.orders.actions.confirm}
            </Button>
          ) : null}
          {moves.includes("DELIVERED") ? (
            <Button
              loading={pending === "DELIVERED"}
              disabled={busy && pending !== "DELIVERED"}
              onClick={() => void send({ to: "DELIVERED" })}
            >
              {th.seller.orders.actions.deliver}
            </Button>
          ) : null}
          {moves.includes("CANCELLED") ? (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(true)}>
              {th.seller.orders.actions.cancel}
            </Button>
          ) : null}
        </div>
      </div>
      {/* Cancelling cannot be undone and the refund is outside the system: ask first. */}
      <Dialog
        open={confirmingCancel}
        role="alertdialog"
        size="sm"
        dismissible={!busy}
        closeLabel={th.dialog.close}
        onClose={() => setConfirmingCancel(false)}
        title={th.seller.orders.actions.cancelConfirm}
        description={th.seller.orders.actions.cancelConfirmNote}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmingCancel(false)}>
              {th.seller.common.cancel}
            </Button>
            <Button
              variant="danger"
              loading={pending === "CANCELLED"}
              disabled={busy && pending !== "CANCELLED"}
              onClick={() => void send({ to: "CANCELLED" })}
            >
              {th.seller.orders.actions.cancelConfirmAction}
            </Button>
          </>
        }
      />
    </Card>
  );
}
