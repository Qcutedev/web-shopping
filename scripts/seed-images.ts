/**
 * Gives every sample product a product photo (local development only).
 * Run after `pnpm db:seed`:  pnpm db:seed-images
 *
 * The pictures are the product photos of dummyjson.com, a public mock-data service made for
 * development and testing (https://dummyjson.com/docs/products). They are downloaded here, once per
 * run, and stored through the upload storage (`UPLOAD_DIR`, written once, never overwritten) with
 * an `Upload` row of the product's store and a `ProductImage` row. They are not kept in the
 * repository. A run replaces the pictures of the sample products. Same guard as the seed: refuses
 * any database that is not on this machine.
 */
import { existsSync } from "node:fs";

import sharp from "sharp";

import { checkSeedEnvironment } from "../prisma/seed/guard";
import { getUploadStorage } from "../src/modules/uploads/config";
import { generateStorageKey } from "../src/modules/uploads/storage";
import { db, describeConnectionTarget } from "../src/server/db";

const SIZE = 800;
const CDN = "https://cdn.dummyjson.com/product-images";

/** SKU of a sample product -> folder of its photo on the service. */
const PHOTOS: Record<string, string> = {
  "SMP-TS-WHT-M": "mens-shirts/gigabyte-aorus-men-tshirt",
  "SMP-SH-RED-L": "mens-shirts/man-plaid-shirt",
  "SMP-SH-FLR": "mens-shirts/man-short-sleeve-shirt",
  "SMP-SH-CHK": "mens-shirts/blue-&-black-check-shirt",
  "SMP-DR-LEAF": "tops/girl-summer-dress",
  "SMP-DR-GRY": "tops/gray-dress",
  "SMP-SK-RED": "womens-dresses/corset-leather-with-skirt",
  "SMP-BAG-WHT": "womens-bags/white-faux-leather-backpack",
  "SMP-SN-RJ": "mens-shoes/nike-air-jordan-1-red-and-black",
  "SMP-SN-WR": "mens-shoes/sports-sneakers-off-white-&-red",
  "SMP-RUN-001": "mens-shoes/puma-future-rider-trainers",
  "SMP-HL-BLK": "womens-shoes/pampi-shoes",
  "SMP-HL-RED": "womens-shoes/red-shoes",
  "SMP-EAR-001": "mobile-accessories/beats-flex-wireless-earphones",
  "SMP-CBL-001": "mobile-accessories/apple-iphone-charger",
  "SMP-WT-001": "mens-watches/rolex-datejust",
  "SMP-TMB-001": "kitchen-accessories/black-aluminium-cup",
  "SMP-LNC-001": "kitchen-accessories/lunch-box",
  "SMP-COF-001": "groceries/nescafe-coffee",
  "SMP-HNY-001": "groceries/honey-jar",
};

/** The photo as a square JPEG on white, the whole product kept in view. */
async function download(folder: string): Promise<Buffer> {
  const response = await fetch(`${CDN}/${folder}/1.webp`);
  if (!response.ok) throw new Error(`photo ${folder} answered ${response.status}`);
  return sharp(Buffer.from(await response.arrayBuffer()))
    .resize(SIZE, SIZE, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function main(): Promise<number> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const refusal = checkSeedEnvironment(process.env, describeConnectionTarget);
  if (refusal !== null) {
    process.stderr.write(`Refused: ${refusal.message}\n`);
    return 2;
  }
  const storage = getUploadStorage();
  const products = await db.product.findMany({
    where: { isSample: true },
    orderBy: { slug: "asc" },
    select: { id: true, sku: true, storeId: true, images: { select: { uploadId: true } } },
  });
  // Pictures left without a product by an earlier run or a deleted sample product.
  const orphans = await db.upload.findMany({
    where: {
      store: { isSample: true },
      productImage: null,
      logoOfStore: null,
      orderItems: { none: {} },
    },
    select: { id: true, storageKey: true },
  });
  for (const orphan of orphans) {
    await db.upload.delete({ where: { id: orphan.id } });
    await storage.delete(orphan.storageKey);
  }
  let created = 0;
  let replaced = 0;
  let missing = 0;
  for (const product of products) {
    const folder = PHOTOS[product.sku];
    if (folder === undefined) {
      missing += 1;
      continue;
    }
    // Download first, so a failed download leaves the old picture in place.
    const bytes = await download(folder);
    for (const old of product.images) {
      const upload = await db.upload.findUnique({
        where: { id: old.uploadId },
        select: { id: true, storageKey: true },
      });
      await db.productImage.deleteMany({ where: { uploadId: old.uploadId } });
      if (upload !== null) {
        await db.upload.delete({ where: { id: upload.id } });
        await storage.delete(upload.storageKey);
        replaced += 1;
      }
    }
    const storageKey = generateStorageKey();
    await storage.put(storageKey, bytes);
    const upload = await db.upload.create({
      data: {
        storageKey,
        storeId: product.storeId,
        contentType: "image/jpeg",
        sizeBytes: bytes.length,
      },
      select: { id: true },
    });
    await db.productImage.create({
      data: { productId: product.id, uploadId: upload.id, sortOrder: 0 },
      select: { id: true },
    });
    created += 1;
  }
  process.stdout.write(
    `Sample product photos: ${created} created, ${replaced} replaced, ${missing} without a photo.\n`,
  );
  return 0;
}

main()
  .then(
    (status) => {
      process.exitCode = status;
    },
    (error: unknown) => {
      process.stderr.write(`Failed: ${error instanceof Error ? error.name : "error"}\n`);
      process.exitCode = 1;
    },
  )
  .finally(() => db.$disconnect());
