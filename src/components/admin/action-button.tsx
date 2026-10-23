"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextareaField } from "@/components/ui/textarea";
import { th } from "@/i18n/th";
import * as api from "@/lib/api-client/admin";
import type { ApiResult } from "@/lib/api-client/http";
import { reviewReasonSchema } from "@/modules/sellers/schema";
import { AdminRequestError, type AdminFailure } from "./request-error";
import { messageForCode } from "./reason-copy";

/**
 * One admin decision, as plain data so a Server Component can hand it to this Client Component.
 * `contentRevision` is the revision the admin was shown (API_CONTRACTS 5.9.3): it travels back with
 * the decision so the server can refuse a decision on something that changed.
 */
export type AdminActionSpec =
  | { kind: "user.deactivate"; id: string }
  | { kind: "user.reactivate"; id: string }
  | { kind: "application.approve"; id: string }
  | { kind: "application.reject"; id: string }
  | { kind: "store.suspend"; id: string }
  | { kind: "store.reinstate"; id: string }
  | { kind: "product.approve"; id: string; contentRevision: number }
  | { kind: "product.reject"; id: string; contentRevision: number }
  | { kind: "product.takedown"; id: string; contentRevision: number }
  | { kind: "category.deactivate"; id: string }
  | { kind: "category.reactivate"; id: string }
  | { kind: "category.delete"; id: string }
  | { kind: "order.cancel"; id: string }
  | { kind: "order.deliver"; id: string };

export type AdminActionKind = AdminActionSpec["kind"];

interface ActionCopy {
  trigger: string;
  heading: string;
  note: string;
  confirm: string;
  done: string;
  variant: ButtonVariant;
  /** The decision needs a reason (rejections, takedown, suspension, reinstatement). */
  reason: boolean;
}

