import { redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) throw redirect(303, "/login");
  const allowed =
    locals.user.isAdmin ||
    locals.user.permissions?.some(
      (permission: any) =>
        permission.resource === "products" && permission.action === "read",
    );
  if (!allowed) throw redirect(303, "/dashboard");
  try {
    return {
      products: await backendGet(
        "/api/v1/products?includeInactive=true",
        locals.authHeader,
      ),
      selectedProductId: url.searchParams.get("product") || "",
    };
  } catch (error) {
    return {
      products: [],
      selectedProductId: url.searchParams.get("product") || "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
