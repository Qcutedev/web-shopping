/**
 * From stored admin rows to the shapes of docs/API_CONTRACTS.md section 5.9. Pure: no database
 * and no I/O. Every shape is built key by key, so a wider row never leaks a field into an answer
 * (no password hash, no session, no address or browser details of a session).
 */
import { imageRef } from "@/modules/catalog/image";
import { isLowStock, isSoldOutForSeller } from "@/modules/inventory";
import { aggregateSatang, toOrderDto } from "@/modules/orders";
import { STORE_STATUSES, type StoreStatusValue } from "@/modules/sellers";

import type {
  AdminApplicationDto,
  AdminCategoryDto,
  AdminOrderDto,
  AdminProductDto,
  AdminStoreDto,
  AdminSummaryDto,
  AdminUserDto,
  AuditLogDto,
  AuditMetadata,
  ReportDto,
  SettingsDto,
} from "./schema";
import type {
  AdminOrderRow,
  ApplicationRow,
  AuditRow,
  CategoryRow,
  ProductRow,
  ReportRows,
  SettingsRow,
  StoreRow,
  SummaryRows,
  UserRow,
} from "./repository";

export function toAdminUserDto(row: UserRow): AdminUserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    store:
      row.store === null
        ? null
        : {
            id: row.store.id,
            name: row.store.name,
            slug: row.store.slug,
            status: row.store.status,
          },
  };
}

export function toAdminApplicationDto(row: ApplicationRow): AdminApplicationDto {
  return {
    id: row.id,
    applicant: {
      id: row.applicant.id,
      name: row.applicant.name,
      email: row.applicant.email,
      isActive: row.applicant.isActive,
    },
    storeName: row.storeName,
    description: row.description,
    contactPhone: row.contactPhone,
    status: row.status,
    reviewNote: row.status === "REJECTED" ? row.reviewNote : null,
    reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminStoreDto(row: StoreRow): AdminStoreDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logo: row.logoKey === null ? null : imageRef(row.logoKey),
    contactPhone: row.contactPhone,
    status: row.status,
    statusReason: row.statusReason,
    isSample: row.isSample,
    ownerId: row.ownerId,
    ownerIsActive: row.ownerIsActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminProductDto(row: ProductRow): AdminProductDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    sku: row.sku,
    category: { id: row.category.id, name: row.category.name, isActive: row.category.isActive },
    priceSatang: row.priceSatang,
    stock: row.stock,
    lowStock: isLowStock(row.status, row.moderationStatus, row.stock),
    soldOut: isSoldOutForSeller(row.status, row.moderationStatus, row.stock),
    status: row.status,
    moderationStatus: row.moderationStatus,
    moderationNote: row.moderationNote,
    images: row.imageKeys.map((key) => imageRef(key)),
    isSample: row.isSample,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contentRevision: row.contentRevision,
    moderationRequestedAt: row.moderationRequestedAt.toISOString(),
    store: {
      id: row.store.id,
      name: row.store.name,
      slug: row.store.slug,
      status: row.store.status,
    },
  };
}

export function toAdminCategoryDto(row: CategoryRow): AdminCategoryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    isSample: row.isSample,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The customer's order shape (section 5.5.2) plus `userId` and, on each seller order, `storeId`
 * and `commissionRateBps` (section 5.9.5). The paid time follows BR-39: only a paid order has one.
 * A failed order's parts carry `cancellationKind: "PAYMENT_FAILED"`, never
 * `"REFUND_OUTSIDE_SYSTEM"` (BR-20).
 */
export function toAdminOrderDto(row: AdminOrderRow): AdminOrderDto {
  const base = toOrderDto(row);
  const extras = new Map(
    row.sellerOrders.map((sellerOrder) => [
      sellerOrder.id,
      { storeId: sellerOrder.storeId, commissionRateBps: sellerOrder.commissionRateBps },
    ]),
  );
  return {
    ...base,
    userId: row.userId,
    sellerOrders: base.sellerOrders.map((sellerOrder) => {
      const extra = extras.get(sellerOrder.id);
      if (extra === undefined) throw new Error("admin: a seller order lost its row.");
      return { ...sellerOrder, ...extra };
    }),
  };
}

export function toSettingsDto(row: SettingsRow): SettingsDto {
  return {
    flatShippingFeeSatang: row.flatShippingFeeSatang,
    commissionRateBps: row.commissionRateBps,
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
  };
}

function storesByStatus(rows: readonly { status: string; count: number }[]) {
  const result = Object.fromEntries(STORE_STATUSES.map((status) => [status, 0])) as Record<
    StoreStatusValue,
    number
  >;
  for (const row of rows) {
    if (!(STORE_STATUSES as readonly string[]).includes(row.status)) {
      throw new Error("admin: a store status outside the known values reached the summary.");
    }
    result[row.status as StoreStatusValue] = row.count;
  }
  return result;
}

export function toAdminSummaryDto(rows: SummaryRows): AdminSummaryDto {
  return {
    pendingApplicationCount: rows.pendingApplicationCount,
    pendingProductCount: rows.pendingProductCount,
    userCount: rows.userCount,
    storesByStatus: storesByStatus(rows.storesByStatus),
    orderCount: rows.orderCount,
    paidRevenueSatang: aggregateSatang(rows.paidRevenue),
  };
}

export function toReportDto(from: Date, to: Date, rows: ReportRows): ReportDto {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    orderCount: rows.orderCount,
    paidRevenueSatang: aggregateSatang(rows.paidRevenue),
    newUserCount: rows.newUserCount,
    newSellerCount: rows.newSellerCount,
  };
}

export function toAuditLogDto(row: AuditRow): AuditLogDto {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata as AuditMetadata,
    createdAt: row.createdAt.toISOString(),
  };
}
