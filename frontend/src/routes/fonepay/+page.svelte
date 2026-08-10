<script lang="ts">
  import { onMount } from "svelte";
  import { BarChart3, CheckCircle2, Clock3, CreditCard, Download, QrCode, RefreshCw, Search, WalletCards } from "lucide-svelte";
  import { getContext } from "svelte";
  import QRCode from "qrcode";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();
  const t = getContext("i18n") as (key: string) => string;

  type Transaction = {
    fonepayTransactionId?: string;
    transmissionDateTime?: string;
    transactionAmount?: number | string;
    remarks1?: string;
    issuerName?: string;
    acquirerName?: string;
    initiator?: string;
    retrievalReferenceNumber?: string;
    invoiceNumber?: string;
  };

  let fromDate = $state("");
  let toDate = $state("");
  let amount = $state("");
  let billId = $state("");
  let qrMessage = $state("");
  let qrDataUrl = $state("");
  let qrMerchant = $state("");
  let transactions = $state<Transaction[]>([]);
  let activeTab = $state<"overview" | "qr">("overview");
  let loading = $state(false);
  let qrLoading = $state(false);
  let error = $state("");
  let success = $state("");
  let search = $state("");

  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(new Date());

  onMount(() => {
    const current = today();
    fromDate = current;
    toDate = current;
    loadTransactions();
  });

  function formatMoney(value: unknown) {
    const number = Number(value || 0);
    try {
      return new Intl.NumberFormat(numberFormatLocale("en", "comma"), { style: "currency", currency: "NPR" }).format(number);
    } catch {
      return `NPR ${number.toFixed(2)}`;
    }
  }

  function transactionAmount(transaction: Transaction) {
    return Number(transaction.transactionAmount || 0);
  }

  let filteredTransactions = $derived(
    transactions.filter((transaction) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return [transaction.fonepayTransactionId, transaction.remarks1, transaction.invoiceNumber, transaction.issuerName, transaction.acquirerName].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      );
    }),
  );
  let totalAmount = $derived(transactions.reduce((sum, transaction) => sum + transactionAmount(transaction), 0));

  async function loadTransactions() {
    if (!fromDate || !toDate) return;
    loading = true;
    error = "";
    success = "";
    try {
      const dates: string[] = [];
      const cursor = new Date(`${fromDate}T00:00:00Z`);
      const end = new Date(`${toDate}T00:00:00Z`);
      if (cursor > end) throw new Error(t("The start date must be before the end date"));
      while (cursor <= end && dates.length < 31) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const response = await fetch("/fonepay/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("Unable to load Fonepay transactions"));
      transactions = Array.isArray(body.results) ? body.results.flatMap((entry: { transactions?: Transaction[] }) => entry.transactions || []) : [];
      success = t("Transactions refreshed");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      transactions = [];
    } finally {
      loading = false;
    }
  }

  async function generateQr() {
    qrLoading = true;
    error = "";
    success = "";
    qrMessage = "";
    try {
      const response = await fetch("/fonepay/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), billId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("Unable to generate Fonepay QR"));
      qrMessage = String(body.qrMessage || "");
      qrDataUrl = await QRCode.toDataURL(qrMessage, { width: 320, margin: 2 });
      qrMerchant = String(body.merchantName || "Fonepay");
      success = t("Dynamic QR generated successfully");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      qrLoading = false;
    }
  }

  function downloadQr() {
    if (!qrMessage) return;
    const link = document.createElement("a");
    link.download = `fonepay-${billId || "qr"}.png`;
    link.href = qrDataUrl;
    link.click();
  }
</script>

<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
  <div>
    <div class="text-primary mb-1 flex items-center gap-2 text-sm font-semibold tracking-[0.18em] uppercase"><CreditCard size={16} /> {t("Payments")}</div>
    <h1 class="text-3xl font-bold tracking-tight">{t("Fonepay")}</h1>
    <p class="mt-1 text-sm opacity-70">{t("Generate payment QR codes and track Fonepay transactions inside Invio.")}</p>
  </div>
  {#if data.configured}
    <div class="badge badge-success badge-lg gap-2"><CheckCircle2 size={16} /> {t("Fonepay configured")}</div>
  {:else}
    <a class="badge badge-warning badge-lg gap-2 hover:brightness-95" href="/settings?section=payments"><Clock3 size={16} /> {t("Configure in Payments settings")}</a>
  {/if}
</div>

{#if error}<div class="alert alert-error mb-4"><span>{error}</span></div>{/if}
{#if success}<div class="alert alert-success mb-4"><CheckCircle2 size={18} /><span>{success}</span></div>{/if}

<div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
  <div class="card bg-base-100 border-base-300 border shadow-sm">
    <div class="card-body p-4">
      <div class="flex items-center justify-between"><span class="text-sm opacity-70">{t("Transactions")}</span><BarChart3 size={19} class="text-primary" /></div>
      <div class="text-2xl font-bold">{transactions.length}</div>
    </div>
  </div>
  <div class="card bg-base-100 border-base-300 border shadow-sm">
    <div class="card-body p-4">
      <div class="flex items-center justify-between"><span class="text-sm opacity-70">{t("Total amount")}</span><WalletCards size={19} class="text-success" /></div>
      <div class="text-2xl font-bold">{formatMoney(totalAmount)}</div>
    </div>
  </div>
  <div class="card bg-base-100 border-base-300 border shadow-sm">
    <div class="card-body p-4">
      <div class="flex items-center justify-between"><span class="text-sm opacity-70">{t("Connection")}</span><Clock3 size={19} class="text-info" /></div>
      <div class="text-lg font-semibold">{t("Ready")}</div>
    </div>
  </div>
</div>

<div class="tabs tabs-boxed mb-5 w-fit">
  <button type="button" class:tab-active={activeTab === "overview"} class="tab gap-2" onclick={() => (activeTab = "overview")}><BarChart3 size={16} /> {t("Transactions")}</button>
  <button type="button" class:tab-active={activeTab === "qr"} class="tab gap-2" onclick={() => (activeTab = "qr")}><QrCode size={16} /> {t("Generate QR")}</button>
</div>

{#if activeTab === "qr"}
  <section class="card bg-base-100 border-base-300 max-w-3xl border shadow-sm">
    <div class="card-body gap-5 p-5 sm:p-7">
      <div>
        <h2 class="card-title"><QrCode size={21} /> {t("Dynamic Fonepay QR")}</h2>
        <p class="mt-1 text-sm opacity-70">{t("Create a one-time QR for a bill or quick payment.")}</p>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label class="form-control"
          ><span class="label-text mb-1 font-medium">{t("Amount")}</span><input class="input input-bordered" type="number" min="0.01" step="0.01" bind:value={amount} placeholder="100.00" /></label
        >
        <label class="form-control"><span class="label-text mb-1 font-medium">{t("Bill ID")}</span><input class="input input-bordered" bind:value={billId} placeholder="INV-0001" /></label>
      </div>
      <button type="button" class="btn btn-primary w-fit" disabled={qrLoading || !amount || !billId} onclick={generateQr}
        >{#if qrLoading}<span class="loading loading-spinner loading-sm"></span>{:else}<QrCode size={18} />{/if}{t("Generate dynamic QR")}</button
      >
      {#if qrMessage}
        <div class="rounded-box border-success/30 bg-success/5 border p-5 text-center">
          <p class="font-semibold">{qrMerchant}</p>
          <img src={qrDataUrl} alt={t("Fonepay payment QR code")} class="mx-auto my-4 h-64 w-64 rounded-xl bg-white p-3 shadow-inner" />
          <p class="max-w-xl text-left text-xs break-all opacity-60">{qrMessage}</p>
          <button type="button" class="btn btn-outline btn-sm mt-4 gap-2" onclick={downloadQr}><Download size={16} /> {t("Download payload")}</button>
        </div>
      {/if}
    </div>
  </section>
{:else}
  <section class="card bg-base-100 border-base-300 border shadow-sm">
    <div class="card-body p-4 sm:p-5">
      <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 class="card-title">{t("Transaction records")}</h2>
          <p class="text-sm opacity-70">{t("Review Fonepay settlements by date.")}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="input input-bordered input-sm flex items-center gap-2"><span class="text-xs opacity-60">{t("From")}</span><input type="date" bind:value={fromDate} /></label>
          <label class="input input-bordered input-sm flex items-center gap-2"><span class="text-xs opacity-60">{t("To")}</span><input type="date" bind:value={toDate} /></label>
          <button type="button" class="btn btn-primary btn-sm gap-2" disabled={loading} onclick={loadTransactions}
            >{#if loading}<span class="loading loading-spinner loading-xs"></span>{:else}<RefreshCw size={15} />{/if}{t("Refresh")}</button
          >
        </div>
      </div>
      <label class="input input-bordered mb-4 flex max-w-md items-center gap-2"><Search size={16} class="opacity-60" /><input bind:value={search} placeholder={t("Search transactions")} /></label>
      <div class="overflow-x-auto">
        <table class="table-zebra table">
          <thead><tr><th>{t("Transaction")}</th><th>{t("Date")}</th><th>{t("Reference")}</th><th>{t("Remarks")}</th><th class="text-right">{t("Amount")}</th></tr></thead>
          <tbody>
            {#each filteredTransactions as transaction (transaction.fonepayTransactionId || transaction.retrievalReferenceNumber)}
              <tr
                ><td class="font-mono text-xs">{transaction.fonepayTransactionId || "—"}</td><td>{transaction.transmissionDateTime || "—"}</td><td
                  >{transaction.retrievalReferenceNumber || transaction.invoiceNumber || "—"}</td
                ><td>{transaction.remarks1 || "—"}</td><td class="text-right font-semibold">{formatMoney(transactionAmount(transaction))}</td></tr
              >
            {:else}<tr><td colspan="5" class="py-12 text-center opacity-60">{loading ? t("Loading transactions...") : t("No transactions found for this date range")}</td></tr>{/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>
{/if}
