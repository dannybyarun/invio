import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { backendGet, SESSION_COOKIE } from "$lib/backend";

export const load: PageServerLoad = async ({ locals, cookies }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  const token = cookies.get(SESSION_COOKIE);
  const auth = token ? `Bearer ${token}` : "";

  const canViewInvoices =
    locals.user.isAdmin ||
    locals.user.permissions?.some(
      (p) => p.resource === "invoices" && p.action === "read",
    );

  try {
    const [invoices, settings, audit, profitLoss, stockValuation] =
      await Promise.all([
        canViewInvoices
          ? (backendGet("/api/v1/invoices", auth) as Promise<any[]>)
          : Promise.resolve([] as any[]),
        backendGet("/api/v1/settings", auth).catch(() => ({})) as Promise<
          Record<string, unknown>
        >,
        canViewInvoices
          ? (backendGet("/api/v1/reports/audit", auth).catch(
              () => [],
            ) as Promise<any[]>)
          : Promise.resolve([] as any[]),
        canViewInvoices
          ? (backendGet("/api/v1/reports/profit-loss", auth).catch(
              () => null,
            ) as Promise<any>)
          : Promise.resolve(null),
        canViewInvoices
          ? (backendGet("/api/v1/reports/stock-valuation", auth).catch(
              () => null,
            ) as Promise<any>)
          : Promise.resolve(null),
      ]);
    return { invoices, settings, audit, profitLoss, stockValuation };
  } catch (err) {
    return {
      error: String(err),
      invoices: [],
      settings: {},
      audit: [],
      profitLoss: null,
      stockValuation: null,
    };
  }
};
