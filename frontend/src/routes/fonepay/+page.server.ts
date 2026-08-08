import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { backendGet } from "$lib/backend";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user || !locals.authHeader) {
    throw redirect(303, "/login?redirectTo=/fonepay");
  }

  if (!locals.user.isAdmin) {
    throw redirect(303, "/dashboard");
  }

  let configured = false;
  try {
    const settings = await backendGet("/api/v1/settings", locals.authHeader);
    configured = settings?.fonepayConfigured === true;
  } catch {
    // The dashboard can still render and show the setup state if settings load fails.
  }

  return { configured };
};
