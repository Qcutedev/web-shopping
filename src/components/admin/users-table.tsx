"use client";

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
import { th } from "@/i18n/th";
import { formatDateTime } from "@/lib/format";
import type { AdminUserDto } from "@/modules/admin/schema";
import { AdminAction } from "./action-button";
import { ADMIN_ROUTES } from "./routes";
import { StoreStatusBadge } from "@/components/seller/status-badges";

/**
 * The users as a data table. A Client Component because the Table primitive keeps its density in a
 * React context and the row actions are interactive. `selfId` only hides the deactivate button on
 * the admin's own row; the server refuses a self-deactivation either way (REQ-A-02).
 */
export function UsersTable({ items, selfId }: { items: readonly AdminUserDto[]; selfId: string }) {
  const columns = th.admin.users.columns;
  return (
    <Table caption={th.admin.users.listLabel} captionHidden density="dense" stacked>
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>{columns.user}</TableHead>
          <TableHead>{columns.role}</TableHead>
          <TableHead>{columns.status}</TableHead>
          <TableHead>{columns.store}</TableHead>
          <TableHead>{columns.createdAt}</TableHead>
          <TableHead>
            <span className="sr-only">{columns.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((user) => (
          <TableRow key={user.id}>
            <TableCell rowHeader className="min-w-56">
              <div className={`flex flex-col gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                <span className="type-label">
                  <UserName>{user.name}</UserName>
                </span>
                <span className="type-small text-foreground-secondary font-normal">
                  <UserName>{user.email}</UserName>
                </span>
                {user.phone ? (
                  <span className="type-small text-foreground-secondary font-normal">
                    {user.phone}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell label={columns.role}>
              <Badge variant={user.role === "ADMIN" ? "primary" : "neutral"}>
                {th.admin.users.roles[user.role]}
              </Badge>
            </TableCell>
            <TableCell label={columns.status}>
              <Badge variant={user.isActive ? "success" : "danger"}>
                {user.isActive ? th.admin.users.active : th.admin.users.inactive}
              </Badge>
            </TableCell>
            <TableCell label={columns.store}>
              {user.store ? (
                <div className={`flex flex-col items-start gap-1 ${USER_NAME_CONTAINER_CLASS}`}>
                  <UserName>{user.store.name}</UserName>
                  <StoreStatusBadge status={user.store.status} />
                </div>
              ) : (
                th.admin.common.none
              )}
            </TableCell>
            <TableCell label={columns.createdAt}>{formatDateTime(user.createdAt)}</TableCell>
            <TableCell>
              {user.id === selfId && user.isActive ? (
                <span className="type-small text-foreground-secondary">{th.admin.users.self}</span>
              ) : (
                <AdminAction
                  spec={{
                    kind: user.isActive ? "user.deactivate" : "user.reactivate",
                    id: user.id,
                  }}
                  returnTo={ADMIN_ROUTES.users}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
