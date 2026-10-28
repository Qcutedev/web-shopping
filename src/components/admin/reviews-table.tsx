"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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
import { formatDateTime } from "@/lib/format";
import type { AdminReviewDto } from "@/modules/admin/schema";
import { AdminAction } from "./action-button";
import { adminProductHref, ADMIN_ROUTES } from "./routes";

/**
 * The reviews as a data table, hidden ones included (API_CONTRACTS 5.9.9). The comment is customer
 * text: it is rendered as plain text, isolated with `UserName`, never as markup. The hide or
 * un-hide button follows the stored state; the server judges every request.
 */
export function ReviewsTable({ items }: { items: readonly AdminReviewDto[] }) {
  const columns = th.admin.reviews.columns;
  return (
    <Table caption={th.admin.reviews.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{columns.review}</TableHead>
          <TableHead>{columns.product}</TableHead>
          <TableHead>{columns.author}</TableHead>
          <TableHead>{columns.status}</TableHead>
          <TableHead>{columns.createdAt}</TableHead>
          <TableHead>
            <span className="sr-only">{columns.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((review) => {
          const hidden = review.hiddenAt !== null;
          return (
            <TableRow key={review.id}>
              <TableCell rowHeader className="min-w-56">
                <div className={`flex flex-col gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                  <span className="type-label">
                    {fill(th.admin.reviews.rating, { rating: review.rating })}
                  </span>
                  <span className="type-small text-foreground-secondary font-normal whitespace-pre-line">
                    {review.comment !== null && review.comment !== "" ? (
                      <UserName>{review.comment}</UserName>
                    ) : (
                      th.admin.reviews.noComment
                    )}
                  </span>
                </div>
              </TableCell>
              <TableCell label={columns.product}>
                <div className={`flex flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                  <Link
                    href={adminProductHref(review.product.id)}
                    className="focus-ring rounded-sm underline underline-offset-4"
                  >
                    <UserName>{review.product.title}</UserName>
                  </Link>
                </div>
              </TableCell>
              <TableCell label={columns.author}>
                <UserName>{review.author.name}</UserName>
              </TableCell>
              <TableCell label={columns.status}>
                <div className={`flex flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                  <Badge variant={hidden ? "danger" : "success"}>
                    {hidden ? th.admin.reviews.hidden : th.admin.reviews.public}
                  </Badge>
                  {review.hiddenAt !== null ? (
                    <span className="type-small text-foreground-secondary font-normal">
                      {th.admin.reviews.hiddenAt}: {formatDateTime(review.hiddenAt)}
                    </span>
                  ) : null}
                  {review.hiddenReason !== null ? (
                    <span className="type-small text-foreground-secondary font-normal">
                      {th.admin.reviews.hiddenReason}: <UserName>{review.hiddenReason}</UserName>
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell label={columns.createdAt}>{formatDateTime(review.createdAt)}</TableCell>
              <TableCell>
                <AdminAction
                  spec={{ kind: hidden ? "review.unhide" : "review.hide", id: review.id }}
                  returnTo={ADMIN_ROUTES.reviews}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
