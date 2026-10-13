"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { ApiFailure } from "@/lib/api-client/http";
import { deleteAddress, updateAddress } from "@/lib/api-client/me";
import { ROUTES } from "@/lib/routes";
import type { AddressDto } from "@/modules/profile/schema";
import { AddressForm } from "./address-form";
import { RequestError } from "./request-error";

type Editor = { kind: "none" } | { kind: "create" } | { kind: "edit"; id: string };

/**
 * The address list of one page with add, edit, delete, and set-default (REQ-C-04). The list comes
 * from the server; after each change the page is refreshed so the server's order and default
 * flags are shown, not a guess made here. Deleting asks for confirmation inline.
 */
export function AddressBook({
  addresses,
  total,
  firstPageHref,
}: {
  addresses: readonly AddressDto[];
  /** Number of addresses of the user, over all pages. */
  total: number;
  /** Link to page 1, offered when the requested page is past the last one. */
  firstPageHref: string;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor>({ kind: "none" });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<Pick<ApiFailure, "status" | "code"> | null>(null);

  const editing =
    editor.kind === "edit" ? (addresses.find((entry) => entry.id === editor.id) ?? null) : null;

  function clearMessages() {
    setNotice(null);
    setFailure(null);
  }

  async function onSetDefault(address: AddressDto) {
    if (busyId !== null) return;
    clearMessages();
    setBusyId(address.id);
    const response = await updateAddress(address.id, { isDefault: true });
    setBusyId(null);
    if (response.ok) {
      setNotice(th.account.addresses.defaultSet);
      router.refresh();
      return;
    }
    if (response.code === "NOT_FOUND") router.refresh();
    setFailure(response);
  }

  async function onDelete(address: AddressDto) {
    if (busyId !== null) return;
    clearMessages();
    setBusyId(address.id);
    const response = await deleteAddress(address.id);
    setBusyId(null);
    setConfirmingId(null);
    if (response.ok) {
      if (editor.kind === "edit" && editor.id === address.id) setEditor({ kind: "none" });
      setNotice(th.account.addresses.deleted);
      router.refresh();
      return;
    }
    if (response.code === "NOT_FOUND") router.refresh();
    setFailure(response);
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {failure ? <RequestError failure={failure} returnTo={ROUTES.accountAddresses} /> : null}

      {editor.kind === "none" || (editor.kind === "edit" && editing === null) ? (
        <div>
          <Button
            onClick={() => {
              clearMessages();
              setEditor({ kind: "create" });
            }}
          >
            {th.account.addresses.add}
          </Button>
        </div>
      ) : (
        <AddressForm
          key={editor.kind === "edit" ? editor.id : "create"}
          address={editor.kind === "edit" ? editing : null}
          onCancel={() => setEditor({ kind: "none" })}
          onGone={() => router.refresh()}
          onSaved={(_saved, kind) => {
            setEditor({ kind: "none" });
            setNotice(
              kind === "created" ? th.account.addresses.created : th.account.addresses.updated,
            );
            router.refresh();
          }}
        />
      )}

      {addresses.length === 0 ? (
        total === 0 ? (
          <EmptyState
            title={th.account.addresses.emptyTitle}
            description={th.account.addresses.emptyDescription}
          />
        ) : (
          <EmptyState
            title={th.account.addresses.pageEmptyTitle}
            action={
              <Link href={firstPageHref} className={buttonVariants({ variant: "secondary" })}>
                {th.account.addresses.pageEmptyAction}
              </Link>
            }
          />
        )
      ) : (
        <ul aria-label={th.account.addresses.listLabel} className="flex flex-col gap-4">
          {addresses.map((address) => {
            const busy = busyId === address.id;
            const confirming = confirmingId === address.id;
            return (
              <Card as="li" key={address.id} padding="panel" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`type-card-title ${USER_NAME_CONTAINER_CLASS}`}>
                    <UserName>{address.recipientName}</UserName>
                  </p>
                  {address.isDefault ? (
                    <Badge variant="primary">{th.account.addresses.defaultBadge}</Badge>
                  ) : null}
                </div>
                <p className="type-body text-foreground-secondary">{address.phone}</p>
                <p className={`type-body ${USER_NAME_CONTAINER_CLASS}`}>
                  <UserName>{address.line1}</UserName> <UserName>{address.subdistrict}</UserName>{" "}
                  <UserName>{address.district}</UserName> <UserName>{address.province}</UserName>{" "}
                  {address.postalCode}
                </p>

                {confirming ? (
                  <Alert
                    tone="warning"
                    title={th.account.addresses.deleteConfirm}
                    role="alertdialog"
                    action={
                      <div className="flex flex-wrap gap-3">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          onClick={() => void onDelete(address)}
                        >
                          {th.account.addresses.deleteConfirmAction}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmingId(null)}
                        >
                          {th.account.common.cancel}
                        </Button>
                      </div>
                    }
                  >
                    {th.account.addresses.deleteConfirmNote}
                  </Alert>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busyId !== null}
                      aria-label={fill(th.account.addresses.editLabel, {
                        name: address.recipientName,
                      })}
                      onClick={() => {
                        clearMessages();
                        setEditor({ kind: "edit", id: address.id });
                      }}
                    >
                      {th.account.common.edit}
                    </Button>
                    {address.isDefault ? null : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        disabled={busyId !== null && !busy}
                        aria-label={fill(th.account.addresses.setDefaultLabel, {
                          name: address.recipientName,
                        })}
                        onClick={() => void onSetDefault(address)}
                      >
                        {th.account.addresses.setDefault}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId !== null}
                      aria-label={fill(th.account.addresses.deleteLabel, {
                        name: address.recipientName,
                      })}
                      onClick={() => {
                        clearMessages();
                        setConfirmingId(address.id);
                      }}
                    >
                      {th.account.common.remove}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
