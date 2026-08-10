import { getDatabase } from "../database/init.ts";
import { generateUUID } from "./uuid.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export function createSession(userId: string, expiresAt: number): string {
  const db = getDatabase();
  const jti = generateUUID();
  db.query(
    `INSERT INTO auth_sessions (jti, user_id, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [jti, userId, nowIso(), new Date(expiresAt * 1000).toISOString()],
  );
  cleanupExpiredSessions();
  return jti;
}

/** Return true only for a known, unexpired, non-revoked session. */
export function isSessionActive(jti: string, userId: string): boolean {
  if (!jti || !userId) return false;
  const db = getDatabase();
  const rows = db.query(
    `SELECT 1 FROM auth_sessions
     WHERE jti = ? AND user_id = ? AND revoked_at IS NULL
       AND expires_at > ?
     LIMIT 1`,
    [jti, userId, nowIso()],
  );
  return rows.length > 0;
}

export function revokeSession(jti: string): boolean {
  if (!jti) return false;
  const db = getDatabase();
  db.query(
    `UPDATE auth_sessions SET revoked_at = ?
     WHERE jti = ? AND revoked_at IS NULL`,
    [nowIso(), jti],
  );
  return true;
}

export function revokeUserSessions(userId: string): void {
  if (!userId) return;
  const db = getDatabase();
  db.query(
    `UPDATE auth_sessions SET revoked_at = ?
     WHERE user_id = ? AND revoked_at IS NULL`,
    [nowIso(), userId],
  );
}

export function cleanupExpiredSessions(): void {
  const db = getDatabase();
  db.query(
    "DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL",
    [
      nowIso(),
    ],
  );
}
