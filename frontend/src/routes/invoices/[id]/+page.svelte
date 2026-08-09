<script lang="ts">
  import { getContext } from "svelte";
  import {
    FileText,
    Edit,
    Copy,
    ExternalLink,
    Download,
    ArrowLeft,
    MoreHorizontal,
    FileCode2,
    ShieldOff,
    Send,
    Ban,
    Trash2,
    CheckCircle,
    Upload,
    Check,
    Pencil,
    ChevronDown,
    Mail,
    QrCode,
  } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import type { SubmitFunction } from "@sveltejs/kit";

  import { hasPermission } from "$lib/types";
  import { formatPostalCityLine } from "$lib/address";
  import { formatDateWithBs, numberFormatLocale } from "$lib/utils/dates";

  let { data, form } = $props();
  let paymentRecoveryNotice = $derived(page.url.searchParams.get("payment") === "qr-failed");
  let t = getContext("i18n") as (key: string) => string;
  const getLoc = getContext("localization") as () => any;

  let invoice = $derived(data.invoice);
  let showPublishedBanner = $derived(data.showPublishedBanner);
  let user = $derived(data.user);

  let isOverdue = $derived.by(() => {
    if (!invoice) return false;
    if (invoice.status === "paid" || invoice.status === "voided") return false;
    const due = invoice.dueDate ? new Date(invoice.dueDate as string) : null;
    if (!due) return false;
    const today = new Date();
    const dueDateObj = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const todayObj = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return dueDateObj.valueOf() < todayObj.valueOf();
  });

  let canUpdate = $derived(hasPermission(user, "invoices", "update"));
  let canDelete = $derived(hasPermission(user, "invoices", "delete"));
  let canPublish = $derived(hasPermission(user, "invoices", "publish"));
  let canVoid = $derived(hasPermission(user, "invoices", "void"));
  let allowProtectedInvoiceChanges = $derived(Boolean(data.allowProtectedInvoiceChanges));
  let isRetentionProtectedInvoice = $derived(invoice?.status === "sent" || invoice?.status === "paid" || invoice?.status === "complete" || invoice?.status === "overdue");
  let canEditInvoice = $derived(canUpdate && Boolean(invoice && (invoice.status === "draft" || (allowProtectedInvoiceChanges && invoice.status !== "voided"))));
  let canDeleteInvoice = $derived(canDelete && Boolean(invoice && (invoice.status === "draft" || invoice.status === "voided" || (allowProtectedInvoiceChanges && invoice.status !== "voided"))));

  let paidPaymentMethod = $state("");
  let verifyingPayment = $state(false);
  let generatingQr = $state(false);
  let paymentVerificationMessage = $state("");
  let qrImage = $derived(invoice?.fonepayQrType === "dynamic" ? invoice?.fonepayQrData : invoice?.fonepayQrType === "static" ? String(data.settings?.fonepayStaticQr || "/fonepay-static-qr.png") : "");
  let canRetryQr = $derived(
    Boolean(invoice && invoice.paymentMethod === "Fonepay" && invoice.fonepayQrType === "dynamic" && !invoice.fonepayQrData && invoice.status !== "paid" && invoice.status !== "complete" && canUpdate),
  );
  let emailSending = $state(false);
  let emailDialog: HTMLDialogElement;

  let emailEnabled = $derived(Boolean(data.emailEnabled));
  let canExport = $derived(hasPermission(user, "invoices", "export"));

  // ---- Partial payments / reminders / credit notes ----
  let paymentForm = $state({ amount: "", method: "Cash", reference: "", paidAt: new Date().toISOString().slice(0, 10) });
  let paymentSaving = $state(false);
  let paymentMessage = $state("");
  let remindSending = $state(false);
  let remindMessage = $state("");

  let amountPaid = $derived(Number(invoice?.amountPaid) || 0);
  let amountDue = $derived(Number(invoice?.amountDue) ?? Number(invoice?.total || 0));
  let paidPct = $derived(invoice?.total ? Math.min(100, Math.round((amountPaid / Number(invoice.total)) * 100)) : 0);
  let canRecordPayment = $derived(canUpdate && Boolean(invoice && invoice.status !== "draft" && invoice.status !== "voided" && amountDue > 0));
  let canCreateCreditNote = $derived(hasPermission(user, "credit_notes", "create"));

  async function recordPayment() {
    paymentSaving = true;
    paymentMessage = "";
    const amount = parseFloat(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      paymentMessage = t("Amount must be greater than zero");
      paymentSaving = false;
      return;
    }
    if (amount > amountDue) {
      paymentMessage = t("Amount exceeds the outstanding balance");
      paymentSaving = false;
      return;
    }
    try {
      const res = await fetch(`/api/v1/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          method: paymentForm.method || undefined,
          reference: paymentForm.reference || undefined,
          paidAt: paymentForm.paidAt || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("Unable to record payment"));
      paymentForm.amount = "";
      paymentMessage = t("Payment recorded");
      location.reload();
    } catch (e: any) {
      paymentMessage = e.message || String(e);
    } finally {
      paymentSaving = false;
    }
  }

  async function deletePayment(paymentId: string) {
    if (!confirm(t("Delete this payment?"))) return;
    try {
      const res = await fetch(`/api/v1/invoices/${invoice.id}/payments/${paymentId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed");
      location.reload();
    } catch (e: any) {
      paymentMessage = e.message || String(e);
    }
  }

  async function sendReminder() {
    remindSending = true;
    remindMessage = "";
    try {
      const res = await fetch(`/api/v1/invoices/${invoice.id}/remind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("Unable to send reminder"));
      remindMessage = body.emailed ? t("Reminder email sent") : body.reason || t("Reminder not sent");
    } catch (e: any) {
      remindMessage = e.message || String(e);
    } finally {
      remindSending = false;
    }
  }

  let defaultEmailSubject = $derived(invoice ? `Invoice #${invoice.invoiceNumber || invoice.id}` : "Invoice");
  let defaultEmailTo = $derived(invoice?.customer?.email ?? "");

  $effect(() => {
    if ((form as any)?.emailSent) {
      emailDialog?.close();
    }
  });

  // Poll only while this invoice is an unpaid Fonepay invoice. The backend
  // performs the authenticated report lookup and idempotent status transition;
  // this interval only provides a convenient automatic check in the UI.
  $effect(() => {
    if (!invoice || invoice.paymentMethod !== "Fonepay" || invoice.status === "paid" || invoice.status === "complete") {
      return;
    }
    const timer = setInterval(() => {
      if (!document.hidden && !verifyingPayment) void verifyPaymentNow();
    }, 30_000);
    return () => clearInterval(timer);
  });

  async function generateInvoiceQr() {
    if (!canRetryQr) return;
    generatingQr = true;
    paymentVerificationMessage = "";
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/fonepay-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.qrMessage !== "string") throw new Error(body.error || t("Unable to generate Fonepay QR"));
      const image = await import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(body.qrMessage, { width: 320, margin: 2 }));
      const saveResponse = await fetch(`/api/v1/invoices/${invoice.id}/fonepay-qr-image`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, qrMessage: body.qrMessage }),
      });
      if (!saveResponse.ok) throw new Error(t("Unable to save the exact Fonepay QR"));
      // Drop the recovery query after a successful retry so the warning does
      // not reappear on the refreshed invoice page.
      window.location.replace(window.location.pathname);
    } catch (err) {
      paymentVerificationMessage = err instanceof Error ? err.message : String(err);
    } finally {
      generatingQr = false;
    }
  }

  async function verifyPaymentNow() {
    if (!invoice || invoice.paymentMethod !== "Fonepay") return;
    verifyingPayment = true;
    paymentVerificationMessage = "";
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("Unable to verify Fonepay payment"));
      paymentVerificationMessage = body.verified ? t("Fonepay payment verified") : String(body.reason || t("No matching Fonepay payment found yet"));
      if (body.verified) window.location.reload();
    } catch (err) {
      paymentVerificationMessage = err instanceof Error ? err.message : String(err);
    } finally {
      verifyingPayment = false;
    }
  }

  function openEmailModal() {
    emailDialog?.showModal();
  }

  function fmtDate(d?: string | Date) {
    return formatDateWithBs(d, getLoc()?.locale, getLoc()?.dateFormat);
  }

  function fmtMoney(v?: number) {
    const currency = String(invoice?.currency || data.settings?.currency || "USD")
      .trim()
      .toUpperCase();
    try {
      return new Intl.NumberFormat(numberFormatLocale(getLoc()?.locale, getLoc()?.numberFormat), {
        style: "currency",
        currency,
      }).format(Number(v || 0));
    } catch {
      return `${Number(v || 0).toFixed(2)} ${currency}`;
    }
  }

  function fmtDateTime(d: Date) {
    if (!d || Number.isNaN(d.getTime())) return "";
    const date = fmtDate(d);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${date} ${h}:${m}`;
  }

  function copyLink() {
    navigator.clipboard.writeText(`${page.url.origin}/public/invoices/${invoice.shareToken}`);
    alert(t("Link copied!"));
  }

  function confirmAction(message: string | (() => string)): SubmitFunction {
    return ({ cancel }) => {
      const text = typeof message === "function" ? message() : message;
      if (!confirm(text)) cancel();
    };
  }

  function confirmEditNavigation(event: MouseEvent) {
    if (!allowProtectedInvoiceChanges || !isRetentionProtectedInvoice) return;
    if (!confirm(t("You are about to edit a sent/paid invoice. Ensure this is legally allowed in your jurisdiction. Continue?"))) {
      event.preventDefault();
    }
  }
</script>

<!-- Send via Email dialog -->
<dialog bind:this={emailDialog} class="modal">
  <div class="modal-box max-w-lg">
    <form method="dialog">
      <button class="btn btn-sm btn-circle btn-ghost absolute top-3 right-3">✕</button>
    </form>
    <h3 class="mb-4 text-lg font-semibold">{t("Send via Email")}</h3>

    {#if (form as any)?.emailError}
      <div class="alert alert-error mb-4 text-sm">
        <span>{(form as any).emailError}</span>
      </div>
    {/if}

    <form
      method="post"
      use:enhance={() => {
        emailSending = true;
        return async ({ result, update }) => {
          await update({ reset: false });
          emailSending = false;
          if (result.type === "success") emailDialog?.close();
        };
      }}
    >
      <input type="hidden" name="intent" value="send-email" />

      <div class="form-control mb-3">
        <label class="label pb-1" for="emailTo">
          <span class="label-text font-medium">{t("To")}</span>
          <span class="label-text-alt opacity-60">{t("Separate multiple with commas")}</span>
        </label>
        <input
          id="emailTo"
          type="text"
          name="emailTo"
          class="input input-bordered w-full"
          value={defaultEmailTo}
          placeholder="customer@example.com, other@example.com"
          disabled={emailSending}
          required
        />
      </div>

      <div class="form-control mb-3">
        <label class="label pb-1" for="emailSubject">
          <span class="label-text font-medium">{t("Subject")}</span>
        </label>
        <input id="emailSubject" type="text" name="emailSubject" class="input input-bordered w-full" value={defaultEmailSubject} disabled={emailSending} required />
      </div>

      <div class="form-control mb-4">
        <label class="label pb-1" for="emailMessage">
          <span class="label-text font-medium">{t("Message")}</span>
          <span class="label-text-alt opacity-60">{t("Optional")}</span>
        </label>
        <textarea id="emailMessage" name="emailMessage" class="textarea textarea-bordered w-full" rows="4" placeholder={t("Add a personal note...")} disabled={emailSending}></textarea>
      </div>

      <div class="text-base-content/60 mb-4 flex items-center gap-2 text-sm">
        <FileText size={14} />
        <span>{t("The invoice PDF will be attached automatically.")}</span>
      </div>

      <div class="modal-action mt-0">
        <button type="button" class="btn btn-ghost" disabled={emailSending} onclick={() => emailDialog?.close()}>{t("Cancel")}</button>
        <button type="submit" class="btn btn-primary" disabled={emailSending}>
          {#if emailSending}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            <Mail size={16} />
          {/if}
          {t("Send")}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<div class="mb-6">
  {#if paymentRecoveryNotice && invoice?.paymentMethod === "Fonepay" && invoice.status !== "paid" && invoice.status !== "complete"}
    <div class="alert alert-warning mb-4 text-sm shadow sm:text-base">
      <QrCode size={18} />
      <div class="flex-1">
        <div class="font-medium">{t("Invoice saved; Fonepay payment is still pending")}</div>
        <div class="opacity-80">{t("You can retry the QR or use another payment method without recreating the invoice.")}</div>
      </div>
      {#if canRetryQr}
        <button type="button" class="btn btn-sm" onclick={() => generateInvoiceQr()} disabled={generatingQr}>
          {#if generatingQr}<span class="loading loading-spinner loading-xs"></span>{/if}{t("Retry QR")}
        </button>
      {/if}
    </div>
  {/if}

  {#if form?.error}
    <div class="alert alert-error mb-4 text-sm shadow sm:text-base">
      <div class="flex-1 overflow-hidden">
        <div class="font-medium">{form.error}</div>
      </div>
    </div>
  {/if}

  {#if (form as any)?.emailSent}
    <div class="alert alert-success mb-4 text-sm shadow sm:text-base">
      <CheckCircle size={18} />
      <div class="flex-1">
        <div class="font-medium">{t("Invoice sent successfully")}</div>
        <div class="opacity-80">{t("Sent to")} {(form as any).emailRecipients?.join(", ")}</div>
      </div>
    </div>
  {/if}

  {#if showPublishedBanner && invoice?.shareToken}
    <div class="alert alert-success mb-4 text-sm shadow sm:text-base">
      <CheckCircle size={20} />
      <div class="flex-1 overflow-hidden">
        <div class="font-medium">{t("Invoice published")}</div>
        <div class="truncate text-sm break-all opacity-80">
          {t("Public link")}:
          <a class="link" href="/public/invoices/{invoice.shareToken}" target="_blank">
            {page.url.origin}/public/invoices/{invoice.shareToken}
          </a>
        </div>
      </div>
      <div class="flex shrink-0 gap-2">
        <a class="btn btn-xs sm:btn-sm btn-ghost" target="_blank" href="/public/invoices/{invoice.shareToken}">
          {t("Open")}
        </a>
        <button type="button" class="btn btn-xs sm:btn-sm" onclick={copyLink}>
          {t("Copy link")}
        </button>
        <a class="btn btn-xs sm:btn-sm btn-primary" href="/api/v1/invoices/{invoice.id}/pdf" target="_blank">
          {t("Download PDF")}
        </a>
      </div>
    </div>
  {/if}

  <div class="border-base-200 flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
    <div class="flex items-center gap-3">
      <a href="/invoices" class="btn btn-ghost btn-circle btn-sm">
        <ArrowLeft size={20} />
      </a>
      <h1 class="flex items-center gap-2 text-2xl font-semibold">
        {t("Invoice #")}
        {invoice?.invoiceNumber || invoice?.id}
      </h1>
      {#if invoice?.status}
        <span
          class="badge {invoice.status === 'paid'
            ? 'badge-success'
            : invoice.status === 'complete'
              ? 'badge-secondary'
              : invoice.status === 'voided'
                ? 'badge-warning'
                : isOverdue && invoice?.status !== 'paid' && invoice?.status !== 'complete'
                  ? 'badge-error'
                  : invoice.status === 'sent'
                    ? 'badge-info'
                    : ''}"
        >
          {invoice.status === "voided"
            ? t("Voided")
            : invoice.status === "complete"
              ? t("Complete")
              : isOverdue && invoice?.status !== "paid" && invoice?.status !== "complete"
                ? t("Overdue")
                : t(invoice?.status === "draft" ? "Draft" : invoice?.status === "sent" ? "Sent" : invoice?.status === "paid" ? "Paid" : "Overdue")}
        </span>
      {/if}
    </div>

    <!-- Hidden forms for dropdown actions -->
    <form id="inv-duplicate" method="post" class="hidden" use:enhance>
      <input type="hidden" name="intent" value="duplicate" />
    </form>
    <form id="inv-unpublish" method="post" class="hidden" use:enhance>
      <input type="hidden" name="intent" value="unpublish" />
    </form>
    <form id="inv-mark-sent" method="post" class="hidden" use:enhance>
      <input type="hidden" name="intent" value="mark-sent" />
    </form>
    <form id="inv-mark-complete" method="post" class="hidden" use:enhance>
      <input type="hidden" name="intent" value="mark-complete" />
    </form>
    <form id="inv-void" method="post" class="hidden" use:enhance={confirmAction(t("Void this invoice?"))}>
      <input type="hidden" name="intent" value="void" />
    </form>
    <form
      id="inv-delete"
      method="post"
      class="hidden"
      use:enhance={confirmAction(() =>
        isRetentionProtectedInvoice
          ? t("You are about to delete a sent/paid invoice. This may violate invoice retention laws and cannot be undone. Continue?")
          : t("Delete this invoice? This cannot be undone."),
      )}
    >
      <input type="hidden" name="intent" value="delete" />
    </form>

    {#if invoice}
      <div class="flex flex-wrap items-center gap-2">
        {#if canEditInvoice}
          <a href="/invoices/{invoice.id}/edit" class="btn btn-sm" onclick={confirmEditNavigation}>
            <Pencil size={16} />
            <span class="hidden sm:inline">{t("Edit")}</span>
          </a>
        {/if}

        {#if invoice.status === "draft" && canPublish}
          <form method="post" use:enhance>
            <input type="hidden" name="intent" value="publish" />
            <button type="submit" class="btn btn-sm btn-success" title={t("Make public and mark as sent")}>
              <Upload size={16} />
              <span class="hidden sm:inline">{t("Publish")}</span>
            </button>
          </form>
        {/if}

        {#if invoice.status === "paid" && canUpdate}
          <form method="post" use:enhance>
            <input type="hidden" name="intent" value="mark-complete" />
            <button type="submit" class="btn btn-sm btn-secondary" title={t("Mark as Complete")}>
              <CheckCircle size={16} />
              <span class="hidden sm:inline">{t("Mark as Complete")}</span>
            </button>
          </form>
        {/if}

        {#if (invoice.status === "sent" || invoice.status === "overdue") && canUpdate}
          <div class="join">
            <form method="post" use:enhance>
              <input type="hidden" name="intent" value="mark-paid" />
              <button type="submit" class="btn btn-sm btn-primary join-item" title={t("Mark as Paid")}>
                <Check size={16} />
                <span class="hidden sm:inline">{t("Mark as Paid")}</span>
              </button>
            </form>
            <div class="dropdown dropdown-end">
              <button type="button" class="btn btn-sm btn-primary join-item border-l-primary-content/20 border-l px-2">
                <ChevronDown size={14} />
              </button>
              <div class="dropdown-content bg-base-100 rounded-box border-base-200 z-10 mt-1 w-60 space-y-2 border p-3 shadow">
                <p class="text-sm font-medium opacity-70">{t("Payment Method")}</p>
                <form method="post" use:enhance>
                  <input type="hidden" name="intent" value="mark-paid" />
                  <input
                    class="input input-bordered input-sm w-full"
                    type="text"
                    name="paymentMethod"
                    bind:value={paidPaymentMethod}
                    placeholder={t("e.g. Bank Transfer, PayPal")}
                    autocomplete="off"
                  />
                  <div class="flex flex-wrap gap-1 pt-2">
                    {#each ["Bank Transfer", "PayPal", "Cash", "Credit Card", "Stripe"] as method (method)}
                      <button type="button" class="badge badge-outline hover:badge-primary cursor-pointer text-xs" onclick={() => (paidPaymentMethod = method)}>
                        {method}
                      </button>
                    {/each}
                  </div>
                  <button type="submit" class="btn btn-primary btn-sm btn-block mt-2">{t("Mark as Paid")}</button>
                </form>
              </div>
            </div>
          </div>
        {/if}

        {#if emailEnabled && canExport && invoice.status !== "voided"}
          <button type="button" class="btn btn-sm" onclick={openEmailModal}>
            <Mail size={16} />
            <span class="hidden sm:inline">{t("Send via Email")}</span>
          </button>
        {/if}

        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm">
            <MoreHorizontal size={16} />
            <span class="hidden sm:inline">{t("More")}</span>
          </div>
          <ul tabindex="-1" class="menu menu-sm dropdown-content bg-base-100 rounded-box border-base-200 z-1 mt-2 w-56 border p-2 shadow">
            <li>
              <button type="submit" form="inv-duplicate" class="flex items-center gap-2 py-2">
                <Copy size={16} />
                {t("Duplicate")}
              </button>
            </li>
            <li>
              <a href="/api/v1/invoices/{invoice.id}/xml" target="_blank" title={t("Download XML")} class="flex items-center gap-2 py-2">
                <FileText size={16} />
                {t("Download XML")}
              </a>
            </li>
            <div class="divider my-0 py-0"></div>
            {#if (invoice.status === "sent" || invoice.status === "overdue") && canPublish}
              <li>
                <button type="submit" form="inv-unpublish" class="flex items-center gap-2 py-2">
                  <ShieldOff size={16} />
                  {t("Unpublish")}
                </button>
              </li>
            {/if}
            {#if invoice.status === "paid" && canUpdate}
              <li>
                <button type="submit" form="inv-mark-complete" class="flex items-center gap-2 py-2">
                  <CheckCircle size={16} />
                  {t("Mark as Complete")}
                </button>
              </li>
            {/if}
            {#if invoice.status === "draft" && canUpdate}
              <li>
                <button type="submit" form="inv-mark-sent" class="flex items-center gap-2 py-2">
                  <Send size={16} />
                  {t("Mark as Sent")}
                </button>
              </li>
            {/if}
            {#if (invoice.status === "sent" || invoice.status === "overdue") && canVoid}
              <li>
                <button type="submit" form="inv-void" class="text-warning flex items-center gap-2 py-2">
                  <Ban size={16} />
                  {t("Void Invoice")}
                </button>
              </li>
            {/if}
            {#if canDeleteInvoice}
              <li>
                <button type="submit" form="inv-delete" class="text-error flex items-center gap-2 py-2">
                  <Trash2 size={16} />
                  {t("Delete")}
                </button>
              </li>
            {/if}
          </ul>
        </div>
      </div>
    {/if}
  </div>
</div>

{#if invoice}
  <div class="mt-6 mb-8 grid grid-cols-1 gap-x-8 gap-y-4 text-sm md:grid-cols-2">
    <div class="space-y-4">
      <div>
        <span class="mr-1 opacity-70">{t("Customer")}:</span>
        {invoice.customer?.name || t("Unknown Customer")}
      </div>
      <div class="flex gap-1">
        <span class="mr-1 opacity-70">{t("Address")}:</span>
        <div class="whitespace-pre-line">
          {#if invoice.customer?.address || invoice.customer?.city}
            {[invoice.customer?.address, formatPostalCityLine(invoice.customer?.city, invoice.customer?.postalCode, invoice.customer?.countryCode, getLoc()?.postalCityFormat)]
              .filter(Boolean)
              .join("\n")}
            {#if invoice.customer?.countryCode}
              <br />{invoice.customer.countryCode}
            {/if}
          {/if}
        </div>
      </div>
      <div>
        <span class="mr-1 opacity-70">{t("Issue Date")}:</span>
        {fmtDate(invoice.issueDate) || "-"}
      </div>
      <div class="mt-4">
        <span class="mr-1 opacity-70">{t("Subtotal")}:</span>
        {fmtMoney(invoice.subtotal)}
      </div>

      <div class="flex flex-wrap gap-1 text-xs opacity-60">
        {t("Tax rate")}: {invoice.taxRate}% -
        {t("Prices include tax")}: {invoice.pricesIncludeTax ? t("Yes") : t("No")} -
        {t("Rounding")}: {t("Round per line")} -
        {t("Tax mode")}: {invoice.taxes?.length ? t("Per line") : t("Invoice total")}
      </div>

      <div class="mt-4">
        <span class="mr-1 opacity-70">{t("Total")}:</span>
        <span class="font-bold">{fmtMoney(invoice.total)}</span>
      </div>
      {#if invoice.status !== "draft" && invoice.status !== "voided"}
        <div class="rounded-box border-base-300 mt-4 space-y-2 border p-4">
          <div class="flex items-center justify-between text-sm">
            <span class="opacity-70">{t("Paid")}:</span>
            <span class="text-success font-medium">{fmtMoney(amountPaid)}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="opacity-70">{t("Due")}:</span>
            <span class="font-semibold {amountDue > 0 ? 'text-error' : 'text-success'}">{fmtMoney(amountDue)}</span>
          </div>
          <progress class="progress progress-success w-full" value={paidPct} max="100"></progress>

          {#if (invoice.payments || []).length > 0}
            <div class="space-y-1">
              {#each invoice.payments as pmt (pmt.id)}
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="opacity-75">
                    {pmt.source === "manual" ? pmt.method || t("Payment") : pmt.provider || "Fonepay"} · {pmt.source === "manual"
                      ? String(pmt.paidAt).slice(0, 10)
                      : String(pmt.verifiedAt).slice(0, 10)}
                    {#if pmt.source === "manual" && pmt.reference}<span class="opacity-60">· {pmt.reference}</span>{/if}
                  </span>
                  <span class="flex items-center gap-2">
                    <span class="font-medium">{fmtMoney(pmt.amount)}</span>
                    {#if pmt.source === "manual" && canUpdate}
                      <button class="btn btn-ghost btn-xs btn-square" onclick={() => deletePayment(pmt.id)} title={t("Delete payment")}>×</button>
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          {/if}

          {#if canRecordPayment}
            <div class="border-base-300 space-y-2 border-t pt-3">
              <div class="text-xs font-semibold">{t("Record payment")}</div>
              <div class="flex flex-wrap items-center gap-2">
                <input type="number" min="0" step="0.01" class="input input-sm input-bordered w-28" placeholder={t("Amount")} bind:value={paymentForm.amount} />
                <select class="select select-sm select-bordered" bind:value={paymentForm.method}>
                  <option>Cash</option>
                  <option>Bank Transfer</option>
                  <option>Card</option>
                  <option>Fonepay</option>
                </select>
                <input type="date" class="input input-sm input-bordered" bind:value={paymentForm.paidAt} />
                <input class="input input-sm input-bordered w-36" placeholder={t("Reference")} bind:value={paymentForm.reference} />
                <button class="btn btn-sm btn-primary" onclick={recordPayment} disabled={paymentSaving}>
                  {#if paymentSaving}<span class="loading loading-spinner loading-xs"></span>{/if}{t("Add Payment")}
                </button>
              </div>
              {#if paymentMessage}<p class="text-xs opacity-80">{paymentMessage}</p>{/if}
            </div>
          {/if}

          <div class="border-base-300 flex flex-wrap gap-2 border-t pt-3">
            {#if invoice.status === "sent" || invoice.status === "overdue"}
              <button class="btn btn-sm btn-outline" onclick={sendReminder} disabled={remindSending}>
                {#if remindSending}<span class="loading loading-spinner loading-xs"></span>{/if}<Mail size={14} />
                {t("Send Reminder")}
              </button>
            {/if}
            {#if canCreateCreditNote}
              <a href={`/credit-notes/new?invoice=${invoice.id}`} class="btn btn-sm btn-outline">{t("Issue Credit Note")}</a>
            {/if}
          </div>
          {#if remindMessage}<p class="text-xs opacity-80">{remindMessage}</p>{/if}
        </div>
      {/if}
      <div>
        <span class="mr-1 opacity-70">{t("Payment Terms")}:</span>
        <span class="font-medium">{invoice.paymentTerms || "-"}</span>
      </div>
      {#if invoice.paymentMethod === "Fonepay"}
        <div class="rounded-box border-primary/30 bg-primary/5 border p-4">
          <div class="flex items-center gap-2 font-semibold"><QrCode size={18} /> Fonepay</div>
          {#if qrImage}<img src={qrImage} alt={t("Fonepay payment QR code")} class="mt-3 h-48 w-48 rounded-lg bg-white p-2" />{/if}
          <p class="mt-2 text-xs opacity-70">{invoice.fonepayQrType === "dynamic" ? t("Dynamic QR for this invoice total") : t("Static merchant QR")}</p>
          {#if canRetryQr}
            <button type="button" class="btn btn-sm btn-outline mt-3" disabled={generatingQr} onclick={generateInvoiceQr}>
              {#if generatingQr}<span class="loading loading-spinner loading-xs"></span>{/if}{t("Generate payment QR")}
            </button>
          {/if}
          {#if invoice.status !== "paid" && invoice.status !== "complete" && canUpdate}
            <button type="button" class="btn btn-sm btn-primary mt-3" disabled={verifyingPayment} onclick={verifyPaymentNow}>
              {#if verifyingPayment}<span class="loading loading-spinner loading-xs"></span>{/if}{t("Check Fonepay payment")}
            </button>
            {#if paymentVerificationMessage}<p class="mt-2 text-xs opacity-80">{paymentVerificationMessage}</p>{/if}
          {/if}
          {#if invoice.fonepayVerifiedAt}<p class="text-success mt-2 text-xs">{t("Verified")}: {fmtDateTime(new Date(invoice.fonepayVerifiedAt))}</p>{/if}
          {#if invoice.paymentTransactions?.[0]}
            <div class="mt-2 space-y-1 text-xs opacity-75">
              <p>{t("Transaction")}: {invoice.paymentTransactions[0].providerTransactionId}</p>
              {#if invoice.paymentTransactions[0].providerReference}<p>{t("Reference")}: {invoice.paymentTransactions[0].providerReference}</p>{/if}
              <p>{t("Verified amount")}: {fmtMoney(invoice.paymentTransactions[0].amount)}</p>
            </div>
          {/if}
        </div>
      {/if}

      <div class="pt-2 opacity-70">
        {invoice.items?.length || 0}
        {t("item(s)")}
      </div>

      <div class="flex flex-wrap gap-2 pt-4">
        <a class="btn btn-sm btn-outline" href="/api/v1/invoices/{invoice.id}/html" target="_blank">
          <FileCode2 size={16} />
          {t("View HTML")}
        </a>
        <a class="btn btn-sm btn-primary" href="/api/v1/invoices/{invoice.id}/pdf" target="_blank">
          <Download size={16} />
          {t("Download PDF")}
        </a>
        {#if invoice.status && invoice.status !== "draft" && invoice.shareToken}
          <a class="btn btn-sm btn-outline" href="/public/invoices/{invoice.shareToken}" target="_blank">
            <ExternalLink size={16} />
            {t("View public link")}
          </a>
        {/if}
      </div>
    </div>

    <div class="space-y-4">
      <div>
        <span class="mr-1 opacity-70">{t("Email")}:</span>
        {invoice.customer?.email || ""}
      </div>
      <div class="mt-4">
        <span class="mr-1 opacity-70">{t("Due Date")}:</span>
        {fmtDate(invoice.dueDate) || "-"}
      </div>
      <div>
        <span class="mr-1 opacity-70">{t("Tax")}:</span>
        {fmtMoney(invoice.taxAmount)}
      </div>
      <div>
        <span class="mr-1 opacity-70">{t("Discount")}:</span>
        {fmtMoney(invoice.discountAmount)}
      </div>
    </div>
  </div>

  {#if invoice.items && invoice.items.length > 0}
    <div class="mt-8">
      <div class="bg-base-100 rounded-box border-base-200 overflow-hidden border shadow-sm">
        <table class="table-sm sm:table-md table w-full">
          <thead class="bg-base-200/50">
            <tr>
              <th>{t("Description")}</th>
              <th class="text-right">{t("Qty")}</th>
              <th class="text-right">{t("Price")}</th>
              <th class="text-right">{t("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {#each invoice.items as item (item.id)}
              <tr>
                <td class="whitespace-pre-wrap">{item.description || t("Item")}</td>
                <td class="text-right">{item.quantity}</td>
                <td class="text-right">{fmtMoney(item.unitPrice)}</td>
                <td class="text-right font-medium">{fmtMoney(item.quantity * item.unitPrice)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if invoice.statusHistory && invoice.statusHistory.length > 0}
    <div class="mt-8">
      <h2 class="mb-3 text-base font-semibold opacity-70">{t("Status History")}</h2>
      <ul class="border-base-300 space-y-4 border-l-2 pl-4">
        {#each invoice.statusHistory as entry (entry.id)}
          <li class="relative">
            <span class="bg-base-300 border-base-100 absolute top-1 -left-[1.3rem] h-3 w-3 rounded-full border-2"></span>
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="badge badge-sm {entry.status === 'paid'
                  ? 'badge-success'
                  : entry.status === 'voided'
                    ? 'badge-warning'
                    : entry.status === 'complete'
                      ? 'badge-secondary'
                      : entry.status === 'sent'
                        ? 'badge-info'
                        : 'badge-ghost'}"
              >
                {t(entry.status.charAt(0).toUpperCase() + entry.status.slice(1))}
              </span>
              <span class="text-sm opacity-60">{fmtDateTime(new Date(entry.changedAt))}</span>
              {#if entry.paymentMethod}
                <span class="text-sm opacity-80">· {entry.paymentMethod}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/if}
