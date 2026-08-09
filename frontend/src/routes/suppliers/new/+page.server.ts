import { redirect, fail } from "@sveltejs/kit";
import { backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "suppliers", "create")) {
    throw redirect(303, "/suppliers");
  }
  return {};
};

export const actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const name = String(form.get("name") || "").trim();
    if (!name) return fail(400, { error: "Supplier name is required" });
    try {
      const created = await backendPost(
        "/api/v1/suppliers",
        locals.authHeader,
        {
          name,
          contactName:
            String(form.get("contactName") || "").trim() || undefined,
          email: String(form.get("email") || "").trim() || undefined,
          phone: String(form.get("phone") || "").trim() || undefined,
          address: String(form.get("address") || "").trim() || undefined,
          taxId: String(form.get("taxId") || "").trim() || undefined,
          notes: String(form.get("notes") || "").trim() || undefined,
        },
      );
      if (created?.id) throw redirect(303, `/suppliers/${created.id}`);
      return fail(500, { error: "Failed to create supplier" });
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e) throw e;
      return fail(500, { error: e.message || String(e) });
    }
  },
};
