import { describe, expect, it } from "vitest";
import { clientKeyFrom } from "../src/client-ip";
import { parseTrustedHops } from "../src/context";

const proxied = (forwardedFor: string | undefined, remoteAddress = "10.0.0.1", trustedHops = 1) =>
  clientKeyFrom({ forwardedFor, remoteAddress, trustProxy: true, trustedHops });
const direct = (remoteAddress: string | undefined) =>
  clientKeyFrom({ forwardedFor: undefined, remoteAddress, trustProxy: false, trustedHops: 1 });

describe("clientKeyFrom", () => {
  it("ignores client-controlled leftmost entries and uses the rightmost one", () => {
    expect(proxied("6.6.6.6, 7.7.7.7, 203.0.113.9")).toBe("v4:203.0.113.9");
    expect(proxied("1.1.1.1, 203.0.113.9")).toBe(proxied("9.9.9.9, 203.0.113.9"));
  });

  it("picks the entry trustedHops positions from the right", () => {
    expect(proxied("6.6.6.6, 203.0.113.9, 10.1.1.1", "10.0.0.1", 2)).toBe("v4:203.0.113.9");
  });

  it("falls back to the remote address when the header is missing, short or invalid", () => {
    expect(proxied(undefined)).toBe("v4:10.0.0.1");
    expect(proxied("")).toBe("v4:10.0.0.1");
    expect(proxied("203.0.113.9", "10.0.0.1", 2)).toBe("v4:10.0.0.1");
    expect(proxied("1.2.3.4, not-an-ip")).toBe("v4:10.0.0.1");
    expect(proxied("1.2.3.4, ")).toBe("v4:10.0.0.1");
  });

  it("strips ports and brackets", () => {
    expect(proxied("1.2.3.4:5555")).toBe("v4:1.2.3.4");
    expect(proxied(" 1.2.3.4 ")).toBe("v4:1.2.3.4");
    expect(proxied("[2001:db8::1]:443")).toBe(proxied("2001:db8::1"));
    expect(proxied("[2001:db8::1]")).toBe("v6:2001:0db8:0000:0000::/64");
  });

  it("maps IPv4-mapped IPv6 to plain IPv4", () => {
    expect(direct("::ffff:1.2.3.4")).toBe("v4:1.2.3.4");
    expect(direct("::ffff:0102:0304")).toBe("v4:1.2.3.4");
    expect(direct("::FFFF:102:304")).toBe("v4:1.2.3.4");
    expect(proxied("[::ffff:1.2.3.4]:80")).toBe("v4:1.2.3.4");
  });

  it("maps case and zero-compression variants of one IPv6 address to the same key", () => {
    const variants = [
      "2001:db8:abcd:12::1",
      "2001:DB8:ABCD:12:0:0:0:1",
      "2001:0db8:abcd:0012:0000:0000:0000:0001",
      "2001:db8:abcd:12:0::1",
    ];
    const keys = new Set(variants.map(direct));
    expect([...keys]).toEqual(["v6:2001:0db8:abcd:0012::/64"]);
  });

  it("keys IPv6 by /64 prefix", () => {
    expect(direct("2001:db8:1:2::1")).toBe(direct("2001:db8:1:2:dead:beef:cafe:f00d"));
    expect(direct("2001:db8:1:2::1")).not.toBe(direct("2001:db8:1:3::1"));
  });

  it("ignores X-Forwarded-For entirely when the proxy is not trusted", () => {
    expect(
      clientKeyFrom({ forwardedFor: "203.0.113.9", remoteAddress: "10.0.0.1", trustProxy: false, trustedHops: 1 }),
    ).toBe("v4:10.0.0.1");
    expect(clientKeyFrom({ forwardedFor: "203.0.113.9", remoteAddress: undefined, trustProxy: false, trustedHops: 1 })).toBe(
      "unknown",
    );
  });

  it("returns unknown for garbage input", () => {
    expect(direct(undefined)).toBe("unknown");
    expect(direct("")).toBe("unknown");
    expect(direct("garbage")).toBe("unknown");
    expect(direct("999.1.1.1")).toBe("unknown");
    expect(direct("1.2.3.4:notaport")).toBe("unknown");
    expect(proxied("evil, also-evil", "nonsense")).toBe("unknown");
  });
});

describe("parseTrustedHops", () => {
  it("defaults to 1 and accepts positive integers", () => {
    expect(parseTrustedHops(undefined)).toBe(1);
    expect(parseTrustedHops("")).toBe(1);
    expect(parseTrustedHops("2")).toBe(2);
    expect(parseTrustedHops(3)).toBe(3);
  });

  it("rejects zero, negatives and non-integers", () => {
    for (const bad of ["0", "-1", "1.5", "abc", 0]) expect(() => parseTrustedHops(bad)).toThrow();
  });
});
