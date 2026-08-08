import type { Handle } from "@sveltejs/kit";
import { resolveLocalization, DEFAULT_LOCALIZATION } from "$lib/i18n/mod";
import { getAuthHeaderFromCookie } from "$lib/auth";
import { backendGet } from "$lib/backend";

export const handle: Handle = async ({ event, resolve }) => {
  const cookieString = event.request.headers.get("cookie");

  // Auth
  const authHeader = cookieString
    ? getAuthHeaderFromCookie(cookieString)
    : null;
  event.locals.authHeader = authHeader || "";
  event.locals.user = null;
  event.locals.localization = DEFAULT_LOCALIZATION;
  if (authHeader) {
    try {
      // Fetch both in parallel just like in deno
      const [settingsResult, userResult] = await Promise.allSettled([
        backendGet("/api/v1/settings", authHeader),
        backendGet("/api/v1/users/me", authHeader),
      ]);

      if (settingsResult.status === "fulfilled") {
        const settings = settingsResult.value;
        event.locals.localization = resolveLocalization(
          settings.locale,
          settings.numberFormat,
          settings.dateFormat,
          settings.postalCityFormat,
        );
      }

      if (userResult.status === "fulfilled") {
        event.locals.user = userResult.value;
      }
    } catch {
      // ignore
    }
  }

  // Response & CSP
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => {
      return html
        .replace("%lang%", event.locals.localization.locale.split("-")[0])
        .replace("%numberFormat%", event.locals.localization.numberFormat)
        .replace("%dateFormat%", event.locals.localization.dateFormat);
    },
  });

  // Shared policy for all normal Invio pages. Fonepay is now a regular
  // SvelteKit route, so it must not receive the old standalone-dashboard CSP.
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; ` +
      `base-uri 'self'; ` +
      `object-src 'none'; ` +
      `frame-ancestors 'self'; ` +
      `script-src 'self' 'unsafe-inline'; ` +
      `script-src-elem 'self' 'unsafe-inline'; ` +
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
      `style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
      `img-src 'self' data: blob: https:; ` +
      `font-src 'self' data: https://fonts.gstatic.com; ` +
      `connect-src 'self' ws: wss:; ` +
      `worker-src 'self' blob:; ` +
      `manifest-src 'self';`,
  );

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
};