/** Texts of every action. The names of the keys in `th.admin` follow the kinds. */
export const ACTION_COPY: Readonly<Record<AdminActionKind, ActionCopy>> = {
  "user.deactivate": {
    trigger: th.admin.users.deactivate,
    heading: th.admin.users.deactivateConfirm,
    note: th.admin.users.deactivateConfirmNote,
    confirm: th.admin.users.deactivateConfirmAction,
    done: th.admin.users.deactivated,
    variant: "danger",
    reason: false,
  },
  "user.reactivate": {
    trigger: th.admin.users.reactivate,
    heading: th.admin.users.reactivateConfirm,
    note: th.admin.users.reactivateConfirmNote,
    confirm: th.admin.users.reactivateConfirmAction,
    done: th.admin.users.reactivated,
    variant: "primary",
    reason: false,
  },
  "application.approve": {
    trigger: th.admin.applications.approve,
    heading: th.admin.applications.approveConfirm,
    note: th.admin.applications.approveConfirmNote,
    confirm: th.admin.applications.approveConfirmAction,
    done: th.admin.applications.approved,
    variant: "primary",
    reason: false,
  },
  "application.reject": {
    trigger: th.admin.applications.reject,
    heading: th.admin.applications.rejectConfirm,
    note: th.admin.applications.rejectConfirmNote,
    confirm: th.admin.applications.rejectConfirmAction,
    done: th.admin.applications.rejected,
    variant: "danger",
    reason: true,
  },
  "store.suspend": {
    trigger: th.admin.stores.suspend,
    heading: th.admin.stores.suspendConfirm,
    note: th.admin.stores.suspendConfirmNote,
    confirm: th.admin.stores.suspendConfirmAction,
    done: th.admin.stores.suspended,
    variant: "danger",
    reason: true,
  },
  "store.reinstate": {
    trigger: th.admin.stores.reinstate,
    heading: th.admin.stores.reinstateConfirm,
    note: th.admin.stores.reinstateConfirmNote,
    confirm: th.admin.stores.reinstateConfirmAction,
    done: th.admin.stores.reinstated,
    variant: "primary",
    reason: true,
  },
  "product.approve": {
    trigger: th.admin.products.approve,
    heading: th.admin.products.approveConfirm,
    note: th.admin.products.approveConfirmNote,
    confirm: th.admin.products.approveConfirmAction,
    done: th.admin.products.approved,
    variant: "primary",
    reason: false,
  },
  "product.reject": {
    trigger: th.admin.products.reject,
    heading: th.admin.products.rejectConfirm,
    note: th.admin.products.rejectConfirmNote,
    confirm: th.admin.products.rejectConfirmAction,
    done: th.admin.products.rejected,
    variant: "danger",
    reason: true,
  },
  "product.takedown": {
    trigger: th.admin.products.takedown,
    heading: th.admin.products.takedownConfirm,
    note: th.admin.products.takedownConfirmNote,
    confirm: th.admin.products.takedownConfirmAction,
    done: th.admin.products.takenDown,
    variant: "danger",
    reason: true,
  },
  "category.deactivate": {
    trigger: th.admin.categories.deactivate,
    heading: th.admin.categories.deactivateConfirm,
    note: th.admin.categories.deactivateConfirmNote,
    confirm: th.admin.categories.deactivateConfirmAction,
    done: th.admin.categories.deactivated,
    variant: "danger",
    reason: false,
  },
  "category.reactivate": {
    trigger: th.admin.categories.reactivate,
    heading: th.admin.categories.reactivateConfirm,
    note: th.admin.categories.reactivateConfirmNote,
    confirm: th.admin.categories.reactivateConfirmAction,
    done: th.admin.categories.reactivated,
    variant: "primary",
    reason: false,
  },
  "category.delete": {
    trigger: th.admin.categories.delete,
    heading: th.admin.categories.deleteConfirm,
    note: th.admin.categories.deleteConfirmNote,
    confirm: th.admin.categories.deleteConfirmAction,
    done: th.admin.categories.deleted,
    variant: "danger",
    reason: false,
  },
  "order.cancel": {
    trigger: th.admin.orders.actions.cancel,
    heading: th.admin.orders.actions.cancelConfirm,
    note: th.admin.orders.actions.cancelConfirmNote,
    confirm: th.admin.orders.actions.cancelConfirmAction,
    done: th.admin.orders.actions.cancelled,
    variant: "danger",
    reason: false,
  },
  "order.deliver": {
    trigger: th.admin.orders.actions.deliver,
    heading: th.admin.orders.actions.deliverConfirm,
    note: th.admin.orders.actions.deliverConfirmNote,
    confirm: th.admin.orders.actions.deliverConfirmAction,
    done: th.admin.orders.actions.delivered,
    variant: "primary",
    reason: false,
  },
};

/** Sends the request of `spec`. Mutations go through the documented `/api/v1/admin` endpoints. */
function send(spec: AdminActionSpec, reason: string): Promise<ApiResult<unknown>> {
  switch (spec.kind) {
    case "user.deactivate":
      return api.deactivateUser(spec.id);
    case "user.reactivate":
      return api.reactivateUser(spec.id);
    case "application.approve":
      return api.approveApplication(spec.id);
    case "application.reject":
      return api.rejectApplication(spec.id, { reason });
    case "store.suspend":
      return api.suspendStore(spec.id, { reason });
    case "store.reinstate":
      return api.reinstateStore(spec.id, { reason });
    case "product.approve":
      return api.approveProduct(spec.id, { contentRevision: spec.contentRevision });
    case "product.reject":
      return api.rejectProduct(spec.id, { contentRevision: spec.contentRevision, reason });
    case "product.takedown":
      return api.takedownProduct(spec.id, { contentRevision: spec.contentRevision, reason });
    case "category.deactivate":
      return api.updateCategory(spec.id, { isActive: false });
    case "category.reactivate":
      return api.updateCategory(spec.id, { isActive: true });
    case "category.delete":
      return api.deleteCategory(spec.id);
    case "order.cancel":
      return api.changeSellerOrderStatus(spec.id, { to: "CANCELLED" });
    case "order.deliver":
      return api.changeSellerOrderStatus(spec.id, { to: "DELIVERED" });
  }
}

