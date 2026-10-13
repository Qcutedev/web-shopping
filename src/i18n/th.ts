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
  // Proposals (T-030 pages): wording written by the frontend agent, not yet approved by the owner.
  // Messages that the server answers with an error code (src/lib/api-client/error-copy.ts).
  errors: {
    unauthenticated: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง",
    forbidden: "ไม่สามารถดำเนินการนี้ได้",
    notFound: "ไม่พบข้อมูลที่ต้องการ อาจถูกลบไปแล้ว",
    validation: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง",
    rateLimited: "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง",
    network: "เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง",
    unknown: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง",
    loadFailed: "โหลดข้อมูลไม่สำเร็จ",
    loadFailedTitle: "ไม่สามารถแสดงข้อมูลได้",
    retry: "ลองอีกครั้ง",
  },
  pagination: {
    label: "การแบ่งหน้า",
    previous: "หน้าก่อนหน้า",
    next: "หน้าถัดไป",
    // {page} is the page number.
    page: "หน้า {page}",
  },
  account: {
    navLabel: "เมนูบัญชีของฉัน",
    breadcrumbLabel: "เส้นทางนำทาง",
    loading: "กำลังโหลด",
    nav: {
      profile: "ข้อมูลส่วนตัว",
      addresses: "ที่อยู่จัดส่ง",
    },
    common: {
      notProvided: "ยังไม่ได้ระบุ",
      save: "บันทึก",
      cancel: "ยกเลิก",
      edit: "แก้ไข",
      remove: "ลบ",
    },
    profile: {
      title: "ข้อมูลส่วนตัว",
      description: "ดูและแก้ไขชื่อที่แสดงและเบอร์โทรศัพท์ของคุณ",
      name: "ชื่อที่แสดง",
      email: "อีเมล",
      emailNote: "ไม่สามารถเปลี่ยนอีเมลได้",
      phone: "เบอร์โทรศัพท์",
      phoneHelper:
        "กรอกเป็นตัวเลขเท่านั้น เช่น 0812345678 หรือ +66812345678 เว้นว่างไว้เพื่อลบเบอร์",
      edit: "แก้ไขข้อมูล",
      saved: "บันทึกข้อมูลส่วนตัวแล้ว",
      noChange: "ไม่มีการเปลี่ยนแปลง",
      formTitle: "แก้ไขข้อมูลส่วนตัว",
    },
    addresses: {
      title: "ที่อยู่จัดส่ง",
      description: "จัดการที่อยู่สำหรับจัดส่งสินค้า ตั้งที่อยู่หลักได้ 1 รายการ",
      listLabel: "รายการที่อยู่จัดส่ง",
      add: "เพิ่มที่อยู่ใหม่",
      addTitle: "เพิ่มที่อยู่ใหม่",
      editTitle: "แก้ไขที่อยู่",
      defaultBadge: "ที่อยู่หลัก",
      setDefault: "ตั้งเป็นที่อยู่หลัก",
      emptyTitle: "ยังไม่มีที่อยู่จัดส่ง",
      emptyDescription: "เพิ่มที่อยู่เพื่อให้สั่งซื้อสินค้าได้เร็วขึ้น",
      pageEmptyTitle: "ไม่มีรายการในหน้านี้",
      pageEmptyAction: "กลับไปหน้าแรกของรายการ",
      // {name} is the recipient name.
      editLabel: "แก้ไขที่อยู่ของ {name}",
      deleteLabel: "ลบที่อยู่ของ {name}",
      setDefaultLabel: "ตั้งที่อยู่ของ {name} เป็นที่อยู่หลัก",
      deleteConfirm: "ยืนยันการลบที่อยู่นี้ใช่หรือไม่",
      deleteConfirmNote: "คำสั่งซื้อที่สั่งไปแล้วจะไม่ได้รับผลกระทบ",
      deleteConfirmAction: "ยืนยันการลบ",
      created: "เพิ่มที่อยู่แล้ว",
      updated: "บันทึกที่อยู่แล้ว",
      deleted: "ลบที่อยู่แล้ว",
      defaultSet: "ตั้งเป็นที่อยู่หลักแล้ว",
      isDefault: "ตั้งเป็นที่อยู่หลัก",
      fields: {
        recipientName: "ชื่อผู้รับ",
        phone: "เบอร์โทรศัพท์",
        line1: "ที่อยู่ (บ้านเลขที่ ถนน อาคาร)",
        subdistrict: "ตำบล/แขวง",
        district: "อำเภอ/เขต",
        province: "จังหวัด",
        postalCode: "รหัสไปรษณีย์",
      },
      phoneHelper: "กรอกเป็นตัวเลขเท่านั้น เช่น 0812345678 หรือ +66812345678",
      postalCodeHelper: "ตัวเลข 5 หลัก",
    },
    // Messages under a field. `required`: empty; `tooLong`: over the length limit; `invalid`: the
    // rule of that field is not met.
    fieldErrors: {
      name: {
        required: "กรุณากรอกชื่อที่แสดง",
        tooLong: "ชื่อที่แสดงต้องไม่เกิน 100 ตัวอักษร",
        invalid: "ชื่อที่แสดงมีอักขระที่ไม่รองรับ",
      },
      recipientName: {
        required: "กรุณากรอกชื่อผู้รับ",
        tooLong: "ชื่อผู้รับต้องไม่เกิน 100 ตัวอักษร",
        invalid: "ชื่อผู้รับมีอักขระที่ไม่รองรับ",
      },
      phone: {
        required: "กรุณากรอกเบอร์โทรศัพท์",
        tooLong: "เบอร์โทรศัพท์ยาวเกินไป",
        invalid: "เบอร์โทรศัพท์ต้องเป็นตัวเลขเท่านั้น (ขึ้นต้นด้วย 0 หรือ +66)",
      },
      line1: {
        required: "กรุณากรอกที่อยู่",
        tooLong: "ที่อยู่ต้องไม่เกิน 200 ตัวอักษร",
        invalid: "ที่อยู่มีอักขระที่ไม่รองรับ",
      },
      subdistrict: {
        required: "กรุณากรอกตำบล/แขวง",
        tooLong: "ตำบล/แขวงต้องไม่เกิน 100 ตัวอักษร",
        invalid: "ตำบล/แขวงมีอักขระที่ไม่รองรับ",
      },
      district: {
        required: "กรุณากรอกอำเภอ/เขต",
        tooLong: "อำเภอ/เขตต้องไม่เกิน 100 ตัวอักษร",
        invalid: "อำเภอ/เขตมีอักขระที่ไม่รองรับ",
      },
      province: {
        required: "กรุณากรอกจังหวัด",
        tooLong: "จังหวัดต้องไม่เกิน 100 ตัวอักษร",
        invalid: "จังหวัดมีอักขระที่ไม่รองรับ",
      },
      postalCode: {
        required: "กรุณากรอกรหัสไปรษณีย์",
        tooLong: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก",
        invalid: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก",
      },
    },
    // Shown above a form when the server refused it and no single field is to blame.
    formInvalid: "กรุณาตรวจสอบข้อมูลในช่องที่มีข้อความแจ้งเตือน",
  },
} as const;
