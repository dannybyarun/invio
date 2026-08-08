import * as OTPAuth from "otpauth";
import { getJwtSecret } from "./env.ts";

const SETUP_TTL_SECONDS = 10 * 60;
const TOTP_WINDOW = 1;
const RECOVERY_CODE_COUNT = 8;

type PendingSetup = {
  secretBase32: string;
  expiresAt: number;
};

const pendingSetups = new Map<string, PendingSetup>();

function cleanupPendingSetups(now = Date.now()): void {
  for (const [key, value] of pendingSetups.entries()) {
    if (value.expiresAt <= now) pendingSetups.delete(key);
  }
}

function normalizeTotpToken(token: string): string {
  return token.replace(/\s+/g, "");
}

function isSixDigitToken(token: string): boolean {
  return /^\d{6}$/.test(token);
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const secret = getJwtSecret().trim();
  const material = await sha256Bytes(`invio-2fa-encryption:${secret}`);
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(material),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function getRecoveryHashPepper(): Promise<string> {
  const secret = getJwtSecret().trim();
  const bytes = await sha256Bytes(`invio-2fa-recovery:${secret}`);
  return toBase64Url(bytes);
}

function createTotp(secretBase32: string, username: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "Invio",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function createPendingTwoFactorSetup(
  userId: string,
  username: string,
): { otpAuthUrl: string; expiresIn: number } {
  cleanupPendingSetups();

  const secret = new OTPAuth.Secret({ size: 20 });
  const secretBase32 = secret.base32;
  const totp = createTotp(secretBase32, username);

  pendingSetups.set(userId, {
    secretBase32,
    expiresAt: Date.now() + SETUP_TTL_SECONDS * 1000,
  });

  return {
    otpAuthUrl: totp.toString(),
    expiresIn: SETUP_TTL_SECONDS,
  };
}

export function verifyPendingTwoFactorSetup(
  userId: string,
  username: string,
  token: string,
): { ok: true; secretBase32: string } | { ok: false; reason: string } {
  cleanupPendingSetups();
  const pending = pendingSetups.get(userId);
  if (!pending) {
    return { ok: false, reason: "No pending 2FA setup. Start setup again." };
  }

  const normalizedToken = normalizeTotpToken(token);
  if (!isSixDigitToken(normalizedToken)) {
    return { ok: false, reason: "Invalid 2FA token format" };
  }

  const totp = createTotp(pending.secretBase32, username);
  const delta = totp.validate({ token: normalizedToken, window: TOTP_WINDOW });
  if (delta === null) {
    return { ok: false, reason: "Invalid 2FA token" };
  }

  pendingSetups.delete(userId);
  return { ok: true, secretBase32: pending.secretBase32 };
}

export function verifyTotpToken(
  secretBase32: string,
  username: string,
  token: string,
): boolean {
  const normalizedToken = normalizeTotpToken(token);
  if (!isSixDigitToken(normalizedToken)) return false;
  const totp = createTotp(secretBase32, username);
  return totp.validate({ token: normalizedToken, window: TOTP_WINDOW }) !==
    null;
}

export async function encryptTwoFactorSecret(
  secretBase32: string,
): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(secretBase32);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    plain,
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function encryptFonepaySecret(
  secret: string,
): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    plain,
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptFonepaySecret(
  encryptedValue: string,
): Promise<string | null> {
  try {
    const [ivB64, dataB64] = encryptedValue.split(".");
    if (!ivB64 || !dataB64) return null;
    const iv = fromBase64Url(ivB64);
    const data = fromBase64Url(dataB64);
    const key = await getEncryptionKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function decryptTwoFactorSecret(
  encryptedValue: string,
): Promise<string | null> {
  try {
    const [ivB64, dataB64] = encryptedValue.split(".");
    if (!ivB64 || !dataB64) return null;
    const iv = fromBase64Url(ivB64);
    const data = fromBase64Url(dataB64);
    const key = await getEncryptionKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

function randomRecoveryChunk(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    codes.push(`${randomRecoveryChunk(4)}-${randomRecoveryChunk(4)}`);
  }
  return codes;
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const pepper = await getRecoveryHashPepper();
  const normalized = normalizeRecoveryCode(code);
  const digest = await sha256Bytes(`${pepper}:${normalized}`);
  return toBase64Url(digest);
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const code of codes) {
    out.push(await hashRecoveryCode(code));
  }
  return out;
}
