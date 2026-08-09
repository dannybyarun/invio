import { redirect } from "@sveltejs/kit";
import { backendGet } from "$lib/backend";

export const load = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  if (!locals.user.isAdmin) {
    throw redirect(303, "/dashboard");
  }

  try {
    const users = await backendGet("/api/v1/users", locals.authHeader);
    const normalizedUsers = Array.isArray(users)
      ? users.map((u: any) => ({
          ...u,
          displayName: u?.displayName ?? u?.display_name ?? u?.name ?? "",
          username: u?.username ?? u?.userName ?? u?.user_name ?? "",
          email: u?.email ?? "",
        }))
      : [];
    return {
      users: normalizedUsers,
    };
  } catch (err: any) {
    console.error("Failed to load users:", err);
    return {
      error: err.message,
      users: [],
    };
  }
};
