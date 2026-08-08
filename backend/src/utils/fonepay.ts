import { getSetting } from "../controllers/settings.ts";
import { decryptFonepaySecret } from "./twoFactor.ts";

const FONEPAY_API = "https://fonepay.nepdigitalaccess.workers.dev/api";
const REQUEST_TIMEOUT_MS = 20_000;

export type FonepayReportTransaction = Record<string, unknown>;

export class FonepayGatewayError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "FonepayGatewayError";
    this.status = status;
  }
}

type FonepaySession = {
  accessToken: string;
  terminalId?: string | number;
};

let sessionCache: { value: FonepaySession; expiresAt: number } | null = null;
const reportCache = new Map<string, { value: FonepayReportTransaction[]; expiresAt: number }>();
const SESSION_CACHE_MS = 5 * 60 * 1000;
const REPORT_CACHE_MS = 30 * 1000;

async function fetchJson(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${FONEPAY_API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let result: Record<string, unknown> | null = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }

    if (response.status === 403) {
      throw new FonepayGatewayError(
        "Fonepay gateway is blocking requests from the Invio server",
        502,
      );
    }
    if (response.status >= 500) {
      throw new FonepayGatewayError(
        "Fonepay gateway is temporarily unavailable",
        502,
      );
    }
    if (!response.ok || !result || result.isSuccess === false) {
      throw new FonepayGatewayError("Fonepay request was rejected", 502);
    }
    return result;
  } catch (error) {
    if (error instanceof FonepayGatewayError) throw error;
    throw new FonepayGatewayError(
      "Fonepay gateway is unreachable from the Invio server",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function createSession(): Promise<FonepaySession> {
  if (sessionCache && sessionCache.expiresAt > Date.now()) return sessionCache.value;
  const username = String(getSetting("fonepayUsername") || "").trim();
  const encryptedPassword = String(
    getSetting("fonepayPasswordEncrypted") || "",
  ).trim();
  if (!username || !encryptedPassword) {
    throw new FonepayGatewayError("Fonepay credentials are not configured", 409);
  }

  const password = await decryptFonepaySecret(encryptedPassword);
  if (!password) {
    throw new FonepayGatewayError("Stored Fonepay credentials are invalid", 500);
  }

  const result = await fetchJson("login", {
    username,
    password,
    secretKey: "",
    otpCode: "",
    recaptcha: "",
  });
  const accessToken = typeof result.accessToken === "string"
    ? result.accessToken
    : "";
  if (!accessToken) {
    throw new FonepayGatewayError("Fonepay login returned no session", 502);
  }
  const session = {
    accessToken,
    terminalId: result.terminalId as string | number | undefined,
  };
  sessionCache = { value: session, expiresAt: Date.now() + SESSION_CACHE_MS };
  return session;
}

export async function generateFonepayQr(
  amount: number,
  billId: string,
): Promise<{ qrMessage: string; terminalId?: string | number }> {
  if (!Number.isFinite(amount) || amount <= 0 || !billId.trim()) {
    throw new FonepayGatewayError("A positive amount and bill ID are required", 400);
  }
  const session = await createSession();
  const terminalId = Number(session.terminalId || 0);
  if (!terminalId) {
    throw new FonepayGatewayError("Fonepay terminal is not configured", 409);
  }
  const result = await fetchJson("qr", {
    selectTerminal: terminalId,
    terminalId,
    amount,
    billId: billId.trim(),
    qrType: "FONEPAY",
    token: session.accessToken,
  });
  const qrMessage = typeof result.qrMessage === "string"
    ? result.qrMessage
    : typeof (result.body as Record<string, unknown> | undefined)?.qrMessage === "string"
    ? String((result.body as Record<string, unknown>).qrMessage)
    : "";
  if (!qrMessage) throw new FonepayGatewayError("Fonepay did not return a QR code", 502);
  return { qrMessage, terminalId };
}

export async function fetchFonepayReport(
  date: string,
): Promise<FonepayReportTransaction[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new FonepayGatewayError("Invalid Fonepay report date", 400);
  }
  const cached = reportCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const session = await createSession();
  const result = await fetchJson("report", {
    date,
    token: session.accessToken,
  });
  const rows = result.searchedDataList;
  if (!Array.isArray(rows)) {
    throw new FonepayGatewayError("Fonepay returned an invalid report", 502);
  }
  const normalized = rows.filter((row): row is FonepayReportTransaction =>
    !!row && typeof row === "object" && !Array.isArray(row)
  );
  reportCache.set(date, { value: normalized, expiresAt: Date.now() + REPORT_CACHE_MS });
  return normalized;
}

function stringValues(row: FonepayReportTransaction): string[] {
  return Object.entries(row)
    .filter(([key, value]) => {
      const lower = key.toLowerCase();
      return /bill|invoice|reference|retrieval|remark|transactionid|paymentid/.test(lower) &&
        (typeof value === "string" || typeof value === "number");
    })
    .map(([, value]) => String(value).trim())
    .filter(Boolean);
}

function amountFrom(row: FonepayReportTransaction): number | null {
  const preferred = [
    "transactionAmount",
    "amount",
    "txnAmount",
    "paymentAmount",
  ];
  for (const key of preferred) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") {
      const amount = Number(String(value).replace(/,/g, ""));
      if (Number.isFinite(amount)) return amount;
    }
  }
  return null;
}

function isSettled(row: FonepayReportTransaction): boolean {
  const statusKeys = [
    "transactionStatus",
    "paymentStatus",
    "status",
    "responseCode",
    "transactionResponseCode",
  ];
  const values = statusKeys
    .map((key) => row[key])
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => String(value).trim().toLowerCase());
  if (values.length === 0) return true;
  if (values.some((value) => /failed|fail|cancel|reverse|reject|void|declin/.test(value))) {
    return false;
  }
  return values.some((value) =>
    value === "00" || /success|successful|settled|completed|complete|paid|approved/.test(value)
  );
}

export function findMatchingFonepayTransaction(
  rows: FonepayReportTransaction[],
  references: string[],
  expectedAmount: number,
): FonepayReportTransaction | null {
  const wanted = new Set(
    references.map((reference) => String(reference).trim()).filter(Boolean),
  );
  const expectedCents = Math.round(Number(expectedAmount) * 100);
  if (!Number.isFinite(expectedCents) || expectedCents <= 0) return null;

  for (const row of rows) {
    if (!isSettled(row)) continue;
    const amount = amountFrom(row);
    if (amount === null || Math.round(amount * 100) !== expectedCents) continue;
    if (stringValues(row).some((value) => wanted.has(value))) return row;
  }
  return null;
}

export function fonepayTransactionId(row: FonepayReportTransaction): string {
  const keys = [
    "fonepayTransactionId",
    "transactionId",
    "paymentId",
    "retrievalReferenceNumber",
    "referenceNumber",
  ];
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export function fonepayTransactionReference(
  row: FonepayReportTransaction,
): string {
  const keys = [
    "retrievalReferenceNumber",
    "referenceNumber",
    "invoiceNumber",
    "billId",
    "remarks1",
  ];
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export function fonepayTransactionAmount(
  row: FonepayReportTransaction,
): number | null {
  return amountFrom(row);
}
