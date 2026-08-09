import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "quotes", "create")) {
    throw redirect(303, "/quotes");
  }
  try {
    const [customers, products, settings] = await Promise.all([
      backendGet("/api/v1/customers", locals.authHeader).catch(() => []),
      backendGet("/api/v1/products", locals.authHeader).catch(() => []),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    return {
      customers: customers || [],
      products: products || [],
      settings: settings || {},
    };
  } catch (err: any) {
    return { error: err.message, customers: [], products: [], settings: {} };
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
    if (!customerId) return fail(400, { error: "Customer is required" });
    if (!Array.isArray(items) || items.length === 0) {
      return fail(400, { error: "Add at least one item" });
    }
    try {
      const created = await backendPost("/api/v1/quotes", locals.authHeader, {
        customerId,
        issueDate: String(
          form.get("issueDate") || new Date().toISOString().slice(0, 10),
        ),
        expiryDate: String(form.get("expiryDate") || "").trim() || undefined,
        currency: String(form.get("currency") || "USD").trim() || "USD",
        discountPercentage:
          parseFloat(String(form.get("discountPercentage") || "0")) || 0,
        taxRate: parseFloat(String(form.get("taxRate") || "0")) || 0,
        paymentTerms:
          String(form.get("paymentTerms") || "").trim() || undefined,
        notes: String(form.get("notes") || "").trim() || undefined,
        items,
      });
      if (created?.id) throw redirect(303, `/quotes/${created.id}`);
      return fail(500, { error: "Failed to create quote" });
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e) throw e;
      return fail(500, { error: e.message || String(e) });
    }
  },
};
