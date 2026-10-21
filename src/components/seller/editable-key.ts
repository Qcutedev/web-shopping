import type { SellerProductDto } from "@/modules/inventory/schema";
import type { SellerStoreDto } from "@/modules/sellers/schema";
import { valuesOfProduct } from "./product-form-model";

/**
 * Keys of the fields a seller edits by hand. A form re-seeds its typed values only when this key
 * of the stored record changes. After a successful save the form sets its "seen" key from the
 * server's answer with the same helper, so the refresh that follows carries the same key and does
 * not wipe text typed in between (CR-119). Pure; unit tested.
 */

/** Stock is not edited in the product form after create, so it is left out. */
export function productEditableKey(product: SellerProductDto | undefined): string {
  return JSON.stringify(product ? { ...valuesOfProduct(product), stock: "" } : null);
}

export function storeEditableKey(
  store: Pick<SellerStoreDto, "name" | "description" | "contactPhone" | "logo">,
): string {
  return JSON.stringify([store.name, store.description, store.contactPhone, store.logo]);
}
