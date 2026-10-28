/**
 * Public surface of the orders module. Route handlers, pages, and other modules import from here
 * only.
 */
export {
  completeOrderPayment,
  failOrderPayment,
  failOverdueOrders,
  getOrder,
  listOrders,
  PAYMENT_SWEEP_BATCH_SIZE,
  readOrderOfUser,
} from "./service";
export type { SweepResult } from "./service";
export {
  changeSellerOrderStatus,
  getOwnSellerOrder,
  getSellerSummary,
  listOwnSellerOrders,
} from "./seller-service";
export * from "./seller-schema";
// SEC-072: the `CONFLICT` reason of a seller's `DELIVERED` sent too soon after `SHIPPED`.
export { DELIVERY_TOO_EARLY } from "./errors";
export {
  aggregateSatang,
  toSellerOrderListItemDto,
  toSellerOrderViewDto,
  toSellerSummaryDto,
} from "./seller-mapping";
export { PAYMENT_TRANSACTION_OPTIONS } from "./repository";
// For the admin module (T-050): the customer's order shape, which the admin's order extends, and
// the two effect statements of a fulfilment move that every actor shares (stock restored at most
// once, DATA_MODEL.md 7.3; the delivery time, 6.14). Both take the caller's transaction.
export { type OrderItemRow, type OrderRow, type SellerOrderRow, toOrderDto } from "./mapping";
export { claimAndRestoreStock, markShipmentDelivered } from "./seller-repository";
export {
  runPaymentTimeoutSweep,
  startPaymentTimeoutSweepSchedule,
  stopPaymentTimeoutSweepSchedule,
} from "./timeout-sweep";
export * from "./schema";
export * from "./state";
