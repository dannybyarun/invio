import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { fetchFonepayReports, FonepayUpstreamError } from "$lib/fonepay.server";

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user?.isAdmin || !locals.authHeader) {
    return json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const dates = Array.isArray(body?.dates)
      ? body.dates.filter((date: unknown): date is string =>
          typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
        )
      : [];
    if (!dates.length || dates.length > 31) {
      return json({ error: "Select a date range of 1 to 31 days" }, { status: 400 });
    }
    return json({ results: await fetchFonepayReports(locals.authHeader, dates) });
  } catch (error) {
    console.error("Fonepay report request failed", error);
    const message = error instanceof FonepayUpstreamError
      ? error.message
      : "Unable to load Fonepay transactions";
    return json({ error: message }, { status: error instanceof FonepayUpstreamError ? error.status : 502 });
  }
};
