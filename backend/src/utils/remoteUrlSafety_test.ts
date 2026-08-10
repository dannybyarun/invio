import {
  assertSafeRemoteUrl,
  isForbiddenAddress,
  safeFetch,
} from "./remoteUrlSafety.ts";

Deno.test("blocks private IPv4 ranges and CGNAT", () => {
  const blocked = [
    "0.0.0.0",
    "10.20.30.40",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
  ];
  for (const address of blocked) {
    if (!isForbiddenAddress(address)) {
      throw new Error(`Expected ${address} to be blocked`);
    }
  }
});

Deno.test("blocks IPv6 loopback, ULA, link-local, and mapped loopback", () => {
  const blocked = [
    "[::]",
    "[::1]",
    "[fc00::1]",
    "[fd00::1]",
    "[fe80::1]",
    "[fec0::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f00:1]",
    "[2002:7f00:1::1]",
    "[64:ff9b::7f00:1]",
  ];
  for (const address of blocked) {
    if (!isForbiddenAddress(address)) {
      throw new Error(`Expected ${address} to be blocked`);
    }
  }
});

Deno.test("blocks alternate IPv4 literal spellings after URL normalization", async () => {
  for (
    const raw of [
      "https://2130706433/manifest.yaml",
      "https://0177.0.0.1/manifest.yaml",
      "https://0x7f.0.0.1/manifest.yaml",
    ]
  ) {
    await expectRejected(
      assertSafeRemoteUrl(raw, "manifest URL"),
      "host is not allowed",
    );
  }
});

Deno.test("allows a public IPv4 literal without DNS lookup", async () => {
  const url = await assertSafeRemoteUrl(
    "https://1.1.1.1/manifest.yaml",
    "manifest URL",
  );
  if (url.hostname !== "1.1.1.1") {
    throw new Error(`Unexpected normalized hostname: ${url.hostname}`);
  }
});

Deno.test("revalidates redirect targets before following them", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://[::1]/internal" },
    });
  };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: mockFetch,
  });

  try {
    const publicUrl = new URL("https://1.1.1.1/manifest.yaml");
    await expectRejected(safeFetch(publicUrl), "host is not allowed");
    if (fetchCount !== 1) {
      throw new Error(`Expected one outbound request, got ${fetchCount}`);
    }
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
});

Deno.test("rejects non-HTTPS URLs and embedded credentials", async () => {
  await expectRejected(
    assertSafeRemoteUrl("http://1.1.1.1/manifest.yaml", "manifest URL"),
    "must use https",
  );
  await expectRejected(
    assertSafeRemoteUrl(
      "https://user:pass@1.1.1.1/manifest.yaml",
      "manifest URL",
    ),
    "must not contain credentials",
  );
});

async function expectRejected(
  operation: Promise<unknown>,
  expected: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (String(error).includes(expected)) return;
    throw new Error(
      `Expected error containing ${expected}, got ${String(error)}`,
    );
  }
  throw new Error(`Expected operation to reject with ${expected}`);
}
