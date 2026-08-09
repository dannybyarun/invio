import { redirect, fail } from "@sveltejs/kit";
import { backendGet, backendPut, backendDelete } from "$lib/backend";
import type { PageServerLoad, Actions } from "./$types";

type Permission = { resource: string; action: string };
type User = {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  isActive: boolean;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
};
type ResourceActions = Record<string, string[]>;

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  if (!locals.user.isAdmin) {
    throw redirect(303, "/dashboard");
  }

  try {
    const [user, schema] = await Promise.all([
      backendGet(
        `/api/v1/users/${params.id}`,
        locals.authHeader,
      ) as Promise<User>,
      backendGet(
        "/api/v1/users/permissions-schema",
        locals.authHeader,
      ) as Promise<{
        resourceActions: ResourceActions;
      }>,
    ]);

    const saved = url.searchParams.get("saved") === "1";
    return { userToEdit: user, resourceActions: schema.resourceActions, saved };
  } catch (err: any) {
    if (/404|not found/i.test(err.message)) {
      throw redirect(303, "/users");
    }
    return { error: err.message };
  }
};

export const actions: Actions = {
  save: async ({ request, locals, params }) => {
    if (!locals.user) {
      throw redirect(303, "/login");
    }

    const form = await request.formData();
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const email = String(form.get("email") || "").trim();
    const displayName = String(form.get("displayName") || "").trim();
    const isAdmin = form.get("isAdmin") === "on";
    const isActive = form.get("isActive") === "on";

    // Collect permissions from individual checkboxes (name="perm.{resource}.{action}")
    const permissions: Permission[] = [];
    for (const [key, _val] of form.entries()) {
      if (key.startsWith("perm.")) {
        const rest = key.substring(5);
        const dotIdx = rest.lastIndexOf(".");
        if (dotIdx > 0) {
          permissions.push({
            resource: rest.substring(0, dotIdx),
            action: rest.substring(dotIdx + 1),
          });
        }
      }
    }

    if (!username) {
      return fail(400, { error: "Username is required" });
    }

    const body: Record<string, unknown> = {
      username,
      email: email || undefined,
      displayName: displayName || undefined,
      isAdmin,
      isActive,
      permissions,
    };

    if (password.length > 0) {
      if (password.length < 8) {
        return fail(400, { error: "Password must be at least 8 characters" });
      }
      body.password = password;
    }

    try {
      await backendPut(`/api/v1/users/${params.id}`, locals.authHeader, body);
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e && "location" in e)
        throw e;
      return fail(500, { error: e.message || String(e) });
    }

    throw redirect(303, `/users/${params.id}?saved=1`);
  },

  delete: async ({ locals, params }) => {
    if (!locals.user) {
      throw redirect(303, "/login");
    }

    try {
      await backendDelete(`/api/v1/users/${params.id}`, locals.authHeader);
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e && "location" in e)
        throw e;
      return fail(400, { error: e.message || "Cannot delete this user." });
    }

    throw redirect(303, "/users");
  },
};
