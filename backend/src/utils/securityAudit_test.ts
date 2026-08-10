import { closeDatabase, initDatabase } from "../database/init.ts";
import { getSecurityEvents, recordSecurityEvent } from "./securityAudit.ts";

Deno.test("records security events without storing secrets in metadata", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "invio-audit-test-" });
  const previousPath = Deno.env.get("DATABASE_PATH");
  const previousUser = Deno.env.get("ADMIN_USER");
  const previousPass = Deno.env.get("ADMIN_PASS");
  const previousJwt = Deno.env.get("JWT_SECRET");
  const dbPath = `${dir}/audit.db`;
  try {
    Deno.env.set("DATABASE_PATH", dbPath);
    Deno.env.set("ADMIN_USER", "audit-admin");
    Deno.env.set("ADMIN_PASS", "audit-password");
    Deno.env.set("JWT_SECRET", "audit-test-secret-long-enough");
    await initDatabase();

    recordSecurityEvent("test.event", {
      userId: undefined,
      username: "admin",
      ipAddress: "127.0.0.1",
      metadata: {
        action: "test",
        secret: "not-a-password",
        nested: { token: "nested-secret" },
        ordinarySecretValue: "should-not-be-stored",
        list: ["array-secret"],
      },
    });
    const events = getSecurityEvents(10);
    const event = events.find((item) => item.eventType === "test.event");
    if (!event) throw new Error("Expected the security event to be recorded");
    if (event.metadata?.action !== "test") {
      throw new Error("Metadata was not parsed");
    }
    if (event.metadata?.secret !== "[REDACTED]") {
      throw new Error("Sensitive metadata was not redacted");
    }
    if (
      (event.metadata?.nested as Record<string, unknown>)?.token !==
        "[REDACTED]"
    ) {
      throw new Error("Nested sensitive metadata was not redacted");
    }
    if (event.metadata?.ordinarySecretValue !== "[REDACTED]") {
      throw new Error("Unknown metadata was not redacted");
    }
    if ((event.metadata?.list as unknown[])[0] !== "[REDACTED]") {
      throw new Error("Array metadata was not redacted");
    }

    const raw = (await import("../database/init.ts")).getDatabase().query(
      "SELECT metadata FROM security_events WHERE id = ?",
      [event.id],
    ) as unknown[][];
    const rawMetadata = String(raw[0]?.[0] || "");
    if (
      rawMetadata.includes("not-a-password") ||
      rawMetadata.includes("nested-secret") ||
      rawMetadata.includes("should-not-be-stored") ||
      rawMetadata.includes("array-secret")
    ) {
      throw new Error("Raw security metadata contains a secret");
    }
    if (event.ipAddress !== "127.0.0.1") {
      throw new Error("IP address was not recorded");
    }
  } finally {
    try {
      closeDatabase();
    } catch {
      // ignore
    }
    if (previousPath === undefined) Deno.env.delete("DATABASE_PATH");
    else Deno.env.set("DATABASE_PATH", previousPath);
    if (previousUser === undefined) Deno.env.delete("ADMIN_USER");
    else Deno.env.set("ADMIN_USER", previousUser);
    if (previousPass === undefined) Deno.env.delete("ADMIN_PASS");
    else Deno.env.set("ADMIN_PASS", previousPass);
    if (previousJwt === undefined) Deno.env.delete("JWT_SECRET");
    else Deno.env.set("JWT_SECRET", previousJwt);
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  }
});
