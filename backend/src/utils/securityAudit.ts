import { getDatabase } from "../database/init.ts";
import { generateUUID } from "./uuid.ts";

export interface SecurityEvent {
  id: string;
  eventType: string;
  userId?: string;
  username?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Record a security-sensitive event without allowing audit failures to break
 * the business operation that triggered them.
 */
const SENSITIVE_METADATA_KEY =
  /(password|secret|token|authorization|cookie|credential|private.?key)/i;
const SAFE_METADATA_KEYS = new Set([
  "action",
  "targetUserId",
  "targetUsername",
  "passwordChanged",
  "activeChanged",
  "permissionsChanged",
  "databasePath",
]);

function sanitizeMetadataValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_METADATA_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object") return sanitizeMetadataValue(item);
      return "[REDACTED]";
    });
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeMetadataValue(childValue, childKey);
    }
    return sanitized;
  }
  if (key && !SAFE_METADATA_KEYS.has(key)) return "[REDACTED]";
  return value;
}

function sanitizeMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return sanitizeMetadataValue(metadata) as Record<string, unknown>;
}

export function recordSecurityEvent(
  eventType: string,
  options: {
    userId?: string;
    username?: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  } = {},
): void {
  try {
    const db = getDatabase();
    db.query(
      `INSERT INTO security_events
       (id, event_type, user_id, username, ip_address, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        generateUUID(),
        eventType,
        options.userId || null,
        options.username || null,
        options.ipAddress || null,
        options.metadata
          ? JSON.stringify(sanitizeMetadata(options.metadata))
          : null,
        new Date().toISOString(),
      ],
    );
  } catch (error) {
    console.warn("Security audit event could not be recorded:", error);
  }
}

export function getSecurityEvents(limit = 200): SecurityEvent[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const db = getDatabase();
  const rows = db.query(
    `SELECT id, event_type, user_id, username, ip_address, metadata, created_at
     FROM security_events ORDER BY created_at DESC LIMIT ?`,
    [safeLimit],
  ) as unknown[][];
  return rows.map((row) => {
    let metadata: Record<string, unknown> | undefined;
    try {
      metadata = row[5] ? JSON.parse(String(row[5])) : undefined;
    } catch {
      metadata = undefined;
    }
    return {
      id: String(row[0]),
      eventType: String(row[1]),
      userId: row[2] ? String(row[2]) : undefined,
      username: row[3] ? String(row[3]) : undefined,
      ipAddress: row[4] ? String(row[4]) : undefined,
      metadata,
      createdAt: String(row[6]),
    };
  });
}
