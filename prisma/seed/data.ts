/**
 * Sample data of the seed (T-014; DATA_MODEL.md sections 16 and 18). Pure: no database, no
 * randomness. Everything here is obviously sample data:
 *
 *   - accounts: display name prefix "ผู้ใช้ตัวอย่าง", email under the reserved domain example.com;
 *   - stores: name prefix "ร้านตัวอย่าง", and `isSample` true;
 *   - products: title prefix "สินค้าตัวอย่าง", and `isSample` true;
 *   - categories: `isSample` true.
 *
 * No reviews, no orders, no payments, no shipments, and no admin are seeded. The first admin comes
 * from `pnpm admin:bootstrap` (BR-26).
 *
 * The schema has no variant table: one sellable variant is one product with its own SKU, price,
 * and stock. The SKUs are also the keys of the picture list in scripts/seed-images.ts.
 *
 * Money is integer satang. Stock and prices stay inside the CHECK constraints of the first
 * migration and inside the seller's entry limit (BR-34); `validateSampleData` proves it.
 */

export const SAMPLE_EMAIL_DOMAIN = "example.com";
export const SAMPLE_USER_NAME_PREFIX = "ผู้ใช้ตัวอย่าง";
export const SAMPLE_STORE_NAME_PREFIX = "ร้านตัวอย่าง";
export const SAMPLE_PRODUCT_TITLE_PREFIX = "สินค้าตัวอย่าง";

/**
 * Password of every sample account. LOCAL DEVELOPMENT ONLY, published on purpose in
 * DATA_MODEL.md section 18, and not a secret: the seed refuses production and any database that
 * is not on this machine (guard.ts). The seed never prints it. Meets the sign-up policy
 * (REQ-C-01: 8 to 128 characters).
 */
export const SAMPLE_PASSWORD = "sample_dev_only_not_a_secret";

/** `Product.priceSatang` CHECK of the first migration. */
export const PRICE_MIN_SATANG = 100;
export const PRICE_MAX_SATANG = 100_000_000;
/** The seller's entry limit (BR-34, DATA_MODEL.md section 11); tighter than the column check. */
export const STOCK_MAX = 1_000_000;

/** Crockford base 32, lower case: digits and letters without i, l, o, u (DATA_MODEL.md section 9). */
const SLUG_SUFFIX_ALPHABET = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;
const READABLE_MAX_CODE_POINTS = 40;

/**
 * A slug in the scheme of DATA_MODEL.md section 9, with a fixed suffix instead of a random one so
 * that the seed finds its own rows again. The readable part: NFC, lower-cased, letters, marks, and
 * digits of any script kept, every other run made one `-`, trimmed of `-`, cut to 40 code points.
 */
export function sampleSlug(text: string, suffix: string): string {
  if (!SLUG_SUFFIX_ALPHABET.test(suffix)) {
    throw new RangeError("A slug suffix is 8 characters of lower-case Crockford base 32.");
  }
  const readable = Array.from(
    text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, ""),
  )
    .slice(0, READABLE_MAX_CODE_POINTS)
    .join("")
    .replace(/-+$/g, "");
  return readable === "" ? suffix : `${readable}-${suffix}`;
}

export type SampleRole = "CUSTOMER" | "SELLER";

export interface SampleUser {
  /** Stable key inside the seed. */
  key: string;
  email: string;
  name: string;
  role: SampleRole;
}

