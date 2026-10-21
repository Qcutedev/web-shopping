"use client";

import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { Badge } from "@/components/ui/badge";
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
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { SellerProductDto } from "@/modules/inventory/schema";
import { formatCount } from "./format-count";
import { sellerProductHref } from "./routes";
import { ModerationBadge, ProductStatusBadge } from "./status-badges";

/**
 * The seller's products as a data table (design system: dashboards use Table). A Client Component
 * because the Table primitive keeps its density in a React context. Presentation only: price,
 * stock, and the low-stock and sold-out flags are the server's.
 */
export function ProductsTable({ items }: { items: readonly SellerProductDto[] }) {
  return (
    <Table caption={th.seller.products.listLabel} captionHidden density="dense">
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{th.seller.products.columns.product}</TableHead>
          <TableHead>{th.seller.products.columns.status}</TableHead>
          <TableHead align="end">{th.seller.products.columns.price}</TableHead>
          <TableHead align="end">{th.seller.products.columns.stock}</TableHead>
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
                <div className={`flex min-w-0 flex-col gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                  <Link
                    href={sellerProductHref(product.id)}
                    className="focus-ring type-label rounded-sm underline-offset-4 hover:underline"
                  >
                    <UserName>{product.title}</UserName>
                  </Link>
                  <span className="type-small text-foreground-secondary font-normal">
                    {th.seller.products.row.sku}: <UserName>{product.sku}</UserName>
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell>
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
            </TableCell>
            <TableCell align="end">
              <Price satang={product.priceSatang} />
            </TableCell>
            <TableCell align="end">
              {fill(th.seller.products.row.stockCount, { count: formatCount(product.stock) })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
