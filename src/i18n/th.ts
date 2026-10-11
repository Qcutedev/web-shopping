// All customer-facing Thai strings live here (CLAUDE.md, Language).
export const th = {
  site: {
    // Placeholder until the owner provides the marketplace name (D-017, Q6).
    name: "ชื่อแบรนด์",
    description: "มาร์เก็ตเพลสสำหรับร้านค้าไทย",
  },
  scaffold: {
    heading: "กำลังพัฒนา",
    body: "เว็บไซต์นี้อยู่ระหว่างการพัฒนา",
  },
  // Texts below were approved by the owner word for word; do not reword them. A name in braces is
  // a placeholder that the caller replaces with a number.
  quantity: {
    // Shown when stock is below the quantity the customer chose (D-026, OQ-46).
    lowered: "สินค้าเหลือ {available} ชิ้น ระบบปรับจำนวนเป็น {available} ชิ้นให้แล้ว",
  },
  cart: {
    // Adding a sold-out product is refused (D-028, Q35 (b); BR-31).
    soldOutRefused: "สินค้าหมด ไม่สามารถเพิ่มลงตะกร้าได้",
    // Items returned after a failed payment were cut by the limit of 99 or by stock
    // (D-028, Q35 (c); BR-32).
    returnedQuantityCut: "ปรับจำนวนในตะกร้าเป็น {quantity} ชิ้น",
  },
  order: {
    // Mark on an order whose payment failed (D-028, Q35 (a); BR-20).
    paymentFailed: "ชำระเงินไม่สำเร็จ",
  },
} as const;
