import { redirect, fail } from "@sveltejs/kit";
import { backendDelete, backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "quotes", "read")) {
    throw redirect(303, "/quotes");
  }
  try {
    const quote = await backendGet(
      `/api/v1/quotes/${params.id}`,
      locals.authHeader,
    );
    return { quote };
  } catch (err: any) {
    return { error: err.message, quote: null };
  }
};

export const actions = {
  convert: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      const result = await backendPost(
        `/api/v1/quotes/${params.id}/convert`,
        locals.authHeader,
        {},
      );
      if (result?.invoiceId)
        throw redirect(303, `/invoices/${result.invoiceId}`);
      return fail(500, { error: "Conversion failed" });
    } catch (e: any) {
      if (e && typeof e === "object" && "location" in e) throw e;
      return fail(400, { error: e.message || String(e) });
    }
  },
  status: async ({ request, locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const status = String(form.get("status") || "");
    try {
      await backendPost(
        `/api/v1/quotes/${params.id}/status`,
        locals.authHeader,
        { status },
      );
      return { success: true };
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
  },
  delete: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      await backendDelete(`/api/v1/quotes/${params.id}`, locals.authHeader);
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
    throw redirect(303, "/quotes");
  },
};