export interface SampleAddress {
  userKey: string;
  recipientName: string;
  phone: string;
  line1: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

export interface SampleCategory {
  key: string;
  name: string;
  slug: string;
  sortOrder: number;
}

export interface SampleStore {
  key: string;
  ownerKey: string;
  name: string;
  slug: string;
  description: string;
  contactPhone: string;
}

export interface SampleProduct {
  storeKey: string;
  categoryKey: string;
  sku: string;
  title: string;
  slug: string;
  description: string;
  priceSatang: number;
  stock: number;
  /** PUBLISHED with moderation APPROVED is visible on the storefront; DRAFT is the seller's only. */
  state: "LIVE" | "DRAFT";
}

export interface SampleData {
  users: SampleUser[];
  addresses: SampleAddress[];
  categories: SampleCategory[];
  stores: SampleStore[];
  products: SampleProduct[];
}

const SAMPLE_DESCRIPTION_NOTE = "ข้อมูลตัวอย่างสำหรับการพัฒนาและทดสอบระบบเท่านั้น ไม่ใช่สินค้าจริง";

function user(key: string, label: string, role: SampleRole): SampleUser {
  return {
    key,
    email: `sample-${key}@${SAMPLE_EMAIL_DOMAIN}`,
    name: `${SAMPLE_USER_NAME_PREFIX} ${label}`,
    role,
  };
}

function category(key: string, name: string, sortOrder: number, suffix: string): SampleCategory {
  return { key, name, slug: sampleSlug(name, suffix), sortOrder };
}

function store(
  key: string,
  ownerKey: string,
  label: string,
  description: string,
  contactPhone: string,
  suffix: string,
): SampleStore {
  const name = `${SAMPLE_STORE_NAME_PREFIX} ${label}`;
  return { key, ownerKey, name, slug: sampleSlug(name, suffix), description, contactPhone };
}

function product(
  input: Omit<SampleProduct, "title" | "slug" | "description" | "state"> & {
    label: string;
    detail: string;
    suffix: string;
    state?: SampleProduct["state"];
  },
): SampleProduct {
  const title = `${SAMPLE_PRODUCT_TITLE_PREFIX} ${input.label}`;
  return {
    storeKey: input.storeKey,
    categoryKey: input.categoryKey,
    sku: input.sku,
    title,
    slug: sampleSlug(title, input.suffix),
    description: `${input.detail}\n\n${SAMPLE_DESCRIPTION_NOTE}`,
    priceSatang: input.priceSatang,
    stock: input.stock,
    state: input.state ?? "LIVE",
  };
}

export function buildSampleData(): SampleData {
  return {
    users: [
      user("customer-1", "ลูกค้า 1", "CUSTOMER"),
      user("seller-1", "ผู้ขาย 1", "SELLER"),
      user("seller-2", "ผู้ขาย 2", "SELLER"),
    ],
    addresses: [
      {
        userKey: "customer-1",
        recipientName: `${SAMPLE_USER_NAME_PREFIX} ลูกค้า 1`,
        phone: "0800000001",
        line1: "99/9 ถนนตัวอย่าง (ที่อยู่ตัวอย่าง)",
        subdistrict: "ลุมพินี",
        district: "ปทุมวัน",
        province: "กรุงเทพมหานคร",
        postalCode: "10330",
      },
    ],
    categories: [
      category("clothing", "เสื้อผ้าแฟชั่น", 10, "smp0c001"),
      category("electronics", "อุปกรณ์อิเล็กทรอนิกส์", 20, "smp0c002"),
      category("home", "ของใช้ในบ้าน", 30, "smp0c003"),
      category("food", "อาหารและเครื่องดื่ม", 40, "smp0c004"),
      category("shoes", "รองเท้า", 15, "smp0c005"),
      category("beauty", "ความงามและสกินแคร์", 50, "smp0c006"),
      category("sports", "กีฬาและฟิตเนส", 60, "smp0c007"),
      category("accessories", "เครื่องประดับและแว่นตา", 70, "smp0c008"),
      category("computers", "คอมพิวเตอร์และโน้ตบุ๊ก", 80, "smp0c009"),
      category("phones", "มือถือและแท็บเล็ต", 90, "smp0c010"),
    ],
    stores: [
      store(
        "store-1",
        "seller-1",
        "เสื้อผ้าสบายใจ",
        `ร้านเสื้อผ้าตัวอย่าง ${SAMPLE_DESCRIPTION_NOTE}`,
        "0800000011",
        "smp0s001",
      ),
      store(
        "store-2",
        "seller-2",
        "ไอทีและของใช้",
        `ร้านอุปกรณ์ไอทีและของใช้ตัวอย่าง ${SAMPLE_DESCRIPTION_NOTE}`,
        "0800000012",
        "smp0s002",
      ),
    ],
    products: [
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-TS-WHT-M",
        label: "เสื้อยืดผ้าฝ้าย สีขาว ไซซ์ M",
        detail: "เสื้อยืดผ้าฝ้าย 100% เนื้อนุ่ม ใส่สบาย",
        priceSatang: 19900,
        stock: 50,
        suffix: "smp0p001",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-SH-RED-L",
        label: "เสื้อเชิ้ตลายสก็อต สีแดง ไซซ์ L",
        detail: "เสื้อเชิ้ตลายสก็อตสีแดง-ดำ (สินค้าหมด ใช้ทดสอบหน้าสินค้าหมด)",
        priceSatang: 45900,
        stock: 0,
        suffix: "smp0p002",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-SH-FLR",
        label: "เสื้อเชิ้ตแขนสั้นลายดอกไม้",
        detail: "เสื้อเชิ้ตแขนสั้นลายดอกไม้เขตร้อน ผ้าบางเบา ใส่สบาย",
        priceSatang: 39900,
        stock: 25,
        suffix: "smp0p003",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-SH-CHK",
        label: "เสื้อเชิ้ตลายสก็อต สีน้ำเงิน",
        detail: "เสื้อเชิ้ตแขนยาวลายสก็อตสีน้ำเงิน-ดำ ผ้าฝ้ายเนื้อนุ่ม",
        priceSatang: 42900,
        stock: 18,
        suffix: "smp0p004",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-DR-LEAF",
        label: "เดรสยาวลายใบไม้",
        detail: "เดรสยาวเปิดไหล่ลายใบไม้ ผ้าพลิ้ว ใส่เที่ยวทะเล",
        priceSatang: 89900,
        stock: 14,
        suffix: "smp0p005",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-DR-GRY",
        label: "เดรสแขนกุดสีเทา",
        detail: "เดรสทรงเรียบสีเทา กระดุมหน้า ใส่ได้ทุกวัน",
        priceSatang: 59000,
        stock: 20,
        suffix: "smp0p006",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-SK-RED",
        label: "กระโปรงยาวสีแดง",
        detail: "กระโปรงยาวสีแดงเอวสูง ทรงสวย",
        priceSatang: 25050,
        stock: 30,
        suffix: "smp0p007",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "clothing",
        sku: "SMP-BAG-WHT",
        label: "กระเป๋าเป้หนังเทียม สีขาว (ฉบับร่าง)",
        detail: "สินค้าฉบับร่าง ยังไม่เผยแพร่ ใช้ทดสอบหน้าจัดการสินค้าของผู้ขาย",
        priceSatang: 75900,
        stock: 20,
        suffix: "smp0p008",
        state: "DRAFT",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "shoes",
        sku: "SMP-SN-RJ",
        label: "รองเท้าผ้าใบหุ้มข้อ สีแดง-ขาว",
        detail: "รองเท้าผ้าใบหุ้มข้อ พื้นยางกันลื่น",
        priceSatang: 149000,
        stock: 16,
        suffix: "smp0p009",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "shoes",
        sku: "SMP-SN-WR",
        label: "รองเท้าผ้าใบสีขาว ลูกศรแดง",
        detail: "รองเท้าผ้าใบสีขาวสไตล์สปอร์ต พื้นหนานุ่ม",
        priceSatang: 79000,
        stock: 30,
        suffix: "smp0p010",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "shoes",
        sku: "SMP-RUN-001",
        label: "รองเท้าวิ่งสีสดใส",
        detail: "รองเท้าวิ่งน้ำหนักเบา พื้นนุ่มรับแรงกระแทก",
        priceSatang: 119500,
        stock: 12,
        suffix: "smp0p011",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "shoes",
        sku: "SMP-HL-BLK",
        label: "รองเท้าส้นสูงสีดำ",
        detail: "รองเท้าคัทชูส้นสูงสีดำ ใส่ทำงานได้",
        priceSatang: 99500,
        stock: 11,
        suffix: "smp0p012",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "shoes",
        sku: "SMP-HL-RED",
        label: "รองเท้าส้นสูงสีแดง",
        detail: "รองเท้าส้นสูงสีแดงเงา ใส่ออกงาน",
        priceSatang: 129000,
        stock: 7,
        suffix: "smp0p013",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "electronics",
        sku: "SMP-EAR-001",
        label: "หูฟังบลูทูธ",
        detail: "หูฟังไร้สาย เชื่อมต่อบลูทูธ แบตเตอรี่ใช้งานได้ประมาณ 6 ชั่วโมง",
        priceSatang: 129000,
        stock: 15,
        suffix: "smp0p014",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "electronics",
        sku: "SMP-CBL-001",
        label: "อะแดปเตอร์ชาร์จ USB",
        detail: "หัวชาร์จ USB พร้อมสายชาร์จ",
        priceSatang: 9900,
        stock: 200,
        suffix: "smp0p015",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "electronics",
        sku: "SMP-WT-001",
        label: "นาฬิกาข้อมือสแตนเลส",
        detail: "นาฬิกาข้อมือสายสแตนเลสสองสี หน้าปัดสีเทา",
        priceSatang: 329000,
        stock: 6,
        suffix: "smp0p016",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "home",
        sku: "SMP-TMB-001",
        label: "แก้วน้ำเก็บความเย็น 500 มล.",
        detail: "แก้วสแตนเลสสองชั้น เก็บความเย็นได้นาน",
        priceSatang: 35000,
        stock: 40,
        suffix: "smp0p017",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "home",
        sku: "SMP-LNC-001",
        label: "กล่องข้าวพร้อมฝาปิด",
        detail: "กล่องข้าวพลาสติกปลอดสาร BPA ใช้ได้กับไมโครเวฟ",
        priceSatang: 24900,
        stock: 35,
        suffix: "smp0p018",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "food",
        sku: "SMP-COF-001",
        label: "กาแฟคั่วบด 250 กรัม",
        detail: "กาแฟอาราบิกาคั่วกลาง บดพร้อมชง (เหลือน้อย ใช้ทดสอบสต็อกใกล้หมด)",
        priceSatang: 18500,
        stock: 3,
        suffix: "smp0p019",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "food",
        sku: "SMP-HNY-001",
        label: "น้ำผึ้งแท้ ขวดแก้ว",
        detail: "น้ำผึ้งแท้ธรรมชาติ บรรจุขวดแก้ว",
        priceSatang: 22900,
        stock: 45,
        suffix: "smp0p020",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "beauty",
        sku: "SMP-BTY-LIP",
        label: "ลิปสติกสีแดงสด",
        detail: "ลิปสติกเนื้อแมตต์ สีแดงสด ติดทนนาน",
        priceSatang: 4500,
        stock: 80,
        suffix: "smp0p021",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "beauty",
        sku: "SMP-BTY-MSC",
        label: "มาสคาร่าต่อขนตา กันน้ำ",
        detail: "มาสคาร่าสูตรกันน้ำ ขนตายาวและงอนเด้ง",
        priceSatang: 3500,
        stock: 60,
        suffix: "smp0p022",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "sports",
        sku: "SMP-SPT-BSK",
        label: "ลูกบาสเกตบอล เบอร์ 7",
        detail: "ลูกบาสเกตบอลมาตรฐาน เบอร์ 7 ใช้ได้ทั้งในร่มและกลางแจ้ง",
        priceSatang: 52000,
        stock: 25,
        suffix: "smp0p023",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "sports",
        sku: "SMP-SPT-GLV",
        label: "ถุงมือเบสบอล หนังเทียม",
        detail: "ถุงมือเบสบอลหนังเทียม ระบายอากาศได้ดี",
        priceSatang: 87500,
        stock: 12,
        suffix: "smp0p024",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "accessories",
        sku: "SMP-ACC-SUN",
        label: "แว่นกันแดดทรงคลาสสิก สีดำ",
        detail: "แว่นกันแดดกรอบสีดำ เลนส์กันรังสี UV",
        priceSatang: 84900,
        stock: 40,
        suffix: "smp0p025",
      }),
      product({
        storeKey: "store-1",
        categoryKey: "accessories",
        sku: "SMP-ACC-EAR",
        label: "ต่างหูคริสตัล สีเขียว",
        detail: "ต่างหูคริสตัลสีเขียว ประดับเงางาม",
        priceSatang: 105000,
        stock: 18,
        suffix: "smp0p026",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "computers",
        sku: "SMP-CMP-LNV",
        label: "โน้ตบุ๊กน้ำหนักเบา 2 in 1",
        detail: "โน้ตบุ๊กจอสัมผัสพับได้ 360 องศา น้ำหนักเบา พกพาสะดวก",
        priceSatang: 3849900,
        stock: 6,
        suffix: "smp0p027",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "computers",
        sku: "SMP-CMP-DEL",
        label: "โน้ตบุ๊กจอ 13 นิ้ว ขอบบาง",
        detail: "โน้ตบุ๊กจอ 13 นิ้ว ขอบจอบาง ใช้งานทั่วไปและทำงานนอกสถานที่",
        priceSatang: 5249900,
        stock: 4,
        suffix: "smp0p028",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "phones",
        sku: "SMP-PHN-IP6",
        label: "สมาร์ตโฟนหน้าจอ 4.7 นิ้ว",
        detail: "สมาร์ตโฟนหน้าจอ 4.7 นิ้ว กล้องคมชัด แบตเตอรี่ใช้ได้ทั้งวัน",
        priceSatang: 1049900,
        stock: 10,
        suffix: "smp0p029",
      }),
      product({
        storeKey: "store-2",
        categoryKey: "phones",
        sku: "SMP-PHN-TAB",
        label: "แท็บเล็ต 10 นิ้ว สีขาว",
        detail: "แท็บเล็ตหน้าจอ 10 นิ้ว เหมาะกับดูหนังและเรียนออนไลน์",
        priceSatang: 1224900,
        stock: 14,
        suffix: "smp0p030",
      }),
    ],
  };
}

