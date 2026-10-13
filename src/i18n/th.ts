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
  // App shell (T-018). Texts marked "approved" are listed as approved in docs/DESIGN_SYSTEM.md
  // ("Copy guidelines"); the others are proposals written by the frontend agent and are not yet
  // approved by the owner.
  shell: {
    // proposal
    skipToContent: "ข้ามไปยังเนื้อหาหลัก",
    header: {
      // proposal: accessible names of landmarks
      navLabel: "เมนูหลัก",
      search: {
        // proposal (label); the submit text is approved
        label: "ค้นหาสินค้า",
        submit: "ค้นหา",
      },
      // approved
      openStore: "เปิดร้านค้า",
      signIn: "เข้าสู่ระบบ",
      cart: {
        // proposal. {count} is the number of items in the cart.
        label: "ตะกร้าสินค้า",
        labelWithCount: "ตะกร้าสินค้า {count} รายการ",
      },
    },
    footer: {
      // proposal
      navLabel: "ลิงก์ท้ายเว็บไซต์",
      // {name} is th.site.name. No year: reading the current date would make the footer dynamic.
      copyright: "© {name}",
    },
  },
  // Not-found page (CR-67). Proposal: wording written by the frontend agent, not yet approved.
  notFound: {
    title: "ไม่พบหน้าที่ต้องการ",
    body: "หน้านี้อาจถูกย้ายหรือยังไม่เปิดให้บริการ",
    backHome: "กลับไปหน้าแรก",
  },
  // Approved texts of the notice pills (docs/DESIGN_SYSTEM.md, "Copy guidelines").
  notice: {
    sampleData: "ข้อมูลตัวอย่าง",
    mockPayment: "การชำระเงินจำลอง",
    simulatedShipping: "การจัดส่งจำลอง",
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
