import { FulfilmentBadge } from "@/components/orders/status-badges";
import { Badge } from "@/components/ui/badge";
import { th } from "@/i18n/th";
import type { AdminSellerOrderDto } from "@/modules/admin/schema";

/**
 * The mark of one per-store part of an order. A part cancelled because the payment failed is
 * "ชำระเงินไม่สำเร็จ", never a cancellation (BR-20); a part an admin cancelled after payment is
 * "ยกเลิกแล้ว คืนเงินนอกระบบ" (REQ-A-07, BR-21). Both texts are approved. Anything else shows its
 * fulfilment status.
 */
export function PartStatus({
  part,
}: {
  part: Pick<AdminSellerOrderDto, "fulfilmentStatus" | "cancellationKind">;
}) {
  if (part.cancellationKind === "PAYMENT_FAILED") {
    return <Badge variant="danger">{th.order.paymentFailed}</Badge>;
  }
  if (part.cancellationKind === "REFUND_OUTSIDE_SYSTEM") {
    return <Badge variant="danger">{th.admin.orders.refundOutside}</Badge>;
  }
  return <FulfilmentBadge status={part.fulfilmentStatus} />;
}
