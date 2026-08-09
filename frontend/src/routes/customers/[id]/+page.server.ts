import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendDelete } from "$lib/backend";
import type { PageServerLoad, Actions } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  const hasPerm =
    locals.user.isAdmin ||
    locals.user.permissions?.some(
      (p: any) => p.resource === "customers" && p.action === "read",
    );
  if (!hasPerm) {
    throw redirect(303, "/customers");
  }

  try {
    const [customer, statement] = await Promise.all([
      backendGet(`/api/v1/customers/${params.id}`, locals.authHeader),
      backendGet(
        `/api/v1/customers/${params.id}/statement`,
        locals.authHeader,
      ).catch(() => null),
    ]);
    return { customer, statement };
  } catch (err: any) {
    return {
      error: err.message,
    };
  }
};

export const actions: Actions = {
  delete: async ({ locals, params }) => {
    if (!locals.user) throw redirect(303, "/login");
    try {
      await backendDelete(`/api/v1/customers/${params.id}`, locals.authHeader);
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e && "location" in e)
        throw e;
      // It's likely blocked by existing invoices
      return fail(400, {
        error:
          e.message ||
          "Cannot delete this customer. There may be invoices associated with them.",
      });
    }
    throw redirect(303, "/customers");
  },
};
