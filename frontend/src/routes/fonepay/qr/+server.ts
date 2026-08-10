import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { backendPost } from "$lib/backend";

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authHeader || !locals.user) {
    return json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const amount = Number(body?.amount);
    const billId = typeof body?.billId === "string" ? body.billId.trim() : "";
    if (!Number.isFinite(amount) || amount <= 0 || !billId) {
      return json(
        { error: "A positive amount and bill ID are required" },
        { status: 400 },
      );
    }
    return json(
      await backendPost("/api/v1/fonepay/qr", locals.authHeader, {
        amount,
        billId,
      }),
    );
  } catch (error) {
    console.error("Fonepay QR request failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate Fonepay QR",
      },
      { status: 502 },
    );
  }
};