/**
 * Every rule the data must meet before it is written: the sample markers, integer satang inside
 * the price check, stock inside the entry limit, keys that resolve, and the uniqueness the
 * database will enforce. Returns the problems found; an empty list means the data is valid.
 */
export function validateSampleData(data: SampleData): string[] {
  const problems: string[] = [];
  const userKeys = new Set<string>();
  const emails = new Set<string>();
  for (const u of data.users) {
    if (userKeys.has(u.key)) problems.push(`duplicate user key ${u.key}`);
    userKeys.add(u.key);
    if (emails.has(u.email)) problems.push(`duplicate email for user ${u.key}`);
    emails.add(u.email);
    if (u.email !== u.email.trim().toLowerCase()) problems.push(`email of ${u.key} not normalised`);
    if (!u.email.endsWith(`@${SAMPLE_EMAIL_DOMAIN}`)) problems.push(`email of ${u.key} not sample`);
    if (!u.name.startsWith(SAMPLE_USER_NAME_PREFIX)) problems.push(`name of ${u.key} not sample`);
  }

  for (const a of data.addresses) {
    if (!userKeys.has(a.userKey)) problems.push(`address of unknown user ${a.userKey}`);
    if (!/^[0-9]{5}$/.test(a.postalCode)) problems.push(`postal code of ${a.userKey}`);
  }

  const categoryKeys = new Set<string>();
  const slugs = new Set<string>();
  const checkSlug = (slug: string, owner: string): void => {
    if (slugs.has(slug)) problems.push(`duplicate slug of ${owner}`);
    slugs.add(slug);
  };
  for (const c of data.categories) {
    if (categoryKeys.has(c.key)) problems.push(`duplicate category key ${c.key}`);
    categoryKeys.add(c.key);
    if (!Number.isInteger(c.sortOrder)) problems.push(`sortOrder of ${c.key}`);
    checkSlug(c.slug, `category ${c.key}`);
  }

  const storeKeys = new Set<string>();
  const owners = new Set<string>();
  for (const s of data.stores) {
    if (storeKeys.has(s.key)) problems.push(`duplicate store key ${s.key}`);
    storeKeys.add(s.key);
    const owner = data.users.find((u) => u.key === s.ownerKey);
    if (owner === undefined) problems.push(`store ${s.key} has an unknown owner`);
    else if (owner.role !== "SELLER") problems.push(`owner of store ${s.key} is not a seller`);
    if (owners.has(s.ownerKey)) problems.push(`seller ${s.ownerKey} owns two stores`);
    owners.add(s.ownerKey);
    if (!s.name.startsWith(SAMPLE_STORE_NAME_PREFIX)) problems.push(`name of ${s.key} not sample`);
    checkSlug(s.slug, `store ${s.key}`);
  }
  for (const u of data.users) {
    if (u.role === "SELLER" && !owners.has(u.key)) problems.push(`seller ${u.key} has no store`);
  }

  const skus = new Set<string>();
  for (const p of data.products) {
    const id = `${p.storeKey}/${p.sku}`;
    if (skus.has(id)) problems.push(`duplicate SKU ${id}`);
    skus.add(id);
    if (!storeKeys.has(p.storeKey)) problems.push(`product ${id} in unknown store`);
    if (!categoryKeys.has(p.categoryKey)) problems.push(`product ${id} in unknown category`);
    if (!p.title.startsWith(SAMPLE_PRODUCT_TITLE_PREFIX))
      problems.push(`title of ${id} not sample`);
    if (
      !Number.isSafeInteger(p.priceSatang) ||
      p.priceSatang < PRICE_MIN_SATANG ||
      p.priceSatang > PRICE_MAX_SATANG
    ) {
      problems.push(`price of ${id} is not integer satang in range`);
    }
    if (!Number.isSafeInteger(p.stock) || p.stock < 0 || p.stock > STOCK_MAX) {
      problems.push(`stock of ${id} is not an integer in range`);
    }
    checkSlug(p.slug, `product ${id}`);
  }
  return problems;
}
