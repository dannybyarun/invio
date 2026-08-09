import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "recurring_invoices", "create")) {
    throw redirect(303, "/recurring");
  }
  try {
    const [customers, products] = await Promise.all([
      backendGet("/api/v1/customers", locals.authHeader).catch(() => []),
      backendGet("/api/v1/products", locals.authHeader).catch(() => []),
    ]);
    return { customers: customers || [], products: products || [] };
  } catch (err: any) {
    return { error: err.message, customers: [], products: [] };
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
    const customerId = String(form.get("customerId") || "");
    const name = String(form.get("name") || "").trim();
    if (!name) return fail(400, { error: "Name is required" });
    if (!customerId) return fail(400, { error: "Customer is required" });
    if (items.length === 0)
      return fail(400, { error: "Add at least one item" });

    try {
      const created = await backendPost(
        "/api/v1/recurring",
        locals.authHeader,
        {
          name,
          customerId,
          frequency: String(form.get("frequency") || "monthly"),
          intervalCount:
            parseInt(String(form.get("intervalCount") || "1"), 10) || 1,
          nextRunDate: String(
            form.get("nextRunDate") || new Date().toISOString().slice(0, 10),
          ),
          endDate: String(form.get("endDate") || "").trim() || undefined,
          defaultStatus: String(form.get("defaultStatus") || "draft"),
          items,
        },
      );
      if (created?.id) throw redirect(303, "/recurring");
      return fail(500, { error: "Failed to create recurring invoice" });
    } catch (e: any) {
      if (e && typeof e === "object" && "location" in e) throw e;
      return fail(500, { error: e.message || String(e) });
    }
  },
};
