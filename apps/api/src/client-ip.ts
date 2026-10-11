import { isIP } from "node:net";

export interface ClientKeyInput {
  /** Raw X-Forwarded-For value; multiple headers may already be joined with commas. */
  forwardedFor: string | undefined;
  /** Socket peer address. */
  remoteAddress: string | undefined;
  /** Whether X-Forwarded-For is set by a trusted reverse proxy. */
  trustProxy: boolean;
  /**
   * Number of trusted proxies in front of the API. The client address is the entry this many
   * positions from the right, because each proxy appends the address it received from; anything
   * further left is client-controlled.
   */
  trustedHops: number;
}

/**
 * Derives a stable per-client key for rate limits. IPv4 clients key as "v4:a.b.c.d"; IPv6 clients
 * key by their /64 prefix ("v6:xxxx:xxxx:xxxx:xxxx::/64") because one subscriber usually controls a
 * whole /64. Returns "unknown" when no valid address is available.
 */
export function clientKeyFrom(input: ClientKeyInput): string {
  if (input.trustProxy) {
    const hops = Number.isInteger(input.trustedHops) && input.trustedHops >= 1 ? input.trustedHops : 1;
    const entries = (input.forwardedFor ?? "").split(",").map((s) => s.trim());
    // An empty header yields [""], which is not a usable entry.
    if (entries.length >= hops) {
      const key = normaliseAddress(entries[entries.length - hops]!);
      if (key) return key;
    }
  }
  return normaliseAddress(input.remoteAddress ?? "") ?? "unknown";
}

/** Normalises one address to its client key, or null when it is not a valid IP. */
export function normaliseAddress(raw: string): string | null {
  let s = raw.trim().replace(/^"|"$/g, "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("[")) {
    // [v6]:port or [v6]
    const end = s.indexOf("]");
    if (end < 0) return null;
    const rest = s.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    s = s.slice(1, end);
  } else if (s.includes(".") && s.indexOf(":") === s.lastIndexOf(":") && s.includes(":")) {
    // a.b.c.d:port
    const [host, port] = s.split(":");
    if (!/^\d{1,5}$/.test(port!)) return null;
    s = host!;
  }
  // Drop an IPv6 zone id (fe80::1%eth0); it does not identify a different client.
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  const family = isIP(s);
  if (family === 4) return `v4:${s}`;
  if (family !== 6) return null;

  const hextets = expandIPv6(s);
  if (!hextets) return null;
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) is the IPv4 client itself.
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    const hi = hextets[6]!;
    const lo = hextets[7]!;
    return `v4:${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  const prefix = hextets
    .slice(0, 4)
    .map((h) => h.toString(16).padStart(4, "0"))
    .join(":");
  return `v6:${prefix}::/64`;
}

/** Expands a valid IPv6 string (already checked with isIP) to its 8 numeric hextets. */
function expandIPv6(addr: string): number[] | null {
  let s = addr;
  const tail: number[] = [];
  // Embedded dotted IPv4 in the last 32 bits.
  const lastColon = s.lastIndexOf(":");
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const octets = last.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    tail.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
    s = s.slice(0, lastColon + 1);
    // "::1.2.3.4" leaves "::"; "64:ff9b::1.2.3.4" leaves "64:ff9b::"; "a:b:c:d:e:f:1.2.3.4" leaves trailing ":".
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const parse = (part: string) => (part ? part.split(":").map((h) => parseInt(h, 16)) : []);
  const want = 8 - tail.length;
  let groups: number[];
  const dbl = s.indexOf("::");
  if (dbl >= 0) {
    const head = parse(s.slice(0, dbl));
    const rest = parse(s.slice(dbl + 2));
    const fill = want - head.length - rest.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = parse(s);
  }
  if (groups.length !== want || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return [...groups, ...tail];
}
