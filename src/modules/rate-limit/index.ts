/**
 * Public surface of the rate-limit module (SEC-052 option (b)). Route handlers import from here
 * only. The rules themselves are USER_RATE_LIMITS in src/server/rate-limit.ts.
 */
export { consumeUserRateLimit } from "./service";
