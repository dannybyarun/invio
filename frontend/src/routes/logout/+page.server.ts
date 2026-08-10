import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { BACKEND_URL, SESSION_COOKIE } from "$lib/backend";
import { getAuthHeaderFromCookie } from "$lib/auth";

export const load: PageServerLoad = async ({ cookies, request }) => {
  const authHeader = getAuthHeaderFromCookie(
    request.headers.get("cookie") || "",
  );
  if (authHeader) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      await fetch(`${BACKEND_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Authorization: authHeader },
        signal: controller.signal,
      });
    } catch {
      // Local cookie removal still guarantees the browser leaves the session.
    } finally {
      clearTimeout(timeout);
    }
  }
  cookies.delete(SESSION_COOKIE, { path: "/" });
  throw redirect(303, "/login");
};
