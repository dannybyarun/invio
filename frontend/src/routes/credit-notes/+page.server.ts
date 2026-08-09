import { redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "credit_notes", "read")) {
    throw redirect(303, "/dashboard");
  }
  try {
    const [creditNotes, settings] = await Promise.all([
      backendGet("/api/v1/credit-notes", locals.authHeader),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    return { creditNotes: creditNotes || [], settings: settings || {} };
  } catch (err: any) {
    return { error: err.message, creditNotes: [], settings: {} };
  }
};
