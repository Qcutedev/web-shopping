/**
 * Client address for rate limiting and security logging (security rule SR-01 in
 * docs/SECURITY.md, which is the specification for this file).
 *
 * `getClientAddress` is the only function in the code base that may read
 * `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, or any similar header. Nothing
 * else reads them, and nobody uses the result for authorization.
 *
 * Why the configuration matters: Next.js does not give a route handler the TCP
 * peer address, and it keeps a client-sent `X-Forwarded-For` as it is. Without a
 * proxy that the operator controls, every forwarding header is plain client
 * input. So the default configuration reads no header at all and the address is
 * the literal "unknown", which all clients then share as one rate-limit subject.
 *
 * The configuration is an explicit argument. This module does not read
 * process.env; src/server/env.ts validates `TRUSTED_PROXY_HOPS` and
 * `TRUSTED_CLIENT_IP_HEADER` and the caller passes the result in.
 *
 * Result: an IPv4 address in dotted decimal (`203.0.113.7`), an IPv6 /64 network
 * written as its four fully expanded lower-case groups followed by `::/64`
 * (`2001:0db8:85a3:0000::/64`), or "unknown". The result is personal data
 * (SR-04): log it only under the key `clientIp`, and only on security events.
 */
import { isIP } from "node:net";

export interface ClientAddressConfig {
  /**
   * `TRUSTED_PROXY_HOPS`: number of operator-controlled reverse proxies in front of the
   * application that each append the address they received the connection from to
   * `X-Forwarded-For`. Integer 0 to 5. 0 trusts no proxy.
   */
  trustedProxyHops: number;
  /**
   * `TRUSTED_CLIENT_IP_HEADER`: name of a single-value header that the platform's proxy always
   * overwrites with the client address. Cannot be combined with `trustedProxyHops` above 0.
   */
  trustedClientIpHeader?: string;
}

/** The default of SR-01: no proxy is trusted, no header is read, the address is unknown. */
export const NO_TRUSTED_PROXY: ClientAddressConfig = Object.freeze({ trustedProxyHops: 0 });

/** The shared subject for every client whose address cannot be established. */
export const UNKNOWN_CLIENT_ADDRESS = "unknown";

export const MAX_TRUSTED_PROXY_HOPS = 5;

const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
/** Headers that may never be named as the trusted client address header (SR-01). */
const FORBIDDEN_CLIENT_IP_HEADERS: ReadonlySet<string> = new Set([
  "x-forwarded-for",
  "forwarded",
  "cookie",
  "authorization",
  "host",
]);
const FORWARDED_FOR_HEADER = "x-forwarded-for";
const IPV4_MAPPED_PREFIX = "::ffff:";

/**
 * Throws a TypeError when `config` is outside what SR-01 allows. `getClientAddress` calls this
 * on every use so that a bad configuration can never widen what is trusted; src/server/env.ts
 * is expected to reject the same values at startup.
 */
export function assertClientAddressConfig(config: ClientAddressConfig): void {
  const { trustedProxyHops, trustedClientIpHeader } = config;
  if (
    !Number.isInteger(trustedProxyHops) ||
    trustedProxyHops < 0 ||
    trustedProxyHops > MAX_TRUSTED_PROXY_HOPS
  ) {
    throw new TypeError(`trustedProxyHops must be an integer from 0 to ${MAX_TRUSTED_PROXY_HOPS}.`);
  }
  if (trustedClientIpHeader === undefined) return;
  if (
    typeof trustedClientIpHeader !== "string" ||
    !HEADER_NAME_PATTERN.test(trustedClientIpHeader)
  ) {
    throw new TypeError("trustedClientIpHeader must match ^[A-Za-z0-9-]{1,64}$.");
  }
  if (FORBIDDEN_CLIENT_IP_HEADERS.has(trustedClientIpHeader.toLowerCase())) {
    throw new TypeError(
      "trustedClientIpHeader cannot be X-Forwarded-For, Forwarded, Cookie, Authorization, or Host.",
    );
  }
  if (trustedProxyHops > 0) {
    throw new TypeError("trustedProxyHops and trustedClientIpHeader cannot both be set.");
  }
}

/**
 * Returns the client address of `request` as far as `config` allows it to be known:
 * an IPv4 address, an IPv6 /64 network, or "unknown". Never throws for anything a client
 * sends; throws a TypeError only for an invalid `config`.
 */
