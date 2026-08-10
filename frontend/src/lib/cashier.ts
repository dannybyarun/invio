type Permission = { resource?: string; action?: string };

type UserLike =
  | {
      isAdmin?: boolean;
      permissions?: Permission[];
    }
  | null
  | undefined;

export function shouldStartAtQuickSell(user: UserLike): boolean {
  if (!user || user.isAdmin) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return [
    ["quick_sell", "use"],
    ["invoices", "create"],
    ["products", "read"],
    ["customers", "read"],
    ["tax_definitions", "read"],
  ].every(([resource, action]) =>
    permissions.some(
      (permission) =>
        permission.resource === resource && permission.action === action,
    ),
  );
}

export function postLoginPath(user: UserLike): string {
  return shouldStartAtQuickSell(user) ? "/quick-sell" : "/dashboard";
}
