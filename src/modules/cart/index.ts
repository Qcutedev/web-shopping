/**
 * Public surface of the cart module. Route handlers and pages import from here only.
 */
export { addCartItem, countCartLines, deleteCartItem, getCart, updateCartItem } from "./service";
export type { AddCartItemResult } from "./service";
/** The pure cart computation, for checkout's refusal totals (API_CONTRACTS 5.5.3, T-032). */
export { buildCart, type CartLineInput } from "./pricing";
export * from "./schema";
