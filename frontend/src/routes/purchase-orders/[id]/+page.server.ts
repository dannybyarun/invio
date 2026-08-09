import { redirect, fail } from "@sveltejs/kit";
import { backendDelete, backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "purchase_orders", "read")) {
    throw redirect(303, "/purchase-orders");
  }
  try {
    const [po, settings] = await Promise.all([
      backendGet(`/api/v1/purchase-orders/${params.id}`, locals.authHeader),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    return { po, settings: settings || {} };
  } catch (err: any) {
    return { error: err.message, po: null, settings: {} };
  }
};

export const actions = {
  receive: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      await backendPost(
        `/api/v1/purchase-orders/${params.id}/receive`,
        locals.authHeader,
        {},
      );
      return { success: "received" };
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
  },
  void: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      await backendPost(
        `/api/v1/purchase-orders/${params.id}/void`,
        locals.authHeader,
        {},
      );
      return { success: "voided" };
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
  },
  delete: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      await backendDelete(
        `/api/v1/purchase-orders/${params.id}`,
        locals.authHeader,
      );
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
    throw redirect(303, "/purchase-orders");
  },
};
