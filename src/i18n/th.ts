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
  // Proposals (T-021 storefront pages): wording written by the frontend agent, not yet approved
  // by the owner. A name in braces is a placeholder filled with `fill`.
  catalog: {
    loading: "กำลังโหลดสินค้า",
    productListLabel: "รายการสินค้า",
    soldOut: "สินค้าหมด",
    noImage: "ไม่มีรูปภาพสินค้า",
    breadcrumbLabel: "เส้นทางนำทาง",
    home: {
      newestTitle: "สินค้ามาใหม่",
      categoriesTitle: "หมวดหมู่สินค้า",
      viewAll: "ดูสินค้าทั้งหมด",
      emptyTitle: "ยังไม่มีสินค้าในขณะนี้",
      emptyDescription: "กรุณากลับมาดูใหม่อีกครั้งภายหลัง",
    },
    categories: {
      label: "หมวดหมู่",
    },
    sort: {
      label: "เรียงตาม",
      newest: "มาใหม่",
      price_asc: "ราคาต่ำไปสูง",
      price_desc: "ราคาสูงไปต่ำ",
    },
    search: {
      title: "ค้นหาสินค้า",
      // The visitor's text sits between these two, isolated for bidirectional text.
      resultsForPrefix: "ผลการค้นหา “",
      resultsForSuffix: "”",
      // {total} is the number of products found.
      count: "พบสินค้า {total} รายการ",
      emptyTitle: "ไม่พบสินค้าที่ตรงกับการค้นหา",
      emptyDescription: "ลองใช้คำอื่น หรือดูสินค้าทั้งหมดของเรา",
      // Heading when no search text is given: the whole catalogue.
      allTitle: "สินค้าทั้งหมด",
    },
    category: {
      emptyTitle: "ยังไม่มีสินค้าในหมวดหมู่นี้",
      emptyDescription: "ลองดูหมวดหมู่อื่น หรือสินค้าทั้งหมดของเรา",
    },
    list: {
      // Page number is past the last page of a list.
      pageEmptyTitle: "ไม่มีสินค้าในหน้านี้",
      pageEmptyAction: "กลับไปหน้าแรกของรายการ",
    },
    store: {
      emptyTitle: "ร้านนี้ยังไม่มีสินค้า",
      emptyDescription: "กรุณากลับมาดูใหม่อีกครั้งภายหลัง",
    },
    filter: {
      title: "กรองสินค้า",
      minPrice: "ราคาต่ำสุด (บาท)",
      maxPrice: "ราคาสูงสุด (บาท)",
      priceHelper: "กรอกเป็นตัวเลข เช่น 100 หรือ 99.50",
      category: "หมวดหมู่",
      categoryAll: "ทุกหมวดหมู่",
      categoryOther: "หมวดหมู่ที่เลือกไว้",
      apply: "ใช้ตัวกรอง",
      reset: "ล้างตัวกรอง",
      minInvalid: "ราคาต่ำสุดไม่ถูกต้อง กรอกเป็นตัวเลขตั้งแต่ 0 ถึง 1,000,000 บาท",
      maxInvalid: "ราคาสูงสุดไม่ถูกต้อง กรอกเป็นตัวเลขตั้งแต่ 0 ถึง 1,000,000 บาท",
      range: "ราคาสูงสุดต้องไม่ต่ำกว่าราคาต่ำสุด",
      errorSummary: "ตัวกรองราคาไม่ถูกต้อง กรุณาแก้ไขแล้วลองอีกครั้ง",
    },
    filterInvalidTitle: "ตัวกรองไม่ถูกต้อง",
    filterInvalid: "ค่าที่ใช้ค้นหาหรือเรียงสินค้าไม่ถูกต้อง กรุณาเริ่มใหม่อีกครั้ง",
    product: {
      description: "รายละเอียดสินค้า",
      category: "หมวดหมู่",
      store: "ร้านค้า",
      gallery: "รูปภาพสินค้า",
      // {title} is the product title, {index} the picture number, {count} the number of pictures.
      imageAlt: "{title} รูปที่ {index} จาก {count}",
      thumbnailLabel: "ดูรูปที่ {index}",
      reviewsTitle: "รีวิวจากผู้ซื้อ",
      // {rating} is the mean rating with one decimal, {count} the number of reviews.
      ratingSummary: "คะแนน {rating} จาก 5 ({count} รีวิว)",
      // {rating} is a whole number from 1 to 5.
      reviewRating: "ให้คะแนน {rating} จาก 5",
      noComment: "ไม่มีข้อความรีวิว",
      reviewsEmpty: "ยังไม่มีรีวิวสำหรับสินค้านี้",
      reviewsFailed: "ไม่สามารถแสดงรีวิวได้ในขณะนี้",
    },
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
  // Proposals (T-044 seller pages): wording written by the frontend agent, not yet approved by the
  // owner. Status labels follow the status badge mapping of docs/DESIGN_SYSTEM.md. A name in
  // braces is a placeholder filled with `fill`.
  seller: {
    navLabel: "เมนูร้านค้าของฉัน",
    loading: "กำลังโหลด",
    nav: {
      dashboard: "ภาพรวม",
      store: "ตั้งค่าร้านค้า",
      products: "สินค้า",
      orders: "คำสั่งซื้อ",
    },
    common: {
      save: "บันทึก",
      cancel: "ยกเลิก",
      edit: "แก้ไข",
      notProvided: "ยังไม่ได้ระบุ",
      backToStore: "กลับไปที่ภาพรวมร้านค้า",
      formInvalid: "กรุณาตรวจสอบข้อมูลในช่องที่มีข้อความแจ้งเตือน",
    },
    // What a signed-in person who is not a seller sees on a seller page.
    guard: {
      customerTitle: "คุณยังไม่มีร้านค้า",
      customerBody: "สมัครเปิดร้านค้าเพื่อเริ่มขายสินค้า ผู้ดูแลระบบจะตรวจสอบใบสมัครก่อนอนุมัติ",
      customerAction: "สมัครเปิดร้านค้า",
      forbiddenTitle: "ไม่สามารถใช้งานส่วนนี้ได้",
      forbiddenBody: "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนร้านค้า",
      notFoundTitle: "ไม่พบข้อมูลที่ต้องการ",
      notFoundBody: "รายการนี้อาจถูกลบไปแล้ว หรือไม่ใช่ของร้านค้าของคุณ",
    },
    // Shown on every seller page while the store is suspended (REQ-S-09, BR-14).
    suspended: {
      title: "ร้านค้าถูกระงับ",
      body: "คุณยังดูข้อมูลและจัดการคำสั่งซื้อที่มีอยู่ได้ แต่แก้ไขร้านค้า สินค้า และสต็อกไม่ได้จนกว่าร้านค้าจะได้รับการคืนสถานะ",
      // Label before the reason an admin gave.
      reasonLabel: "เหตุผล",
    },
    status: {
      fulfilment: {
        PENDING: "รอร้านค้ายืนยัน",
        PROCESSING: "กำลังเตรียมสินค้า",
        SHIPPED: "จัดส่งแล้ว",
        DELIVERED: "จัดส่งสำเร็จ",
        CANCELLED: "ยกเลิกแล้ว",
      },
      payment: {
        PENDING: "รอชำระเงิน",
        PAID: "ชำระเงินแล้ว",
        FAILED: "ชำระเงินไม่สำเร็จ",
      },
      product: {
        DRAFT: "ฉบับร่าง",
        PUBLISHED: "เผยแพร่แล้ว",
        ARCHIVED: "เก็บถาวรแล้ว",
      },
      moderation: {
        PENDING: "รอตรวจสอบ",
        APPROVED: "ผ่านการตรวจสอบ",
        REJECTED: "ไม่ผ่านการตรวจสอบ",
        TAKEN_DOWN: "ถูกถอดออกจากการขาย",
      },
      store: {
        APPROVED: "อนุมัติแล้ว",
        SUSPENDED: "ถูกระงับ",
      },
      application: {
        PENDING: "รอการอนุมัติ",
        APPROVED: "อนุมัติแล้ว",
        REJECTED: "ไม่ผ่านการอนุมัติ",
      },
    },
    // Messages for a refused request, by the `details.reason` of a 409 or by error code.
    errors: {
      sellerNotApproved: "ร้านค้าถูกระงับ ไม่สามารถแก้ไขข้อมูลได้ในขณะนี้",
      invalidTransition: "สถานะปัจจุบันไม่รองรับการดำเนินการนี้ รายการอาจถูกเปลี่ยนไปแล้ว",
      conflict: "ข้อมูลขัดแย้งกับข้อมูลที่มีอยู่ กรุณาตรวจสอบแล้วลองอีกครั้ง",
      payloadTooLarge: "ข้อมูลหรือไฟล์ใหญ่เกินกำหนด",
      unsupportedMedia: "ไฟล์ไม่ใช่รูปภาพที่รองรับ (JPEG, PNG หรือ WebP)",
      reasons: {
        OPEN_APPLICATION: "คุณมีใบสมัครที่รอการตรวจสอบอยู่แล้ว",
        STORE_NAME_TAKEN: "มีร้านค้าใช้ชื่อนี้แล้ว กรุณาเลือกชื่ออื่น",
        STORE_NAME_RESERVED: "ชื่อนี้ถูกสงวนไว้ กรุณาเลือกชื่ออื่น",
        DUPLICATE_SKU: "รหัสสินค้า (SKU) นี้ถูกใช้กับสินค้าอื่นของร้านแล้ว",
        UPLOAD_IN_USE: "รูปภาพนี้ถูกใช้กับสินค้าอื่นแล้ว",
        UPLOAD_LIMIT:
          "มีรูปที่อัปโหลดไว้แต่ยังไม่ได้ใช้ครบกำหนดแล้ว กรุณาใช้งานรูปเหล่านั้นก่อนอัปโหลดเพิ่ม",
        CATEGORY_INACTIVE: "หมวดหมู่นี้ปิดใช้งานอยู่ กรุณาเลือกหมวดหมู่อื่น",
        PRODUCT_LIMIT: "ร้านค้ามีสินค้าครบจำนวนสูงสุดแล้ว กรุณาเก็บถาวรหรือลบสินค้าก่อนเพิ่มใหม่",
        NEGATIVE_STOCK: "สต็อกต้องไม่ต่ำกว่า 0",
        STOCK_LIMIT: "สต็อกต้องไม่เกิน 1,000,000 ชิ้น",
        SLUG_TAKEN: "ไม่สามารถสร้างสินค้าได้ในขณะนี้ กรุณาลองอีกครั้ง",
      },
    },
    store: {
      title: "ตั้งค่าร้านค้า",
      description: "แก้ไขชื่อ รายละเอียด โลโก้ และเบอร์โทรติดต่อของร้านค้า",
      formTitle: "ข้อมูลร้านค้า",
      statusLabel: "สถานะร้านค้า",
      viewPublic: "ดูหน้าร้านของฉัน",
      fields: {
        name: "ชื่อร้านค้า",
        description: "รายละเอียดร้านค้า",
        contactPhone: "เบอร์โทรติดต่อร้านค้า",
        logo: "โลโก้ร้านค้า",
      },
      nameHelper: "การเปลี่ยนชื่อไม่มีผลกับคำสั่งซื้อที่สั่งไปแล้ว",
      phoneHelper: "กรอกเป็นตัวเลขเท่านั้น เช่น 0812345678 หรือ +66812345678",
      save: "บันทึกการเปลี่ยนแปลง",
      saved: "บันทึกข้อมูลร้านค้าแล้ว",
      noChange: "ไม่มีการเปลี่ยนแปลง",
      suspendedNote: "ร้านค้าถูกระงับ จึงแก้ไขข้อมูลร้านค้าไม่ได้ในขณะนี้",
    },
    products: {
      title: "สินค้าของฉัน",
      description: "เพิ่ม แก้ไข เผยแพร่ และจัดการสต็อกสินค้าของร้านคุณ",
      listLabel: "รายการสินค้า",
      add: "เพิ่มสินค้า",
      // {count} is the number of products found.
      count: "พบสินค้า {count} รายการ",
      emptyTitle: "ยังไม่มีสินค้า",
      emptyDescription:
        "เพิ่มสินค้าชิ้นแรกเพื่อเริ่มขาย สินค้าจะแสดงในร้านหลังผู้ดูแลระบบตรวจสอบแล้ว",
      filteredEmptyTitle: "ไม่พบสินค้าที่ตรงกับตัวกรอง",
      filteredEmptyDescription: "ลองล้างตัวกรองเพื่อดูสินค้าทั้งหมด",
      pageEmptyTitle: "ไม่มีสินค้าในหน้านี้",
      pageEmptyAction: "กลับไปหน้าแรกของรายการ",
      filter: {
        title: "กรองสินค้า",
        status: "สถานะสินค้า",
        moderation: "การตรวจสอบ",
        all: "ทั้งหมด",
        lowStock: "เฉพาะสินค้าใกล้หมด (เหลือ 1 ถึง 5 ชิ้น)",
        soldOut: "เฉพาะสินค้าหมด",
        apply: "ใช้ตัวกรอง",
        reset: "ล้างตัวกรอง",
      },
      row: {
        sku: "รหัสสินค้า",
        stock: "สต็อก",
        // {count} is the number of pieces left.
        stockCount: "{count} ชิ้น",
        lowStock: "ใกล้หมด",
        soldOut: "สินค้าหมด",
        noImage: "ไม่มีรูป",
      },
      newTitle: "เพิ่มสินค้า",
      newDescription: "สินค้าที่สร้างใหม่เป็นฉบับร่าง และต้องผ่านการตรวจสอบก่อนแสดงในร้าน",
      created: "สร้างสินค้าแล้ว เป็นฉบับร่าง เผยแพร่ได้เมื่อพร้อม",
      detailTitle: "จัดการสินค้า",
      backToList: "กลับไปรายการสินค้า",
      suspendedNote: "ร้านค้าถูกระงับ จึงแก้ไขสินค้าและสต็อกไม่ได้ในขณะนี้",
      archivedNote: "สินค้านี้ถูกเก็บถาวรแล้ว แก้ไขไม่ได้",
      pendingNote: "สินค้ารอผู้ดูแลระบบตรวจสอบ จะยังไม่แสดงในร้านจนกว่าจะผ่านการตรวจสอบ",
      draftNote: "สินค้าเป็นฉบับร่าง ยังไม่แสดงในร้านจนกว่าจะเผยแพร่และผ่านการตรวจสอบ",
      moderationNote: "ข้อความจากผู้ดูแลระบบ",
      rejectedTitle: "สินค้าไม่ผ่านการตรวจสอบ",
      takenDownTitle: "สินค้าถูกถอดออกจากการขาย",
      resubmitNote: "แก้ไขสินค้าแล้วบันทึก ระบบจะส่งกลับไปตรวจสอบอีกครั้งโดยอัตโนมัติ",
      reviewNote:
        "การแก้ไขชื่อ รายละเอียด หมวดหมู่ หรือรูปภาพ อาจทำให้สินค้าถูกส่งกลับไปรอตรวจสอบอีกครั้ง ส่วนราคาและสต็อกมีผลทันที",
      form: {
        createTitle: "ข้อมูลสินค้า",
        editTitle: "แก้ไขข้อมูลสินค้า",
        title: "ชื่อสินค้า",
        description: "รายละเอียดสินค้า",
        sku: "รหัสสินค้า (SKU)",
        skuHelper: "ต้องไม่ซ้ำกับสินค้าอื่นของร้าน",
        category: "หมวดหมู่",
        categoryPlaceholder: "เลือกหมวดหมู่",
        categoryInactive: "(ปิดใช้งาน)",
        categoriesEmpty: "ยังไม่มีหมวดหมู่ให้เลือก",
        price: "ราคา (บาท)",
        priceHelper: "ตั้งแต่ 1 ถึง 1,000,000 บาท เช่น 259 หรือ 259.50",
        stock: "จำนวนสต็อก",
        stockHelper: "จำนวนเต็ม 0 ถึง 1,000,000 ชิ้น",
        images: "รูปภาพสินค้า",
        create: "สร้างสินค้า",
        save: "บันทึกการเปลี่ยนแปลง",
        saved: "บันทึกสินค้าแล้ว",
        noChange: "ไม่มีการเปลี่ยนแปลง",
      },
      actions: {
        title: "สถานะการขาย",
        publish: "เผยแพร่",
        unpublish: "ยกเลิกการเผยแพร่",
        archive: "เก็บถาวร",
        delete: "ลบสินค้า",
        published: "เผยแพร่สินค้าแล้ว",
        publishedPending: "เผยแพร่แล้ว สินค้าจะแสดงในร้านเมื่อผ่านการตรวจสอบ",
        unpublished: "ยกเลิกการเผยแพร่แล้ว สินค้าเป็นฉบับร่าง",
        archived: "เก็บสินค้าถาวรแล้ว",
        deleted: "ลบสินค้าแล้ว",
        deletedArchived: "สินค้านี้มีคำสั่งซื้ออ้างอิงอยู่ จึงเก็บถาวรแทนการลบ",
        archiveConfirm: "ยืนยันการเก็บสินค้านี้ถาวรใช่หรือไม่",
        archiveConfirmNote: "สินค้าที่เก็บถาวรแล้วจะกลับมาขายหรือแก้ไขไม่ได้",
        archiveConfirmAction: "ยืนยันเก็บถาวร",
        deleteConfirm: "ยืนยันการลบสินค้านี้ใช่หรือไม่",
        deleteConfirmNote:
          "หากมีคำสั่งซื้ออ้างอิงสินค้านี้อยู่ ระบบจะเก็บถาวรแทนการลบเพื่อรักษาประวัติคำสั่งซื้อ",
        deleteConfirmAction: "ยืนยันการลบ",
      },
      stock: {
        title: "สต็อก",
        current: "สต็อกปัจจุบัน",
        // {count} is the number of pieces.
        currentCount: "{count} ชิ้น",
        set: "ตั้งสต็อกเป็น",
        setAction: "ตั้งค่าสต็อก",
        adjust: "เพิ่มหรือลดสต็อก",
        adjustHelper: "ใส่เลขบวกเพื่อเพิ่ม เลขลบเพื่อลด เช่น 10 หรือ -3",
        adjustAction: "ปรับสต็อก",
        updated: "อัปเดตสต็อกแล้ว",
        note: "การเปลี่ยนสต็อกมีผลทันที และไม่ต้องรอตรวจสอบ",
      },
    },
    orders: {
      title: "คำสั่งซื้อ",
      description: "คำสั่งซื้อที่ชำระเงินแล้วของร้านคุณ ยืนยัน จัดส่ง หรือยกเลิกได้ที่นี่",
      listLabel: "รายการคำสั่งซื้อ",
      // {count} is the number of orders found.
      count: "พบคำสั่งซื้อ {count} รายการ",
      emptyTitle: "ยังไม่มีคำสั่งซื้อ",
      emptyDescription: "คำสั่งซื้อจะแสดงที่นี่เมื่อลูกค้าชำระเงินแล้ว",
      filteredEmptyTitle: "ไม่พบคำสั่งซื้อในสถานะนี้",
      filteredEmptyDescription: "ลองดูคำสั่งซื้อทุกสถานะ",
      pageEmptyTitle: "ไม่มีคำสั่งซื้อในหน้านี้",
      pageEmptyAction: "กลับไปหน้าแรกของรายการ",
      filter: {
        title: "กรองคำสั่งซื้อ",
        status: "สถานะการจัดส่ง",
        all: "ทุกสถานะ",
        apply: "ใช้ตัวกรอง",
        reset: "ล้างตัวกรอง",
      },
      row: {
        orderNumber: "คำสั่งซื้อ",
        placedAt: "สั่งเมื่อ",
        // {count} is the number of item lines.
        itemCount: "{count} รายการสินค้า",
        subtotal: "ราคาสินค้า",
        shippingFee: "ค่าจัดส่ง",
        view: "ดูรายละเอียด",
        cancelledNote: "ยกเลิกแล้ว คืนเงินนอกระบบ",
      },
      detailTitle: "รายละเอียดคำสั่งซื้อ",
      backToList: "กลับไปรายการคำสั่งซื้อ",
      detail: {
        summaryTitle: "ข้อมูลคำสั่งซื้อ",
        orderNumber: "หมายเลขคำสั่งซื้อ",
        placedAt: "สั่งเมื่อ",
        paidAt: "ชำระเงินเมื่อ",
        payment: "การชำระเงิน",
        fulfilment: "สถานะการจัดส่ง",
        storeName: "ร้านค้า (ชื่อ ณ วันที่สั่งซื้อ)",
        buyerTitle: "ที่อยู่จัดส่งของผู้ซื้อ",
        recipient: "ชื่อผู้รับ",
        phone: "เบอร์โทรศัพท์",
        address: "ที่อยู่",
        itemsTitle: "สินค้าในคำสั่งซื้อ",
        itemsLabel: "รายการสินค้าในคำสั่งซื้อ",
        sku: "รหัสสินค้า",
        unitPrice: "ราคาต่อชิ้น",
        quantity: "จำนวน",
        lineTotal: "รวม",
        // {count} is the number of pieces.
        pieces: "{count} ชิ้น",
        subtotal: "ราคาสินค้ารวม",
        shippingFee: "ค่าจัดส่ง",
        totalsNote: "ยอดของร้านคุณเท่านั้น ไม่รวมสินค้าของร้านอื่นในคำสั่งซื้อเดียวกัน",
        shipmentTitle: "การจัดส่ง",
        carrier: "บริษัทขนส่ง",
        tracking: "เลขพัสดุ",
        shippedAt: "จัดส่งเมื่อ",
        deliveredAt: "จัดส่งสำเร็จเมื่อ",
        notProvided: "ไม่ได้ระบุ",
        noShipment: "ยังไม่มีการจัดส่ง",
        simulatedNote: "ระบบนี้จำลองการจัดส่ง ไม่ได้ติดต่อบริษัทขนส่งจริง",
        cancelledNote: "คำสั่งซื้อนี้ถูกยกเลิก คืนเงินนอกระบบ ระบบไม่ได้บันทึกการคืนเงิน",
      },
      actions: {
        title: "ดำเนินการ",
        confirm: "ยืนยันคำสั่งซื้อ",
        confirmed: "ยืนยันคำสั่งซื้อแล้ว",
        ship: "บันทึกการจัดส่ง",
        shipTitle: "ข้อมูลการจัดส่ง (ไม่บังคับ)",
        shipped: "บันทึกการจัดส่งแล้ว",
        carrierName: "บริษัทขนส่ง",
        trackingNumber: "เลขพัสดุ",
        deliver: "ยืนยันจัดส่งสำเร็จ",
        delivered: "บันทึกว่าจัดส่งสำเร็จแล้ว",
        cancel: "ยกเลิกคำสั่งซื้อ",
        cancelled: "ยกเลิกคำสั่งซื้อแล้ว สต็อกถูกคืนให้สินค้า",
        cancelConfirm: "ยืนยันการยกเลิกคำสั่งซื้อนี้ใช่หรือไม่",
        cancelConfirmNote:
          "ลูกค้าชำระเงินแล้ว ระบบจะคืนสต็อกให้สินค้า และไม่บันทึกการคืนเงิน (คืนเงินนอกระบบ) ยกเลิกแล้วย้อนกลับไม่ได้",
        cancelConfirmAction: "ยืนยันยกเลิก",
        noActions: "คำสั่งซื้อนี้ไม่มีการดำเนินการที่ทำได้อีก",
        shippedLocked: "จัดส่งแล้ว ยกเลิกไม่ได้ ทำได้เพียงยืนยันว่าจัดส่งสำเร็จ",
      },
    },
    // Picture upload and ordering (REQ-S-05).
    images: {
      add: "เพิ่มรูปภาพ",
      replace: "เปลี่ยนรูปภาพ",
      helper: "ไฟล์ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB",
      // {max} is the most pictures allowed.
      limit: "เพิ่มได้สูงสุด {max} รูป",
      firstNote: "รูปแรกเป็นรูปหลัก",
      uploading: "กำลังอัปโหลดรูปภาพ",
      uploaded: "อัปโหลดรูปภาพแล้ว กดบันทึกเพื่อใช้รูปนี้",
      tooBig: "ไฟล์ใหญ่เกิน 5 MB",
      wrongType: "รองรับเฉพาะไฟล์ JPEG, PNG และ WebP",
      empty: "ยังไม่มีรูปภาพ",
      listLabel: "รูปภาพ",
      // {index} is the picture number, {count} the number of pictures.
      alt: "รูปที่ {index} จาก {count}",
      remove: "ลบรูป",
      removeLabel: "ลบรูปที่ {index}",
      moveUp: "เลื่อนขึ้น",
      moveUpLabel: "เลื่อนรูปที่ {index} ขึ้น",
      moveDown: "เลื่อนลง",
      moveDownLabel: "เลื่อนรูปที่ {index} ลง",
    },
    dashboard: {
      title: "ภาพรวมร้านค้า",
      description: "สรุปสินค้า คำสั่งซื้อ และยอดขายของร้านคุณ",
      storeLabel: "ร้านค้า",
      productsTitle: "สินค้า",
      // Accessible names of the lists of figures.
      productsByStatusLabel: "จำนวนสินค้าตามสถานะ",
      lowStock: "สินค้าใกล้หมด (เหลือ 1 ถึง 5 ชิ้น)",
      soldOut: "สินค้าหมด",
      stockNote: "นับเฉพาะสินค้าที่กำลังขายอยู่",
      ordersTitle: "คำสั่งซื้อ",
      ordersNote: "นับเฉพาะคำสั่งซื้อที่ชำระเงินแล้ว",
      ordersByStatusLabel: "จำนวนคำสั่งซื้อตามสถานะ",
      salesTitle: "ยอดขาย",
      salesTotal: "ยอดขายรวม",
      salesNote: "เฉพาะราคาสินค้า ไม่รวมค่าจัดส่ง และไม่นับคำสั่งซื้อที่ยกเลิก",
      emptyTitle: "ร้านของคุณยังไม่มีสินค้า",
      emptyDescription:
        "เพิ่มสินค้าชิ้นแรกเพื่อเริ่มขาย สินค้าจะแสดงในร้านหลังผู้ดูแลระบบตรวจสอบแล้ว",
      emptyAction: "เพิ่มสินค้า",
      viewList: "ดูรายการ",
    },
    apply: {
      title: "สมัครเปิดร้านค้า",
      description: "กรอกข้อมูลร้านค้า ผู้ดูแลระบบจะตรวจสอบก่อนอนุมัติ",
      formTitle: "ข้อมูลร้านค้า",
      fields: {
        storeName: "ชื่อร้านค้า",
        description: "รายละเอียดร้านค้า",
        contactPhone: "เบอร์โทรติดต่อร้านค้า",
      },
      phoneHelper: "กรอกเป็นตัวเลขเท่านั้น เช่น 0812345678 หรือ +66812345678",
      submit: "ส่งใบสมัคร",
      submitted: "ส่งใบสมัครแล้ว รอผู้ดูแลระบบตรวจสอบ",
      statusTitle: "สถานะใบสมัคร",
      statusLabel: "สถานะ",
      sentAt: "ส่งเมื่อ",
      reviewedAt: "ตรวจสอบเมื่อ",
      rejectReason: "เหตุผลที่ไม่ผ่านการอนุมัติ",
      pendingNote: "ใบสมัครอยู่ระหว่างการตรวจสอบ ส่งใบสมัครใหม่ไม่ได้จนกว่าจะมีผล",
      approvedNote: "ใบสมัครได้รับอนุมัติแล้ว",
      reapplyTitle: "ส่งใบสมัครใหม่",
      reapplyNote: "แก้ไขข้อมูลตามเหตุผลข้างต้นแล้วส่งใบสมัครใหม่ได้",
    },
    fieldErrors: {
      carrierName: {
        required: "ชื่อบริษัทขนส่งต้องไม่เว้นว่าง",
        tooLong: "ชื่อบริษัทขนส่งต้องไม่เกิน 100 ตัวอักษร",
        invalid: "ชื่อบริษัทขนส่งมีอักขระที่ไม่รองรับ",
      },
      trackingNumber: {
        required: "เลขพัสดุต้องไม่เว้นว่าง",
        tooLong: "เลขพัสดุต้องไม่เกิน 100 ตัวอักษร",
        invalid: "เลขพัสดุมีอักขระที่ไม่รองรับ",
      },
      title: {
        required: "กรุณากรอกชื่อสินค้า",
        tooLong: "ชื่อสินค้าต้องไม่เกิน 200 ตัวอักษร",
        invalid: "ชื่อสินค้ามีอักขระที่ไม่รองรับ",
      },
      sku: {
        required: "กรุณากรอกรหัสสินค้า",
        tooLong: "รหัสสินค้าต้องไม่เกิน 64 ตัวอักษร",
        invalid: "รหัสสินค้ามีอักขระที่ไม่รองรับ",
      },
      categoryId: {
        required: "กรุณาเลือกหมวดหมู่",
        tooLong: "หมวดหมู่ไม่ถูกต้อง",
        invalid: "หมวดหมู่ไม่ถูกต้อง",
      },
      priceSatang: {
        required: "กรุณากรอกราคา อย่างน้อย 1 บาท",
        tooLong: "ราคาต้องไม่เกิน 1,000,000 บาท",
        invalid: "ราคาต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง",
      },
      stock: {
        required: "กรุณากรอกจำนวนสต็อก",
        tooLong: "สต็อกต้องไม่เกิน 1,000,000 ชิ้น",
        invalid: "สต็อกต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป",
      },
      imageKeys: {
        required: "รูปภาพไม่ถูกต้อง",
        tooLong: "เพิ่มรูปภาพได้สูงสุด 8 รูป",
        invalid: "รูปภาพไม่ถูกต้อง",
      },
      set: {
        required: "ใส่จำนวนตั้งแต่ 0 ถึง 1,000,000",
        tooLong: "สต็อกต้องไม่เกิน 1,000,000 ชิ้น",
        invalid: "ใส่เป็นจำนวนเต็มตั้งแต่ 0 ถึง 1,000,000",
      },
      adjust: {
        required: "ใส่จำนวนที่ไม่ใช่ 0 เช่น 10 หรือ -3",
        tooLong: "จำนวนที่ปรับต้องไม่เกิน 1,000,000",
        invalid: "ใส่เป็นจำนวนเต็มที่ไม่ใช่ 0 เช่น 10 หรือ -3",
      },
      name: {
        required: "กรุณากรอกชื่อร้านค้า",
        tooLong: "ชื่อร้านค้าต้องไม่เกิน 100 ตัวอักษร",
        invalid: "ชื่อร้านค้ามีอักขระที่ไม่รองรับ",
      },
      storeName: {
        required: "กรุณากรอกชื่อร้านค้า",
        tooLong: "ชื่อร้านค้าต้องไม่เกิน 100 ตัวอักษร",
        invalid: "ชื่อร้านค้ามีอักขระที่ไม่รองรับ",
      },
      description: {
        required: "กรุณากรอกรายละเอียด",
        tooLong: "รายละเอียดต้องไม่เกิน 2,000 ตัวอักษร",
        invalid: "รายละเอียดมีอักขระที่ไม่รองรับ",
      },
      contactPhone: {
        required: "กรุณากรอกเบอร์โทรศัพท์",
        tooLong: "เบอร์โทรศัพท์ยาวเกินไป",
        invalid: "เบอร์โทรศัพท์ต้องเป็นตัวเลขเท่านั้น (ขึ้นต้นด้วย 0 หรือ +66)",
      },
    },
  },
} as const;