/** Name of the browser event that carries a success message to `AdminNoticeRegion`. */
export const ADMIN_NOTICE_EVENT = "admin:notice";

/**
 * Where the confirmation of a decision is shown. It lives outside the row or panel that raised
 * it, because that row usually changes after the refresh (a deactivate button becomes a reactivate
 * button) and would take its own message with it.
 */
export function AdminNoticeRegion() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    function onNotice(event: Event) {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        setMessage(event.detail);
      }
    }
    window.addEventListener(ADMIN_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(ADMIN_NOTICE_EVENT, onNotice);
  }, []);
  return (
    <div role="status" aria-live="polite">
      {message !== null ? <Alert tone="success">{message}</Alert> : null}
    </div>
  );
}

/**
 * A button that asks first, then sends one admin decision. One request at a time: every control
 * of the dialog is disabled while it is pending. A refusal is shown in Thai inside the dialog and,
 * when the record moved under the admin (409, 404), the page is refreshed to show what is stored.
 * Hiding or showing the button is a convenience; the server judges every request.
 */
export function AdminAction({
  spec,
  returnTo,
  size = "sm",
}: {
  spec: AdminActionSpec;
  returnTo: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const copy = ACTION_COPY[spec.kind];
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [failure, setFailure] = useState<AdminFailure | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setFailure(null);
    setReasonError(undefined);
  }

  async function confirm(event?: FormEvent) {
    event?.preventDefault();
    if (pending) return;
    setFailure(null);
    let text = "";
    if (copy.reason) {
      const parsed = reviewReasonSchema.safeParse(reason);
      if (!parsed.success) {
        const code = parsed.error.issues[0]?.code ?? "custom";
        setReasonError(messageForCode(code));
        reasonRef.current?.focus();
        return;
      }
      setReasonError(undefined);
      text = parsed.data;
    }
    setPending(true);
    const response = await send(spec, text);
    setPending(false);
    if (response.ok) {
      setOpen(false);
      setReason("");
      window.dispatchEvent(new CustomEvent(ADMIN_NOTICE_EVENT, { detail: copy.done }));
      router.refresh();
      return;
    }
    if (response.code === "VALIDATION_ERROR") {
      const onReason = response.fields.some((field) => field.path === "reason");
      if (onReason) {
        setReasonError(messageForCode(response.fields.find((f) => f.path === "reason")!.code));
        return;
      }
    }
    // The record moved under us (another tab, another admin, the seller): show what is stored.
    if (
      response.code === "INVALID_STATE_TRANSITION" ||
      response.code === "NOT_FOUND" ||
      (response.code === "CONFLICT" && response.reason === "STALE_REVISION")
    ) {
      router.refresh();
    }
    setFailure(response);
  }

  return (
    <>
      <Button type="button" variant="secondary" size={size} onClick={() => setOpen(true)}>
        {copy.trigger}
      </Button>
      <Dialog
        open={open}
        role="alertdialog"
        size="md"
        dismissible={!pending}
        closeLabel={th.dialog.close}
        onClose={close}
        title={copy.heading}
        description={copy.note}
        initialFocusRef={copy.reason ? reasonRef : undefined}
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={close}>
              {th.admin.common.cancel}
            </Button>
            <Button
              variant={copy.variant}
              loading={pending}
              disabled={pending}
              onClick={() => void confirm()}
            >
              {copy.confirm}
            </Button>
          </>
        }
      >
        <form onSubmit={(event) => void confirm(event)} noValidate className="flex flex-col gap-4">
          {failure ? <AdminRequestError failure={failure} returnTo={returnTo} /> : null}
          {copy.reason ? (
            <TextareaField
              ref={reasonRef}
              label={th.admin.common.reasonLabel}
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              helperText={th.admin.common.reasonHelper}
              errorText={reasonError}
              required
              disabled={pending}
            />
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
