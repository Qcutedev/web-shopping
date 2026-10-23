"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { AuditLogDto } from "@/modules/admin/schema";

/**
 * The audit log as a read-only data table (REQ-A-10). `metadata` is shown as the JSON the server
 * stored, as text: React escapes it and nothing here edits or deletes an entry.
 */
export function AuditTable({ items }: { items: readonly AuditLogDto[] }) {
  const columns = th.admin.audit.columns;
  return (
    <Table caption={th.admin.audit.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{columns.time}</TableHead>
          <TableHead>{columns.action}</TableHead>
          <TableHead>{columns.target}</TableHead>
          <TableHead>{columns.actor}</TableHead>
          <TableHead>{columns.details}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((entry) => (
          <TableRow key={entry.id} interactive={false}>
            <TableCell rowHeader>{formatDateTime(entry.createdAt)}</TableCell>
            <TableCell label={columns.action}>
              <code className="type-small [overflow-wrap:anywhere]">{entry.action}</code>
            </TableCell>
            <TableCell label={columns.target}>
              <div className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
                <span>{entry.targetType}</span>
                <span className="type-small text-foreground-secondary">{entry.targetId}</span>
              </div>
            </TableCell>
            <TableCell label={columns.actor}>
              <span className="type-small [overflow-wrap:anywhere]">{entry.actorId}</span>
            </TableCell>
            <TableCell label={columns.details}>
              <details>
                <summary className="type-label focus-ring cursor-pointer rounded-sm">
                  {th.admin.audit.showDetails}
                </summary>
                <pre className="type-small bg-surface-muted mt-2 max-w-full overflow-x-auto rounded-sm p-2 [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </details>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
