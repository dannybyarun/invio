import { redirect, fail } from "@sveltejs/kit";
import { backendPost, backendGet } from "$lib/backend";
import type { PageServerLoad, Actions } from "./$types";

type ResourceActions = Record<string, string[]>;

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  if (!locals.user.isAdmin) {
    throw redirect(303, "/dashboard");
  }

  try {
    const schema = (await backendGet(
      "/api/v1/users/permissions-schema",
      locals.authHeader,
    )) as { resourceActions: ResourceActions };
    return { resourceActions: schema.resourceActions };
  } catch (err: any) {
    return { error: err.message };
  }
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(303, "/login");
    }

    const form = await request.formData();
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const email = String(form.get("email") || "").trim();
    const displayName = String(form.get("displayName") || "").trim();
    const isAdmin = form.get("isAdmin") === "on";

    // Collect permissions from individual checkboxes (name="perm.{resource}.{action}")
    const permissions: Array<{ resource: string; action: string }> = [];
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
      return fail(400, {
        error: "Username is required",
        formData: { username, email, displayName },
      });
    }

    if (!password || password.length < 8) {
      return fail(400, {
        error: "Password must be at least 8 characters",
        formData: { username, email, displayName },
      });
    }

    try {
      await backendPost("/api/v1/users", locals.authHeader, {
        username,
        password,
        email: email || undefined,
        displayName: displayName || undefined,
        isAdmin,
        permissions,
      });
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e && "location" in e)
        throw e;
      return fail(500, {
        error: e.message || String(e),
        formData: { username, email, displayName },
      });
    }

    throw redirect(303, "/users");
  },
};
