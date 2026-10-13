/**
 * Public surface of the profile module. Route handlers and pages import from here only.
 */
export {
  createAddress,
  deleteAddress,
  getProfile,
  listAddresses,
  updateAddress,
  updateProfile,
} from "./service";
export * from "./schema";
