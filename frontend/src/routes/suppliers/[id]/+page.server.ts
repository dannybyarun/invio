import { redirect, fail } from "@sveltejs/kit";
import { backendDelete, backendGet, backendPut } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "suppliers", "read")) {
    throw redirect(303, "/suppliers");
  }
  try {
    const supplier = await backendGet(
      `/api/v1/suppliers/${params.id}`,
      locals.authHeader,
    );
    return { supplier };
  } catch (err: any) {
    return { error: err.message, supplier: null };
  }
};

export const actions = {
  update: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    try {
      await backendPut(`/api/v1/suppliers/${params.id}`, locals.authHeader, {
        name: String(form.get("name") || "").trim(),
        contactName: String(form.get("contactName") || "").trim() || undefined,
        email: String(form.get("email") || "").trim() || undefined,
        phone: String(form.get("phone") || "").trim() || undefined,
        address: String(form.get("address") || "").trim() || undefined,
        taxId: String(form.get("taxId") || "").trim() || undefined,
        notes: String(form.get("notes") || "").trim() || undefined,
      });
      return { saved: true };
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
  },
  delete: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      await backendDelete(`/api/v1/suppliers/${params.id}`, locals.authHeader);
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
    throw redirect(303, "/suppliers");
  },
};
