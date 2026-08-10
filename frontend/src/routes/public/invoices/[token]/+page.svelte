<script lang="ts">
  import { getContext } from "svelte";
  import { Download, FileText, ChevronDown, ExternalLink, QrCode, X, Check } from "lucide-svelte";
  import { onDestroy, onMount } from "svelte";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;

  let token = $derived(data.token);
  // refreshTick busts the iframe/document cache so a freshly verified payment
  // (e.g. dynamic Fonepay) immediately shows the paid status in the document.
  let refreshTick = $state(0);
  let htmlUrl = $derived(`/api/v1/public/invoices/${token}/html${refreshTick ? `?t=${refreshTick}` : ""}`);
  let pdfUrl = $derived(`/api/v1/public/invoices/${token}/pdf`);
  let ublUrl = $derived(`/api/v1/public/invoices/${token}/ubl.xml`);
  let xmlUblUrl = $derived(`/api/v1/public/invoices/${token}/xml?profile=ubl21`);
  let xmlFxUrl = $derived(`/api/v1/public/invoices/${token}/xml?profile=facturx22`);

  let invoice = $state<Record<string, unknown> | null>(null);
  let qrDataUrl = $state("");
  let qrDialogOpen = $state(false);
  let generatingQr = $state(false);
  let qrError = $state("");
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  let canRegenerateQr = $derived(Boolean(invoice && invoice.paymentMethod === "Fonepay" && invoice.fonepayQrType === "dynamic" && invoice.status !== "paid" && invoice.status !== "complete"));

  let isPaid = $derived(Boolean(invoice && (invoice.status === "paid" || invoice.status === "complete")));
  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  });

  onMount(async () => {
    const statusIsPaid = (inv: Record<string, unknown> | null) => Boolean(inv && (inv.status === "paid" || inv.status === "complete"));

    const load = async () => {
      try {
        const res = await fetch(`/api/v1/public/invoices/${token}`);
        if (!res.ok) return;
        const next = (await res.json()) as Record<string, unknown>;
        const wasPaid = statusIsPaid(invoice);
        invoice = next;
        if (statusIsPaid(next) && !wasPaid) {
          // Payment just got verified (e.g. dynamic Fonepay) — reload the
          // document and dismiss any open payment-QR dialog.
          refreshTick += 1;
          qrDialogOpen = false;
          qrDataUrl = "";
        }
        if (statusIsPaid(next) && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = undefined;
        }
      } catch {
        /* non-fatal: keep the current state */
      }
    };

    await load();
    // Keep polling until the invoice is paid so a customer watching the public
    // link sees the paid confirmation appear automatically.
    if (!statusIsPaid(invoice)) {
      pollTimer = setInterval(load, 5000);
    }
  });

  async function openPaymentQr() {
    if (!canRegenerateQr) return;
    generatingQr = true;
    qrError = "";
    try {
      const res = await fetch(`/api/v1/public/invoices/${token}/fonepay-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.qrMessage !== "string") {
        throw new Error(body.error || t("Unable to generate Fonepay QR"));
      }
      const image = await import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(body.qrMessage, { width: 320, margin: 2 }));
      qrDataUrl = image;
      qrDialogOpen = true;
    } catch (err) {
      qrError = err instanceof Error ? err.message : String(err);
    } finally {
      generatingQr = false;
    }
  }
</script>

<div class="bg-base-200/40 relative flex min-h-screen flex-1 flex-col pb-10">
  <!-- Minimal Header -->
  <header class="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-6 px-4 py-8 sm:flex-row md:px-8">
    <div class="flex items-center gap-3">
      <span class="text-base-content/80 text-3xl font-light tracking-tight">{t("Invoice")}</span>
      {#if isPaid}
        <span class="badge badge-success gap-1 px-3 py-2.5 font-semibold">
          <Check size={14} strokeWidth={3} />
          {t("Paid")}
        </span>
      {/if}
    </div>

    <div class="bg-base-100 border-base-200/60 flex flex-wrap items-center justify-center gap-2 rounded-full border p-2 shadow-sm sm:gap-3">
      <div class="dropdown dropdown-end">
        <div tabIndex="-1" role="button" class="btn btn-sm btn-ghost text-base-content/80 hover:bg-base-200/50 rounded-full px-4 font-normal">
          <FileText size={16} class="mr-1 opacity-70" />
          <span class="hidden sm:inline">{t("XML Data")}</span>
          <span class="sm:hidden">{t("XML")}</span>
          <ChevronDown size={14} class="ml-1 opacity-70" />
        </div>
        <ul tabIndex="-1" class="menu menu-sm dropdown-content bg-base-100 border-base-200 z-[1] mt-2 w-56 rounded-xl border p-2 shadow-lg">
          <li class="menu-title text-base-content/50 px-4 py-2 text-xs font-semibold tracking-wider uppercase">
            {t("Format")}
          </li>
          <li>
            <a href={ublUrl} class="rounded-lg py-2.5">{t("Standard UBL XML")}</a>
          </li>
          <li>
            <a href={xmlUblUrl} class="rounded-lg py-2.5">{t("UBL 2.1 (PEPPOL)")}</a>
          </li>
          <li>
            <a href={xmlFxUrl} class="rounded-lg py-2.5">{t("FacturX / ZUGFeRD 2.2")}</a>
          </li>
        </ul>
      </div>

      <div class="bg-base-200 h-6 w-px"></div>

      <a class="btn btn-sm btn-ghost btn-circle text-base-content/80 hover:bg-base-200/50 tooltip tooltip-bottom" href={htmlUrl} target="_blank" data-tip={t("Open in new tab")}>
        <ExternalLink size={16} />
      </a>

      <a class="btn btn-sm btn-primary ml-1 rounded-full px-6 font-medium shadow-sm" href={pdfUrl}>
        <Download size={16} class="mr-1" />
        {t("Download PDF")}
      </a>

      {#if canRegenerateQr}
        <button type="button" class="btn btn-sm btn-outline ml-1 rounded-full px-5 font-medium shadow-sm" disabled={generatingQr} onclick={openPaymentQr}>
          {#if generatingQr}<span class="loading loading-spinner loading-xs"></span>{:else}<QrCode size={16} class="mr-1" />{/if}
          {t("Payment QR")}
        </button>
      {/if}
    </div>
  </header>

  <!-- Paid confirmation banner -->
  {#if isPaid}
    <div
      class="border-success/40 bg-success/10 mx-auto mt-2 flex w-full max-w-5xl flex-col items-center gap-1 rounded-2xl border px-6 py-4 text-center sm:flex-row sm:justify-center sm:gap-4 sm:px-8 sm:text-left"
    >
      <div class="bg-success text-success-content flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
        <Check size={22} strokeWidth={3} />
      </div>
      <div>
        <p class="text-success font-semibold">{t("Payment received")}</p>
        {#if invoice?.paymentMethod}<p class="text-sm opacity-75">{t("Payment method")}: {invoice.paymentMethod}</p>{/if}
      </div>
    </div>
  {/if}

  <!-- Document Container -->
  <main class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6 md:px-8">
    <div class="bg-base-100 border-base-200 relative flex w-full flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm" style="min-height: 75vh;">
      <iframe src={htmlUrl} title="Invoice Document" class="absolute inset-0 h-full w-full border-0 bg-white"></iframe>
    </div>
  </main>

  {#if qrDialogOpen}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div class="bg-base-100 w-full max-w-sm rounded-2xl border p-6 shadow-xl">
        <div class="flex items-center justify-between gap-2">
          <h3 class="font-semibold">{t("Payment QR")}</h3>
          <button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label={t("Close")} onclick={() => (qrDialogOpen = false)}>
            <X size={18} />
          </button>
        </div>
        {#if qrDataUrl}
          <div class="mt-4 flex flex-col items-center gap-3">
            <img src={qrDataUrl} alt={t("Fonepay payment QR code")} class="h-64 w-64 rounded-lg bg-white p-2" />
            <p class="text-sm opacity-70">{t("Scan to pay with Fonepay")}</p>
          </div>
        {/if}
        {#if qrError}<p class="text-error mt-3 text-sm">{qrError}</p>{/if}
        <div class="mt-5 flex gap-2">
          <button type="button" class="btn btn-outline btn-sm flex-1" disabled={generatingQr} onclick={openPaymentQr}>
            {#if generatingQr}<span class="loading loading-spinner loading-xs"></span>{/if}{t("Regenerate payment QR")}
          </button>
          <button type="button" class="btn btn-primary btn-sm flex-1" onclick={() => (qrDialogOpen = false)}>{t("Close")}</button>
        </div>
      </div>
    </div>
  {/if}
</div>
