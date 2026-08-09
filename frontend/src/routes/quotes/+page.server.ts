import { redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "quotes", "read")) {
    throw redirect(303, "/dashboard");
  }
  try {
    const [quotes, settings] = await Promise.all([
      backendGet("/api/v1/quotes", locals.authHeader),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    return { quotes: quotes || [], settings: settings || {} };
  } catch (err: any) {
    return { error: err.message, quotes: [], settings: {} };
  }
};
