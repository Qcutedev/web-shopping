"use client";

import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { NoticeLabel } from "@/components/ui/notice-label";
import { Price } from "@/components/ui/price";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ModerationBadge,
  ProductStatusBadge,
  StoreStatusBadge,
} from "@/components/seller/status-badges";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { AdminProductDto } from "@/modules/admin/schema";
import { adminProductHref } from "./routes";

/** The products as a data table; each title opens the review page of the product (REQ-A-05). */
export function ProductsTable({ items }: { items: readonly AdminProductDto[] }) {
  const columns = th.admin.products.columns;
  return (
    <Table caption={th.admin.products.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{columns.product}</TableHead>
          <TableHead>{columns.store}</TableHead>
          <TableHead>{columns.status}</TableHead>
          <TableHead align="end">{columns.price}</TableHead>
          <TableHead>{columns.requestedAt}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((product) => (
          <TableRow key={product.id}>
            <TableCell rowHeader className="min-w-56">
              <div className="flex items-start gap-3">
                <ProductImage
                  image={product.images[0] ?? null}
                  alt=""
                  sizes="56px"
                  className="size-14 shrink-0"
                />
                <div
                  className={`flex min-w-0 flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}
                >
                  <Link
                    href={adminProductHref(product.id)}
                    className="focus-ring type-label rounded-sm underline-offset-4 hover:underline"
                  >
                    <UserName>{product.title}</UserName>
                  </Link>
                  <span className="type-small text-foreground-secondary font-normal">
                    {th.admin.products.sku}: <UserName>{product.sku}</UserName>
                  </span>
                  {product.isSample ? <NoticeLabel>{th.notice.sampleData}</NoticeLabel> : null}
                </div>
              </div>
            </TableCell>
            <TableCell label={columns.store}>
              <div className={`flex flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <UserName>{product.store.name}</UserName>
                <StoreStatusBadge status={product.store.status} />
              </div>
            </TableCell>
            <TableCell label={columns.status}>
              <div className="flex flex-wrap items-center gap-2">
                <ProductStatusBadge status={product.status} />
                <ModerationBadge status={product.moderationStatus} />
              </div>
            </TableCell>
            <TableCell align="end" label={columns.price}>
              <Price satang={product.priceSatang} />
            </TableCell>
            <TableCell label={columns.requestedAt}>
              {formatDateTime(product.moderationRequestedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
