"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApplicationBadge } from "@/components/seller/status-badges";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { AdminApplicationDto } from "@/modules/admin/schema";
import { AdminAction } from "./action-button";
import { ADMIN_ROUTES } from "./routes";

/** The seller applications as a data table; decisions only on `PENDING` ones (REQ-A-03). */
export function ApplicationsTable({ items }: { items: readonly AdminApplicationDto[] }) {
  const columns = th.admin.applications.columns;
  return (
    <Table caption={th.admin.applications.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{columns.applicant}</TableHead>
          <TableHead>{columns.store}</TableHead>
          <TableHead>{columns.status}</TableHead>
          <TableHead>{columns.createdAt}</TableHead>
          <TableHead>
            <span className="sr-only">{columns.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((application) => (
          <TableRow key={application.id}>
            <TableCell rowHeader className="min-w-48">
              <div className={`flex flex-col gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <span className="type-label">
                  <UserName>{application.applicant.name}</UserName>
                </span>
                <span className="type-small text-foreground-secondary font-normal">
                  <UserName>{application.applicant.email}</UserName>
                </span>
                {!application.applicant.isActive ? (
                  <span className="type-small text-danger font-normal">
                    {th.admin.applications.applicantInactive}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell label={columns.store} className="min-w-64">
              <div className={`flex flex-col gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <span className="type-label">
                  <UserName>{application.storeName}</UserName>
                </span>
                <span className="type-small text-foreground-secondary line-clamp-3 font-normal whitespace-pre-line">
                  <UserName>{application.description}</UserName>
                </span>
                <span className="type-small text-foreground-secondary font-normal">
                  {th.admin.applications.contactPhone}: {application.contactPhone}
                </span>
              </div>
            </TableCell>
            <TableCell label={columns.status}>
              <div className={`flex flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <ApplicationBadge status={application.status} />
                {application.reviewedAt ? (
                  <span className="type-small text-foreground-secondary">
                    {th.admin.applications.reviewedAt}: {formatDateTime(application.reviewedAt)}
                  </span>
                ) : null}
                {application.reviewNote ? (
                  <span className="type-small text-foreground-secondary whitespace-pre-line">
                    {th.admin.common.reasonLabel}: <UserName>{application.reviewNote}</UserName>
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell label={columns.createdAt}>{formatDateTime(application.createdAt)}</TableCell>
            <TableCell>
              {application.status === "PENDING" ? (
                <div className="flex flex-wrap gap-2">
                  <AdminAction
                    spec={{ kind: "application.approve", id: application.id }}
                    returnTo={ADMIN_ROUTES.applications}
                  />
                  <AdminAction
                    spec={{ kind: "application.reject", id: application.id }}
                    returnTo={ADMIN_ROUTES.applications}
                  />
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
