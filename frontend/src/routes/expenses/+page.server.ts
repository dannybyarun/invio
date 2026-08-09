import { redirect, fail } from "@sveltejs/kit";
import { backendDelete, backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "expenses", "read")) {
    throw redirect(303, "/dashboard");
  }
  try {
    const [expenses, suppliers, settings] = await Promise.all([
      backendGet("/api/v1/expenses", locals.authHeader),
      backendGet("/api/v1/suppliers", locals.authHeader).catch(() => []),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    return {
      expenses: expenses || [],
      suppliers: suppliers || [],
      settings: settings || {},
    };
  } catch (err: any) {
    return { error: err.message, expenses: [], suppliers: [], settings: {} };
  }
};

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const amount = parseFloat(String(form.get("amount") || "0"));
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(400, { error: "Amount must be greater than zero" });
    }
    try {
      const created = await backendPost("/api/v1/expenses", locals.authHeader, {
        expenseDate: String(
          form.get("expenseDate") || new Date().toISOString().slice(0, 10),
        ),
        supplierId: String(form.get("supplierId") || "").trim() || undefined,
        category: String(form.get("category") || "").trim() || undefined,
        description: String(form.get("description") || "").trim() || undefined,
        amount,
        taxAmount: parseFloat(String(form.get("taxAmount") || "0")) || 0,
        paymentMethod:
          String(form.get("paymentMethod") || "").trim() || undefined,
        reference: String(form.get("reference") || "").trim() || undefined,
        notes: String(form.get("notes") || "").trim() || undefined,
      });
      return { created: Boolean(created?.id) };
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
  },
  delete: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const id = String(form.get("id") || "");
    try {
      await backendDelete(`/api/v1/expenses/${id}`, locals.authHeader);
      return { deleted: true };
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
  },
};
