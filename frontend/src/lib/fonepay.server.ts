import { BACKEND_URL } from "$lib/backend";

const FONEPAY_API = "https://fonepay.nepdigitalaccess.workers.dev/api";
const REQUEST_TIMEOUT_MS = 20_000;

type FonepaySession = {
  accessToken: string;
  merchantId?: string | number;
  terminalId?: string | number;
  name?: string;
  userName?: string;
};

export class FonepayUpstreamError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "FonepayUpstreamError";
    this.status = status;
  }
}

async function getSession(authHeader: string): Promise<FonepaySession> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/fonepay/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: "{}",
      signal: controller.signal,
    });
    const textBody = await response.text();
    let session: any = null;
    try {
      session = textBody ? JSON.parse(textBody) : null;
    } catch {
      // Never pass an upstream HTML error page through to the UI.
    }

    if (!response.ok || !session?.accessToken) {
      throw new FonepayUpstreamError(
        session?.error || "Fonepay credentials or gateway connection failed",
        response.status === 409 ? 409 : 502,
      );
    }
    return session as FonepaySession;
  } catch (error) {
    if (error instanceof FonepayUpstreamError) throw error;
    throw new FonepayUpstreamError(
      "Invio could not connect to the Fonepay gateway",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyRequest(
  path: string,
  session: FonepaySession,
  body: Record<string, unknown>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${FONEPAY_API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token: session.accessToken }),
      signal: controller.signal,
    });
    const textBody = await response.text();
    let result: any = null;
    try {
      result = textBody ? JSON.parse(textBody) : null;
    } catch {
      // Cloudflare and other gateways may return HTML/plain text instead of JSON.
    }

    if (response.status === 403) {
      throw new FonepayUpstreamError(
        "Fonepay gateway is blocking requests from the Invio server (403)",
        502,
      );
    }
    if (response.status >= 500) {
      throw new FonepayUpstreamError(
        "Fonepay gateway is temporarily unavailable (502)",
        502,
      );
    }
    if (!response.ok || result?.isSuccess === false) {
      throw new FonepayUpstreamError("Fonepay request was rejected", 502);
    }
    if (!result || typeof result !== "object") {
      throw new FonepayUpstreamError(
        "Fonepay gateway returned an invalid response",
        502,
      );
    }
    return result;
  } catch (error) {
    if (error instanceof FonepayUpstreamError) throw error;
    throw new FonepayUpstreamError(
      "Fonepay gateway is unreachable from the Invio server",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFonepayReports(authHeader: string, dates: string[]) {
  const session = await getSession(authHeader);
  const results: Array<{ date: string; transactions: unknown[] }> = [];
  for (const date of dates) {
    const result = await proxyRequest("report", session, { date });
    if (!Array.isArray(result.searchedDataList)) {
      throw new FonepayUpstreamError("Fonepay returned an invalid report", 502);
    }
    results.push({ date, transactions: result.searchedDataList });
  }
  return results;
}

export async function generateFonepayQr(
  authHeader: string,
  input: { amount: number; billId: string; qrType?: string },
) {
  const session = await getSession(authHeader);
  const terminalId = Number(session.terminalId || 0);
  if (!terminalId) {
    throw new FonepayUpstreamError("Fonepay terminal is not configured", 409);
  }

  const result = await proxyRequest("qr", session, {
    selectTerminal: terminalId,
    terminalId,
    amount: input.amount,
    billId: input.billId,
    qrType: input.qrType || "FONEPAY",
  });

  const qrMessage = result?.qrMessage || result?.body?.qrMessage;
  if (!qrMessage || typeof qrMessage !== "string") {
    throw new FonepayUpstreamError("Fonepay did not return a QR code", 502);
  }

  return {
    qrMessage,
    merchantName: session.name || session.userName || "Fonepay",
    terminalId,
  };
}
