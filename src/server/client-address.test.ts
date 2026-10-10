import { describe, expect, it } from "vitest";

import {
  assertClientAddressConfig,
  type ClientAddressConfig,
  getClientAddress,
  NO_TRUSTED_PROXY,
  UNKNOWN_CLIENT_ADDRESS,
} from "./client-address";

function request(headers: Record<string, string> | [string, string][] = {}): Request {
  return new Request("http://localhost/api/v1/cart", { headers });
}

const hops = (trustedProxyHops: number): ClientAddressConfig => ({ trustedProxyHops });
const header = (trustedClientIpHeader: string): ClientAddressConfig => ({
  trustedProxyHops: 0,
  trustedClientIpHeader,
});

/** Every header a client might use to claim an address. */
const SPOOFED = {
  "X-Forwarded-For": "203.0.113.50",
  Forwarded: "for=203.0.113.51",
  "X-Real-IP": "203.0.113.52",
  "X-Client-IP": "203.0.113.53",
  "CF-Connecting-IP": "203.0.113.54",
  "True-Client-IP": "203.0.113.55",
  "Fly-Client-IP": "203.0.113.56",
  "X-Vercel-Forwarded-For": "203.0.113.57",
};

describe("default configuration: nothing is trusted", () => {
  it("uses the literal unknown", () => {
    expect(UNKNOWN_CLIENT_ADDRESS).toBe("unknown");
    expect(NO_TRUSTED_PROXY).toEqual({ trustedProxyHops: 0 });
    expect(getClientAddress(request(), NO_TRUSTED_PROXY)).toBe("unknown");
  });

  it("ignores every spoofed forwarding header", () => {
    expect(getClientAddress(request(SPOOFED), NO_TRUSTED_PROXY)).toBe("unknown");
    expect(getClientAddress(new Headers(SPOOFED), hops(0))).toBe("unknown");
    for (const [name, value] of Object.entries(SPOOFED)) {
      expect(getClientAddress(request({ [name]: value }), NO_TRUSTED_PROXY)).toBe("unknown");
    }
  });

  it("gives every client the same subject, so a client cannot mint a fresh one per request", () => {
    const subjects = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      subjects.add(
        getClientAddress(request({ "X-Forwarded-For": `198.51.100.${index}` }), NO_TRUSTED_PROXY),
      );
    }
    expect([...subjects]).toEqual(["unknown"]);
  });

  it("does not read any request header at all", () => {
    const read: string[] = [];
    const headers = new Headers(SPOOFED);
    const spy = new Proxy(headers, {
      get(target, property) {
        read.push(String(property));
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fake = { headers: spy } as unknown as Request;
    expect(getClientAddress(fake, NO_TRUSTED_PROXY)).toBe("unknown");
    expect(read).toEqual([]);

    // The same probe does see reads once a proxy is trusted, so it is a real check.
    expect(getClientAddress(fake, hops(1))).toBe("203.0.113.50");
    expect(read).toContain("get");
  });
});

describe("hops mode (TRUSTED_PROXY_HOPS)", () => {
  it("takes the last entry with one hop", () => {
    expect(getClientAddress(request({ "X-Forwarded-For": "203.0.113.7" }), hops(1))).toBe(
      "203.0.113.7",
    );
  });

  it("takes the entry n places from the right and never anything to its left", () => {
    const chain = { "X-Forwarded-For": "10.9.9.9, 198.51.100.1, 203.0.113.7, 192.0.2.1" };
    expect(getClientAddress(request(chain), hops(1))).toBe("192.0.2.1");
    expect(getClientAddress(request(chain), hops(2))).toBe("203.0.113.7");
    expect(getClientAddress(request(chain), hops(3))).toBe("198.51.100.1");
    expect(getClientAddress(request(chain), hops(4))).toBe("10.9.9.9");
  });

  it("a client that prepends its own entries cannot change the result", () => {
    // The proxy appended 203.0.113.7 (what it saw); everything before it came from the client.
    for (const forged of [
      "1.2.3.4",
      "1.2.3.4, 5.6.7.8",
      "unknown",
      "127.0.0.1, ::1, 10.0.0.1",
      ",,,",
      "a".repeat(5_000),
    ]) {
      expect(
        getClientAddress(request({ "X-Forwarded-For": `${forged}, 203.0.113.7` }), hops(1)),
      ).toBe("203.0.113.7");
    }
  });

  it("is unknown when there are fewer entries than hops", () => {
    expect(getClientAddress(request({ "X-Forwarded-For": "203.0.113.7" }), hops(2))).toBe(
      "unknown",
    );
    expect(getClientAddress(request({ "X-Forwarded-For": "1.1.1.1, 2.2.2.2" }), hops(5))).toBe(
      "unknown",
    );
  });

  it("is unknown when the header is missing or empty", () => {
    expect(getClientAddress(request(), hops(1))).toBe("unknown");
    expect(getClientAddress(request({ "X-Forwarded-For": "" }), hops(1))).toBe("unknown");
    expect(getClientAddress(request({ "X-Forwarded-For": "203.0.113.7," }), hops(1))).toBe(
      "unknown",
    );
  });

  it("combines repeated header lines in order and trims each entry", () => {
    const repeated = request([
      ["X-Forwarded-For", "198.51.100.1"],
      ["X-Forwarded-For", "  203.0.113.7  "],
    ]);
    expect(getClientAddress(repeated, hops(1))).toBe("203.0.113.7");
    expect(getClientAddress(repeated, hops(2))).toBe("198.51.100.1");
    expect(
      getClientAddress(request({ "X-Forwarded-For": "198.51.100.1 ,\t203.0.113.7" }), hops(1)),
    ).toBe("203.0.113.7");
  });

  it("reads only X-Forwarded-For, not the other forwarding headers", () => {
    const others: Record<string, string> = { ...SPOOFED };
    delete others["X-Forwarded-For"];
    expect(getClientAddress(request(others), hops(1))).toBe("unknown");
  });

  it("accepts a Headers object as well as a Request", () => {
    expect(getClientAddress(new Headers({ "x-forwarded-for": "203.0.113.7" }), hops(1))).toBe(
      "203.0.113.7",
    );
  });
});

describe("single-header mode (TRUSTED_CLIENT_IP_HEADER)", () => {
  it("uses the whole value of the named header, whatever its case", () => {
    expect(
      getClientAddress(request({ "Fly-Client-IP": "203.0.113.7" }), header("Fly-Client-IP")),
    ).toBe("203.0.113.7");
    expect(
      getClientAddress(request({ "fly-client-ip": "203.0.113.7" }), header("FLY-CLIENT-IP")),
    ).toBe("203.0.113.7");
  });

  it("is unknown when the header is missing", () => {
    expect(getClientAddress(request(), header("Fly-Client-IP"))).toBe("unknown");
  });

  it("is unknown when the value contains a comma (a list, or the header sent twice)", () => {
    expect(
      getClientAddress(
        request({ "Fly-Client-IP": "203.0.113.7, 198.51.100.1" }),
        header("Fly-Client-IP"),
      ),
    ).toBe("unknown");
    const twice = request([
      ["Fly-Client-IP", "203.0.113.7"],
      ["Fly-Client-IP", "198.51.100.1"],
    ]);
    expect(getClientAddress(twice, header("Fly-Client-IP"))).toBe("unknown");
  });

  it("ignores X-Forwarded-For and the other headers in this mode", () => {
    expect(getClientAddress(request(SPOOFED), header("X-Platform-Client-Ip"))).toBe("unknown");
    expect(
      getClientAddress(
        request({ ...SPOOFED, "X-Platform-Client-Ip": "192.0.2.44" }),
        header("X-Platform-Client-Ip"),
      ),
    ).toBe("192.0.2.44");
  });
});

describe("parsing and normalisation", () => {
  const via = (value: string): string =>
    getClientAddress(request({ "X-Forwarded-For": value }), hops(1));

  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["0.0.0.0", "0.0.0.0"],
    ["255.255.255.255", "255.255.255.255"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:203.0.113.7", "203.0.113.7"],
  ])("IPv4 %s becomes %s", (input, expected) => {
    expect(via(input)).toBe(expected);
  });

  it.each([
    ["2001:db8:85a3:1:2:3:4:5", "2001:0db8:85a3:0001::/64"],
    ["2001:0DB8:85A3:0001:FFFF:FFFF:FFFF:FFFF", "2001:0db8:85a3:0001::/64"],
    ["2001:db8::1", "2001:0db8:0000:0000::/64"],
    ["2001:db8:1::", "2001:0db8:0001:0000::/64"],
    ["2001:db8:0:1::abcd", "2001:0db8:0000:0001::/64"],
    ["::1", "0000:0000:0000:0000::/64"],
    ["::", "0000:0000:0000:0000::/64"],
    ["fe80::1", "fe80:0000:0000:0000::/64"],
    ["1::2:3:4:5:6", "0001:0000:0000:0002::/64"],
    ["1:2::3:4:5:6:7", "0001:0002:0000:0003::/64"],
    ["::2:3:4:5:6:7", "0000:0000:0002:0003::/64"],
    ["64:ff9b::203.0.113.7", "0064:ff9b:0000:0000::/64"],
    ["2001:db8:1:2:3:4:203.0.113.7", "2001:0db8:0001:0002::/64"],
    ["::203.0.113.7", "0000:0000:0000:0000::/64"],
  ])("IPv6 %s is reduced to its /64 network %s", (input, expected) => {
    expect(via(input)).toBe(expected);
  });

  it("groups every address of one /64 under one subject and keeps other networks apart", () => {
    const same = new Set<string>();
    for (let index = 0; index < 64; index += 1) {
      same.add(via(`2001:db8:aaaa:bbbb:${index.toString(16)}:ffff:1:${index.toString(16)}`));
    }
    expect([...same]).toEqual(["2001:0db8:aaaa:bbbb::/64"]);
    expect(via("2001:db8:aaaa:bbbc::1")).toBe("2001:0db8:aaaa:bbbc::/64");
    expect(via("2001:db8:aaaa:bbb::1")).toBe("2001:0db8:aaaa:0bbb::/64");
  });

  it.each([
    ["host name", "example.com"],
    ["localhost", "localhost"],
    ["the word unknown", "unknown"],
    ["obfuscated identifier", "_hidden"],
    ["IPv4 with a port", "203.0.113.7:443"],
    ["bracketed IPv6", "[2001:db8::1]"],
    ["bracketed IPv6 with a port", "[2001:db8::1]:443"],
    ["IPv6 with a zone id", "fe80::1%eth0"],
    ["mapped IPv4 with a zone id", "::ffff:203.0.113.7%eth0"],
    ["IPv4 with leading zeros", "203.000.113.007"],
    ["IPv4 with too few parts", "203.0.113"],
    ["IPv4 out of range", "203.0.113.256"],
    ["decimal IPv4", "3405803783"],
    ["hexadecimal IPv4", "0xCB007107"],
    ["CIDR notation", "203.0.113.0/24"],
    ["mapped prefix on something that is not IPv4", "::ffff:example.com"],
    ["mapped prefix in hexadecimal form", "::ffff:cb00:7107"],
    ["mapped prefix twice", "::ffff:::ffff:203.0.113.7"],
    ["Forwarded syntax", "for=203.0.113.7"],
    ["quoted", '"203.0.113.7"'],
    ["inner whitespace", "203.0.113 .7"],
    ["script", "<script>alert(1)</script>"],
    ["very long", "1".repeat(10_000)],
    ["too many groups", "1:2:3:4:5:6:7:8:9"],
    ["two double colons", "2001::db8::1"],
    ["superscript digits", "²³.0.113.7"],
  ])("%s is unknown", (_label, value) => {
    expect(via(value)).toBe("unknown");
    expect(getClientAddress(request({ "X-Client": value }), header("X-Client"))).toBe("unknown");
  });

  it("never returns client text other than a normalised address", () => {
    const hostile = ["203.0.113.7;rm", "203.0.113.7 x", "a@b.c", "..", "::ffff:", "%", ":"];
    for (const value of hostile) {
      const result = getClientAddress(new Headers({ "x-client": value }), header("x-client"));
      expect(result).toBe("unknown");
    }
  });
});

describe("configuration", () => {
  it.each([
    ["negative hops", { trustedProxyHops: -1 }],
    ["more than five hops", { trustedProxyHops: 6 }],
    ["fractional hops", { trustedProxyHops: 1.5 }],
    ["NaN hops", { trustedProxyHops: Number.NaN }],
    ["hops as a string", { trustedProxyHops: "1" as unknown as number }],
    ["hops as a boolean trust switch", { trustedProxyHops: true as unknown as number }],
    ["both modes at once", { trustedProxyHops: 1, trustedClientIpHeader: "Fly-Client-IP" }],
    ["X-Forwarded-For as the single header", header("X-Forwarded-For")],
    ["x-forwarded-for in lower case", header("x-forwarded-for")],
    ["Forwarded as the single header", header("Forwarded")],
    ["Cookie as the single header", header("Cookie")],
    ["Authorization as the single header", header("AUTHORIZATION")],
    ["Host as the single header", header("Host")],
    ["empty header name", header("")],
    ["header name with a space", header("X Client")],
    ["header name with a colon", header("X-Client:")],
    ["header name with a line break", header("X-Client\r\nX-Other")],
    ["header name longer than 64 characters", header("X".repeat(65))],
  ])("rejects %s", (_label, config) => {
    expect(() => assertClientAddressConfig(config)).toThrow(TypeError);
    // A bad configuration never falls back to trusting something: no address is produced.
    expect(() => getClientAddress(request(SPOOFED), config)).toThrow(TypeError);
  });

  it("accepts 0 to 5 hops and a well-formed header name", () => {
    for (let count = 0; count <= 5; count += 1) {
      expect(() => assertClientAddressConfig(hops(count))).not.toThrow();
    }
    expect(() => assertClientAddressConfig(header("Fly-Client-IP"))).not.toThrow();
    expect(() => assertClientAddressConfig(header("X".repeat(64)))).not.toThrow();
  });
});