export function getClientAddress(request: Request | Headers, config: ClientAddressConfig): string {
  assertClientAddressConfig(config);
  const { trustedProxyHops, trustedClientIpHeader } = config;

  // SR-01 step 1: with nothing trusted, no request header is read at all.
  if (trustedProxyHops === 0 && trustedClientIpHeader === undefined) return UNKNOWN_CLIENT_ADDRESS;

  const headers = request instanceof Headers ? request : request.headers;

  let candidate: string;
  if (trustedClientIpHeader !== undefined) {
    // Step 3: the header's whole value; missing or a list means unknown.
    const value = headers.get(trustedClientIpHeader);
    if (value === null || value.includes(",")) return UNKNOWN_CLIENT_ADDRESS;
    candidate = value;
  } else {
    // Step 2: `Headers.get` already combines repeated header lines with ", ". Each trusted proxy
    // appended the address it saw, so the entry `hops` places from the right is the first one a
    // client could not write. Everything to its left is client-controlled and never used.
    const combined = headers.get(FORWARDED_FOR_HEADER);
    if (combined === null) return UNKNOWN_CLIENT_ADDRESS;
    const entries = combined.split(",");
    const entry = entries[entries.length - trustedProxyHops];
    if (entry === undefined) return UNKNOWN_CLIENT_ADDRESS;
    candidate = entry.trim();
  }

  return normaliseAddress(candidate);
}

/** Steps 4 and 5 of SR-01. */
function normaliseAddress(candidate: string): string {
  // Bound the work on hostile input; the longest textual IPv6 address is 45 characters.
  if (candidate.length === 0 || candidate.length > 64) return UNKNOWN_CLIENT_ADDRESS;

  // `isIP` accepts a zone id ("fe80::1%eth0"); SR-01 does not.
  if (candidate.includes("%")) return UNKNOWN_CLIENT_ADDRESS;

  // `isIP` only accepts dotted decimal without leading zeros, so IPv4 is already canonical.
  if (candidate.slice(0, IPV4_MAPPED_PREFIX.length).toLowerCase() === IPV4_MAPPED_PREFIX) {
    // What follows an IPv4-mapped prefix must be the IPv4 address. Every valid address gets the
    // result SR-01 describes (the remainder of a valid address is never itself IPv6); the only
    // difference is that garbage such as "::ffff:::ffff:1.2.3.4" is unknown.
    const mapped = candidate.slice(IPV4_MAPPED_PREFIX.length);
    return isIP(mapped) === 4 ? mapped : UNKNOWN_CLIENT_ADDRESS;
  }

  const family = isIP(candidate);
  if (family === 4) return candidate;
  if (family === 6) return ipv6Network(candidate);
  return UNKNOWN_CLIENT_ADDRESS;
}

/** The /64 network of a valid textual IPv6 address: its first four groups, fully expanded. */
function ipv6Network(address: string): string {
  const [head = "", tail] = address.toLowerCase().split("::");
  const headGroups = head === "" ? [] : head.split(":");
  // Without "::" the address has all eight groups, or six groups and a dotted IPv4 tail; in both
  // cases the first four entries are plain hexadecimal groups. With "::", the groups it stands
  // for are zero, and a dotted IPv4 tail counts as two groups.
  let groups = headGroups;
  if (tail !== undefined) {
    const tailGroups = expandIpv4Tail(tail === "" ? [] : tail.split(":"));
    const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
    groups = [...headGroups, ...Array.from({ length: missing }, () => "0"), ...tailGroups];
  }

  const network: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const group = groups[index];
    // A dotted tail can only reach the first four groups in a form `isIP` rejects.
    if (group === undefined || group.includes(".")) return UNKNOWN_CLIENT_ADDRESS;
    network.push(group.padStart(4, "0"));
  }
  return `${network.join(":")}::/64`;
}

/** Replaces a trailing dotted IPv4 part ("1.2.3.4") by its two hexadecimal groups. */
function expandIpv4Tail(groups: string[]): string[] {
  const last = groups[groups.length - 1];
  if (last === undefined || !last.includes(".")) return groups;
  const octets = last.split(".").map((octet) => Number(octet));
  const [a, b, c, d] = octets;
  if (
    octets.length !== 4 ||
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    return groups;
  }
  return [...groups.slice(0, -1), ((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}
