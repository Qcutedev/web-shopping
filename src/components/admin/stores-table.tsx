"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { NoticeLabel } from "@/components/ui/notice-label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StoreStatusBadge } from "@/components/seller/status-badges";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { AdminStoreDto } from "@/modules/admin/schema";
import { AdminAction } from "./action-button";
import { ADMIN_ROUTES } from "./routes";

/** The stores as a data table, hidden ones included; suspend and reinstate need a reason (REQ-A-04). */
export function StoresTable({ items }: { items: readonly AdminStoreDto[] }) {
  const columns = th.admin.stores.columns;
  return (
    <Table caption={th.admin.stores.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{columns.store}</TableHead>
          <TableHead>{columns.status}</TableHead>
          <TableHead>{columns.owner}</TableHead>
          <TableHead>{columns.createdAt}</TableHead>
          <TableHead>
            <span className="sr-only">{columns.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((store) => (
          <TableRow key={store.id}>
            <TableCell rowHeader className="min-w-48">
              <div className={`flex flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <span className="type-label">
                  <UserName>{store.name}</UserName>
                </span>
                <span className="type-small text-foreground-secondary font-normal">
                  <UserName>{store.slug}</UserName>
                </span>
                {store.isSample ? <NoticeLabel>{th.notice.sampleData}</NoticeLabel> : null}
              </div>
            </TableCell>
            <TableCell label={columns.status}>
              <div className={`flex flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <StoreStatusBadge status={store.status} />
                {store.statusReason ? (
                  <span className="type-small text-foreground-secondary whitespace-pre-line">
                    {th.admin.stores.statusReason}: <UserName>{store.statusReason}</UserName>
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell label={columns.owner}>
              <div className={`flex flex-col gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <span className="type-small">{store.ownerId}</span>
                {!store.ownerIsActive ? (
                  <span className="type-small text-danger">{th.admin.stores.ownerInactive}</span>
                ) : null}
              </div>
            </TableCell>
            <TableCell label={columns.createdAt}>{formatDateTime(store.createdAt)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <AdminAction
                  spec={{
                    kind: store.status === "APPROVED" ? "store.suspend" : "store.reinstate",
                    id: store.id,
                  }}
                  returnTo={ADMIN_ROUTES.stores}
                />
                <Link
                  href={`${ADMIN_ROUTES.products}?view=all&storeId=${encodeURIComponent(store.id)}`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  {th.admin.stores.viewProducts}
                </Link>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
