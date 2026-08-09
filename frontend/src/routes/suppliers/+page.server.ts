import { redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "suppliers", "read")) {
    throw redirect(303, "/dashboard");
  }
  try {
    const suppliers = await backendGet("/api/v1/suppliers", locals.authHeader);
    return { suppliers: suppliers || [], settings: {} };
  } catch (err: any) {
    return { error: err.message, suppliers: [], settings: {} };
  }
};
