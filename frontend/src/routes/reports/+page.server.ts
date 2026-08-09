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
    const [invoices, settings, audit] = await Promise.all([
      canViewInvoices
        ? (backendGet("/api/v1/invoices", auth) as Promise<any[]>)
        : Promise.resolve([] as any[]),
      backendGet("/api/v1/settings", auth).catch(() => ({})) as Promise<
        Record<string, unknown>
      >,
      canViewInvoices
        ? (backendGet("/api/v1/reports/audit", auth).catch(() => []) as Promise<
            any[]
          >)
        : Promise.resolve([] as any[]),
    ]);
    return { invoices, settings, audit };
  } catch (err) {
    return { error: String(err), invoices: [], settings: {}, audit: [] };
  }
};
