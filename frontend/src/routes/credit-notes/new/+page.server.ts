import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals, url }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "credit_notes", "create")) {
    throw redirect(303, "/credit-notes");
  }
  const invoiceId = url.searchParams.get("invoice") || "";
  try {
    const [customers, settings] = await Promise.all([
      backendGet("/api/v1/customers", locals.authHeader).catch(() => []),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    let invoice: any = null;
    if (invoiceId) {
      try {
        invoice = await backendGet(
          `/api/v1/invoices/${invoiceId}`,
          locals.authHeader,
        );
      } catch {
        invoice = null;
      }
    }
    return { customers: customers || [], settings: settings || {}, invoice };
  } catch (err: any) {
    return { error: err.message, customers: [], settings: {}, invoice: null };
  }
};

export const actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const customerId = String(form.get("customerId") || "");
    if (!customerId) return fail(400, { error: "Customer is required" });

    // Group repeated lines by description, summing quantities/prices.
    const descriptions = form
      .getAll("description")
      .map((v) => String(v).trim());
    const quantities = form.getAll("quantity").map((v) => Number(v) || 0);
    const unitPrices = form.getAll("unitPrice").map((v) => Number(v) || 0);
    const productIds = form.getAll("productId").map((v) => String(v));

    const grouped = new Map<
      string,
      {
        productId: string;
        description: string;
        quantity: number;
        unitPrice: number;
      }
    >();
    for (let i = 0; i < descriptions.length; i++) {
      const desc = descriptions[i] || `Item ${i + 1}`;
      const key = desc.toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += quantities[i] || 0;
      } else {
        grouped.set(key, {
          productId: productIds[i] || "",
          description: desc,
          quantity: quantities[i] || 0,
          unitPrice: unitPrices[i] || 0,
        });
      }
    }
    const items = [...grouped.values()].filter((it) => it.quantity > 0);
    if (items.length === 0)
      return fail(400, { error: "Add at least one returned item" });

    try {
      const created = await backendPost(
        "/api/v1/credit-notes",
        locals.authHeader,
        {
          invoiceId: String(form.get("invoiceId") || "") || undefined,
          customerId,
          issueDate: String(
            form.get("issueDate") || new Date().toISOString().slice(0, 10),
          ),
          reason: String(form.get("reason") || "").trim() || undefined,
          taxRate: parseFloat(String(form.get("taxRate") || "0")) || 0,
          items,
        },
      );
      if (created?.id) throw redirect(303, `/credit-notes/${created.id}`);
      return fail(500, { error: "Failed to create credit note" });
    } catch (e: any) {
      if (e && typeof e === "object" && "location" in e) throw e;
      return fail(500, { error: e.message || String(e) });
    }
  },
};
