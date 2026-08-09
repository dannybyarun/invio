import { redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "purchase_orders", "read")) {
    throw redirect(303, "/dashboard");
  }
  try {
    const [purchaseOrders, settings] = await Promise.all([
      backendGet("/api/v1/purchase-orders", locals.authHeader),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    return { purchaseOrders: purchaseOrders || [], settings: settings || {} };
  } catch (err: any) {
    return { error: err.message, purchaseOrders: [], settings: {} };
  }
};
