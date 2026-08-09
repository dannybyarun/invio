import { redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "recurring_invoices", "read")) {
    throw redirect(303, "/dashboard");
  }
  try {
    const recurring = await backendGet("/api/v1/recurring", locals.authHeader);
    return { recurring: recurring || [] };
  } catch (err: any) {
    return { error: err.message, recurring: [] };
  }
};
