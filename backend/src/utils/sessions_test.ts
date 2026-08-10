import { closeDatabase, initDatabase } from "../database/init.ts";
import {
  createSession,
  isSessionActive,
  revokeSession,
  revokeUserSessions,
} from "./sessions.ts";

Deno.test("database-backed sessions can be revoked individually and by user", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "invio-session-test-" });
  const previousPath = Deno.env.get("DATABASE_PATH");
  const previousUser = Deno.env.get("ADMIN_USER");
  const previousPass = Deno.env.get("ADMIN_PASS");
  const previousJwt = Deno.env.get("JWT_SECRET");
  try {
    Deno.env.set("DATABASE_PATH", `${dir}/sessions.db`);
    Deno.env.set("ADMIN_USER", "session-admin");
    Deno.env.set("ADMIN_PASS", "session-password");
    Deno.env.set("JWT_SECRET", "session-test-secret-long-enough");
    await initDatabase();

    const adminRows = (await import("../database/init.ts")).getDatabase().query(
      "SELECT id FROM users WHERE username = ?",
      ["session-admin"],
    ) as unknown[][];
    const userId = String(adminRows[0][0]);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const first = createSession(userId, expiresAt);
    const second = createSession(userId, expiresAt);
    if (!isSessionActive(first, userId) || !isSessionActive(second, userId)) {
      throw new Error("New sessions should be active");
    }
    revokeSession(first);
    if (isSessionActive(first, userId)) {
      throw new Error("Session was not revoked");
    }
    if (!isSessionActive(second, userId)) {
      throw new Error("Unrelated session was revoked");
    }
    revokeUserSessions(userId);
    if (isSessionActive(second, userId)) {
      throw new Error("User sessions were not revoked");
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
