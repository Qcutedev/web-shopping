import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { USER_NAME_CONTAINER_CLASS, UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { SellerApplicationDto } from "@/modules/sellers/schema";
import { ApplicationForm } from "./application-form";
import { SELLER_ROUTES } from "./routes";
import { ApplicationBadge } from "./status-badges";

/**
 * The applicant's view (REQ-S-01): the latest application with its status and, on rejection, the
 * reason; the form when there is none or the last one was rejected. Pure presentation of rows the
 * server returned.
 */
export function ApplyView({ application }: { application: SellerApplicationDto | null }) {
  if (application === null) {
    return <ApplicationForm title={th.seller.apply.formTitle} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <Card as="section" padding="panel" aria-labelledby="application-status-title">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle as="h2" size="panel" id="application-status-title">
            {th.seller.apply.statusTitle}
          </CardTitle>
          <ApplicationBadge status={application.status} />
        </div>

        {application.status === "PENDING" ? (
          <Alert tone="info" className="mt-4">
            {th.seller.apply.pendingNote}
          </Alert>
        ) : null}
        {application.status === "APPROVED" ? (
          <Alert
            tone="success"
            className="mt-4"
            action={
              <Link href={SELLER_ROUTES.dashboard} className={buttonVariants({ size: "sm" })}>
                {th.seller.nav.dashboard}
              </Link>
            }
          >
            {th.seller.apply.approvedNote}
          </Alert>
        ) : null}
        {application.status === "REJECTED" ? (
          <Alert tone="danger" title={th.seller.apply.rejectReason} className="mt-4">
            {application.reviewNote ? (
              <span className={`block whitespace-pre-line ${USER_NAME_CONTAINER_CLASS}`}>
                <UserName>{application.reviewNote}</UserName>
              </span>
            ) : null}
          </Alert>
        ) : null}

        <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
          <dt className="type-label text-foreground-secondary">
            {th.seller.apply.fields.storeName}
          </dt>
          <dd className={USER_NAME_CONTAINER_CLASS}>
            <UserName>{application.storeName}</UserName>
          </dd>
          <dt className="type-label text-foreground-secondary">
            {th.seller.apply.fields.description}
          </dt>
          <dd className={`whitespace-pre-line ${USER_NAME_CONTAINER_CLASS}`}>
            <UserName>{application.description}</UserName>
          </dd>
          <dt className="type-label text-foreground-secondary">
            {th.seller.apply.fields.contactPhone}
          </dt>
          <dd>{application.contactPhone}</dd>
          <dt className="type-label text-foreground-secondary">{th.seller.apply.sentAt}</dt>
          <dd>{formatDateTime(application.createdAt)}</dd>
          {application.reviewedAt ? (
            <>
              <dt className="type-label text-foreground-secondary">{th.seller.apply.reviewedAt}</dt>
              <dd>{formatDateTime(application.reviewedAt)}</dd>
            </>
          ) : null}
        </dl>
      </Card>

      {application.status === "REJECTED" ? (
        <div className="flex flex-col gap-3">
          <p className="type-body text-foreground-secondary">{th.seller.apply.reapplyNote}</p>
          <ApplicationForm title={th.seller.apply.reapplyTitle} />
        </div>
      ) : null}
    </div>
  );
}
