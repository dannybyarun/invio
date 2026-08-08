const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

type IPv4 = [number, number, number, number];
type IPv6 = number[];

function stripIpv6Brackets(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
}

function parseIPv4(value: string): IPv4 | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return null;
  return numbers as IPv4;
}

function parseIPv6(value: string): IPv6 | null {
  const address = stripIpv6Brackets(value);
  if (!address.includes(":") || address.includes("%")) return null;

  const halves = address.split("::");
  if (halves.length > 2) return null;

  const expandPart = (part: string): number[] | null => {
    if (!part) return [];
    const pieces = part.split(":");
    const groups: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const ipv4 = parseIPv4(piece);
        if (!ipv4 || piece !== pieces[pieces.length - 1]) return null;
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };

  const left = expandPart(halves[0]);
  const right = expandPart(halves[1] ?? "");
  if (!left || !right) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  if (left.length + right.length >= 8) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

function ipv4FromGroups(groups: IPv6, start: number): IPv4 {
  const high = groups[start];
  const low = groups[start + 1];
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIPv4(hostname: string): boolean {
  const address = parseIPv4(hostname);
  if (!address) return false;
  const [a, b, c] = address;

  // Unspecified, private, loopback, link-local, and carrier-grade NAT ranges.
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;

  // Other special-use and non-routable ranges should not be fetch targets.
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 18) return true;
  if (a === 198 && b === 19) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;

  return false;
}

function hasPrivateEmbeddedIPv4(groups: IPv6, start: number): boolean {
  return isPrivateIPv4(ipv4FromGroups(groups, start).join("."));
}

function isPrivateIPv6(hostname: string): boolean {
  const groups = parseIPv6(hostname);
  if (!groups) return false;

  const allZero = groups.every((group) => group === 0);
  const loopback = allZero === false &&
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  if (allZero || loopback) return true;

  const first = groups[0];
  // Unique-local fc00::/7, link-local fe80::/10, deprecated site-local
  // fec0::/10, and multicast ff00::/8.
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xffc0) === 0xfec0) return true;
  if ((first & 0xff00) === 0xff00) return true;

  // Documentation and benchmarking ranges are not valid remote fetch targets.
  if (first === 0x2001 && groups[1] === 0x0db8) return true;
  if (first === 0x2001 && groups[1] === 0x0002 && groups[2] === 0) return true;

  // IPv4-mapped and IPv4-compatible forms (::ffff:a.b.c.d, ::a.b.c.d).
  const mapped = groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff;
  const compatible = groups.slice(0, 6).every((group) => group === 0);
  if ((mapped || compatible) && hasPrivateEmbeddedIPv4(groups, 6)) return true;

  // 6to4 (2002:v4:v4::/48) and well-known NAT64 (64:ff9b::/96).
  if (first === 0x2002 && hasPrivateEmbeddedIPv4(groups, 1)) return true;
  const nat64 = groups[0] === 0x0064 && groups[1] === 0xff9b &&
    groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0;
  if (nat64 && hasPrivateEmbeddedIPv4(groups, 6)) return true;

  // Teredo stores the client IPv4 address inverted in the final 32 bits.
  if (first === 0x2001 && groups[1] === 0) {
    const embedded = ipv4FromGroups(groups, 6).map((part) => 255 - part);
    if (isPrivateIPv4(embedded.join("."))) return true;
  }

  return false;
}

/** Return true when a host literal or resolved address is not a safe target. */
export function isForbiddenAddress(host: string): boolean {
  const lower = host.toLowerCase();
  if (FORBIDDEN_HOSTS.has(lower)) return true;

  const bare = stripIpv6Brackets(lower);
  if (FORBIDDEN_HOSTS.has(bare)) return true;
  return isPrivateIPv4(bare) || isPrivateIPv6(bare);
}

function isIpLiteral(hostname: string): boolean {
  const bare = stripIpv6Brackets(hostname);
  return parseIPv4(bare) !== null || parseIPv6(bare) !== null;
}

async function resolveAndValidateHost(hostname: string, field: string): Promise<void> {
  if (isIpLiteral(hostname)) return;

  // Deno's fetch performs its own DNS lookup, so this check cannot completely
  // eliminate a DNS-rebinding race. It does reject ordinary hostnames whose
  // currently advertised A/AAAA records point at protected address space.

  const addresses: string[] = [];
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      addresses.push(...await Deno.resolveDns(hostname, recordType));
    } catch {
      // A host may legitimately have only one address family. Continue with
      // the other family, but reject below if neither family resolves.
    }
  }

  if (addresses.length === 0) {
    throw new Error(`${field} could not be resolved`);
  }
  if (addresses.some((address) => isForbiddenAddress(address))) {
    throw new Error(`${field} resolves to a disallowed address`);
  }
}

/** Validate an HTTPS URL before making a server-side request. */
export async function assertSafeRemoteUrl(raw: string, field: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${field} is not a valid URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${field} must use https`);
  }
  if (url.username || url.password) {
    throw new Error(`${field} must not contain credentials`);
  }
  if (isForbiddenAddress(url.hostname)) {
    throw new Error(`${field} host is not allowed`);
  }

  await resolveAndValidateHost(stripIpv6Brackets(url.hostname), field);
  return url;
}

/** Fetch a URL, re-validating it and every redirect target. */
export async function safeFetch(url: URL, maxRedirects = 5): Promise<Response> {
  let current = await assertSafeRemoteUrl(url.toString(), "request URL");
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current, { redirect: "manual" });
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) return response;
      const next = new URL(location, current);
      current = await assertSafeRemoteUrl(next.toString(), "redirect target");
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}
