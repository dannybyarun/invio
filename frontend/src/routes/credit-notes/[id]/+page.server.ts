import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendPost } from "$lib/backend";
import { hasPermission } from "$lib/types";

export const load = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, "/login");
  if (!hasPermission(locals.user, "credit_notes", "read")) {
    throw redirect(303, "/credit-notes");
  }
  try {
    const [note, settings] = await Promise.all([
      backendGet(`/api/v1/credit-notes/${params.id}`, locals.authHeader),
      backendGet("/api/v1/settings", locals.authHeader).catch(() => ({})),
    ]);
    return { note, settings: settings || {} };
  } catch (err: any) {
    return { error: err.message, note: null, settings: {} };
  }
};

export const actions = {
  void: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      await backendPost(
        `/api/v1/credit-notes/${params.id}/void`,
        locals.authHeader,
        {},
      );
      return { success: true };
    } catch (e: any) {
      return fail(400, { error: e.message || String(e) });
    }
  },
};
