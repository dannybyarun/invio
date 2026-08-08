import { error, redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");

  const canSell =
    locals.user.isAdmin ||
    (locals.user.permissions?.some(
      (p: any) => p.resource === "invoices" && p.action === "create",
    ) &&
      locals.user.permissions?.some(
        (p: any) => p.resource === "products" && p.action === "read",
      ) &&
      locals.user.permissions?.some(
        (p: any) => p.resource === "customers" && p.action === "read",
      ) &&
      locals.user.permissions?.some(
        (p: any) => p.resource === "tax_definitions" && p.action === "read",
      ));
  if (!canSell) throw redirect(303, "/dashboard");

  const [productsRes, customersRes, settingsRes, taxDefinitionsRes] = await Promise.allSettled([
    backendGet("/api/v1/products", locals.authHeader),
    backendGet("/api/v1/customers", locals.authHeader),
    backendGet("/api/v1/settings", locals.authHeader),
    backendGet("/api/v1/tax-definitions", locals.authHeader),
  ]);

  if (taxDefinitionsRes.status !== "fulfilled") {
    throw error(503, "Quick Sell is temporarily unavailable because tax definitions could not be loaded.");
  }

  return {
    products: productsRes.status === "fulfilled" ? productsRes.value : [],
    customers: customersRes.status === "fulfilled" ? customersRes.value : [],
    settings: settingsRes.status === "fulfilled" ? settingsRes.value : {},
    taxDefinitions: taxDefinitionsRes.value,
  };
};
