import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "purchase_orders", "create")) {
    throw redirect(303, "/purchase-orders");
  }
  try {
    const [suppliers, products] = await Promise.all([
      backendGet("/api/v1/suppliers", locals.authHeader).catch(() => []),
      backendGet("/api/v1/products", locals.authHeader).catch(() => []),
    ]);
    return { suppliers: suppliers || [], products: products || [] };
  } catch (err: any) {
    return { error: err.message, suppliers: [], products: [] };
  }
};

export const actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    let items: any[] = [];
    try {
      items = JSON.parse(String(form.get("items") || "[]"));
    } catch {
      return fail(400, { error: "Invalid items" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return fail(400, { error: "Add at least one item" });
    }
    try {
      const created = await backendPost(
        "/api/v1/purchase-orders",
        locals.authHeader,
        {
          supplierId: String(form.get("supplierId") || "").trim() || undefined,
          orderDate: String(
            form.get("orderDate") || new Date().toISOString().slice(0, 10),
          ),
          notes: String(form.get("notes") || "").trim() || undefined,
          taxRate: parseFloat(String(form.get("taxRate") || "0")) || 0,
          items,
        },
      );
      if (created?.id) throw redirect(303, `/purchase-orders/${created.id}`);
      return fail(500, { error: "Failed to create purchase order" });
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e) throw e;
      return fail(500, { error: e.message || String(e) });
    }
  },
};
