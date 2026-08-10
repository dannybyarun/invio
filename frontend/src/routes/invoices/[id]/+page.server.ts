import {
  backendGet,
  backendPost,
  backendPut,
  backendDelete,
} from "$lib/backend";
import { error, redirect, fail } from "@sveltejs/kit";
import type { PageServerLoad, Actions } from "./$types";
import { env } from "$env/dynamic/private";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.authHeader) {
    throw redirect(303, "/login");
  }

  try {
    const [invoiceRes, settingsRes] = await Promise.allSettled([
      backendGet(`/api/v1/invoices/` + params.id, locals.authHeader),
      backendGet("/api/v1/settings", locals.authHeader),
    ]);
    if (invoiceRes.status !== "fulfilled") {
      throw error(404, "Invoice not found");
    }
    const settings =
      settingsRes.status === "fulfilled"
        ? (settingsRes.value as Record<string, unknown>)
        : {};
    const allowProtectedInvoiceChanges =
      String(settings.allowProtectedInvoiceChanges || "false").toLowerCase() ===
      "true";
    const showPublishedBanner = url.searchParams.get("published") === "1";
    return {
      invoice: invoiceRes.value,
      settings,
      showPublishedBanner,
      allowProtectedInvoiceChanges,
      emailEnabled: Boolean(env.SMTP_HOST && env.EMAIL_FROM_ADDRESS),
    };
  } catch (err: any) {
    throw error(404, "Invoice not found");
  }
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    if (!locals.authHeader) throw redirect(303, "/login");

    const data = await request.formData();
    const intent = String(data.get("intent") || "");
    const id = params.id;

    try {
      if (intent === "delete") {
        await backendDelete(`/api/v1/invoices/${id}`, locals.authHeader);
        throw redirect(303, "/invoices");
      }
      if (intent === "publish") {
        await backendPost(
          `/api/v1/invoices/${id}/publish`,
          locals.authHeader,
          {},
        );
        throw redirect(303, `/invoices/${id}?published=1`);
      }
      if (intent === "mark-sent") {
        await backendPut(`/api/v1/invoices/${id}`, locals.authHeader, {
          status: "sent",
        });
        throw redirect(303, `/invoices/${id}`);
      }
      if (intent === "mark-complete") {
        await backendPut(`/api/v1/invoices/${id}`, locals.authHeader, {
          status: "complete",
        });
        throw redirect(303, `/invoices/${id}`);
      }
      if (intent === "mark-paid") {
        const paymentMethod =
          data.get("paymentMethod")?.toString().trim() || undefined;
        // Only *dynamic* Fonepay QRs require gateway verification before the
        // invoice may be marked paid. Static-merchant-QR Fonepay invoices are
        // settled at the counter and can be marked paid directly.
        let isDynamicFonepay = false;
        try {
          const inv = (await backendGet(
            `/api/v1/invoices/${id}`,
            locals.authHeader,
          )) as { paymentMethod?: string; fonepayQrType?: string } | undefined;
          isDynamicFonepay =
            inv?.paymentMethod === "Fonepay" &&
            inv?.fonepayQrType === "dynamic";
        } catch {
          /* leave false; the backend guard is the source of truth */
        }
        if (isDynamicFonepay) {
          const result = (await backendPost(
            `/api/v1/invoices/${id}/verify-payment`,
            locals.authHeader,
            {},
          )) as { verified?: boolean; reason?: string };
          if (!result?.verified) {
            return fail(400, {
              error:
                result?.reason ||
                "Fonepay payment not verified yet. Check the payment and try again.",
            });
          }
        } else {
          await backendPut(`/api/v1/invoices/${id}`, locals.authHeader, {
            status: "paid",
            ...(paymentMethod ? { paymentMethod } : {}),
          });
        }
        throw redirect(303, `/invoices/${id}`);
      }
      if (intent === "duplicate") {
        const copy = await backendPost(
          `/api/v1/invoices/${id}/duplicate`,
          locals.authHeader,
          {},
        );
        const newId = copy && copy.id ? String(copy.id) : null;
        if (!newId) throw new Error("Failed to duplicate invoice");
        throw redirect(303, `/invoices/${newId}/edit`);
      }
      if (intent === "unpublish") {
        await backendPost(
          `/api/v1/invoices/${id}/unpublish`,
          locals.authHeader,
          {},
        );
        throw redirect(303, `/invoices/${id}`);
      }
      if (intent === "void") {
        await backendPost(`/api/v1/invoices/${id}/void`, locals.authHeader, {});
        throw redirect(303, `/invoices/${id}`);
      }
      if (intent === "send-email") {
        const toRaw = String(data.get("emailTo") ?? "").trim();
        const subject = String(data.get("emailSubject") ?? "").trim();
        const message = String(data.get("emailMessage") ?? "").trim();

        const to = toRaw
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.includes("@"));

        if (to.length === 0) {
          return fail(400, {
            emailError: "Enter at least one valid recipient email address.",
          });
        }
        if (!subject) {
          return fail(400, { emailError: "Subject is required." });
        }

        try {
          await backendPost(
            `/api/v1/invoices/${id}/send-email`,
            locals.authHeader,
            {
              to,
              subject,
              message,
            },
          );
          return { emailSent: true, emailRecipients: to };
        } catch (e) {
          return fail(502, { emailError: `Failed to send: ${String(e)}` });
        }
      }
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && "location" in e) {
        // it's a redirect, rethrow it
        throw e;
      }
      return fail(500, { error: String(e) });
    }
  },
};
