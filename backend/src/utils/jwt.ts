import { create, decode, verify } from "djwt";
import { getJwtSecret } from "./env.ts";

/** Shape of our JWT payload */
export interface JWTPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  iat?: number;
  exp?: number;
  jti?: string;
}

function validateSecret(secretKey: string) {
  if (!secretKey || secretKey.trim().length === 0) {
    throw new Error("JWT_SECRET must not be empty");
  }

  const trimmed = secretKey.trim();
  if (trimmed.length < 16) {
    console.warn(
      "Warning: JWT_SECRET is shorter than 16 characters. Consider using a longer secret for better security.",
    );
  }
}

async function getKey(): Promise<CryptoKey> {
  const secretKey = getJwtSecret();
  validateSecret(secretKey);
  const secretBytes = new TextEncoder().encode(secretKey.trim());
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return key;
}

export async function createJWT(payload: Record<string, unknown>) {
  const key = await getKey();
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

/** @deprecated Use createJWT with full payload instead */
export async function generateJWT(adminUser: string) {
  const payload = { user: adminUser };
  const key = await getKey();
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const key = await getKey();
    const payload = await verify(token, key);

    // Handle both new multi-user payload and legacy single-admin payload
    if (payload.userId) {
      return payload as unknown as JWTPayload;
    }

    // Legacy token: extract username from old format
    const username = (payload as Record<string, unknown>).username ||
      (payload as Record<string, unknown>).user;
    if (username) {
      return {
        userId: "__legacy__",
        username: String(username),
        isAdmin: true, // legacy tokens are always admin
        iat: payload.iat as number | undefined,
        exp: payload.exp as number | undefined,
      } as JWTPayload;
    }

    return null;
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}

export async function verifyJWTPayload(
  token: string,
): Promise<Record<string, unknown> | null> {
  try {
    const key = await getKey();
    const payload = await verify(token, key);
    return payload as Record<string, unknown>;
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}

export function decodeJWT(token: string) {
  return decode(token);
}
