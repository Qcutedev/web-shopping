/**
 * Public surface of the database layer.
 *
 * May be imported only by src/modules/**, src/server/auth/**, src/server/health.ts,
 * prisma/seed.ts, scripts/**, and tests/** (architecture rule 7 in CLAUDE.md). Nothing else
 * imports the generated client, `@prisma/client`, the driver adapter, or `pg`.
 *
 * The `PrismaClient` class is deliberately not exported as a value: nobody outside this folder
 * creates a client.
 */
import type { Prisma } from "../../../prisma/generated/prisma/client";

export { db, type Db } from "./client";

/**
 * What the installed driver would connect to for a connection string, without connecting
 * (CR-42). Exported for prisma/seed.ts, which refuses any database that is not on this machine
 * (T-014) and may import nothing below this file. Opens no connection and returns no password.
 */
export {
  ConnectionTargetError,
  describeConnectionTarget,
  type ConnectionTarget,
} from "./connection-target";

/**
 * Recognising a unique-constraint violation by its index name (CR-T040-05; DATA_MODEL.md section
 * 21.5). Reads only the index name and the SQLSTATE of the error, never the conflicting value.
 */
export {
  isRawUniqueIndexViolation,
  isUniqueIndexViolation,
  isUniqueViolation,
  UNIQUE_VIOLATION_SQLSTATE,
} from "./unique-violation";

/**
 * `Prisma` carries the raw-query helpers (`Prisma.sql`, `Prisma.join`), the error classes
 * (`Prisma.PrismaClientKnownRequestError`), and every generated input and result type.
 */
export { Prisma } from "../../../prisma/generated/prisma/client";

/** Enum objects and their types, as defined in prisma/schema.prisma. */
export {
  ApplicationStatus,
  FulfilmentStatus,
  ModerationStatus,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  Role,
  StoreStatus,
} from "../../../prisma/generated/prisma/enums";

/** Row types of the models. */
export type {
  Account,
  Address,
  AuditLog,
  Cart,
  CartItem,
  Category,
  MarketplaceSettings,
  Order,
  OrderItem,
  Payment,
  Product,
  ProductImage,
  Review,
  SellerApplication,
  SellerOrder,
  Session,
  Shipment,
  Store,
  Upload,
  User,
  Verification,
} from "../../../prisma/generated/prisma/client";

/**
 * The client handed to the callback of `db.$transaction(async (tx) => ...)`. A service function
 * that must run inside a caller's transaction takes this as a parameter.
 */
export type DbTransaction = Prisma.TransactionClient;
