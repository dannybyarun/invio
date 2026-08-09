<script lang="ts">
  import { getContext } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { BarChart3, Boxes, CalendarRange, Download, Printer, ReceiptText, TrendingUp, Wallet } from "lucide-svelte";
  import { formatDateWithBs, numberFormatLocale } from "$lib/utils/dates";
  import { bsMonthName, currentFiscalYear, fiscalYearLabel, fiscalYearMonths, fiscalYearRange, inFiscalYear, nepaliFiscalYear, parseDateValue } from "$lib/utils/fiscal";

  let { data } = $props();
  const t = getContext("i18n") as (key: string, params?: Record<string, string | number>) => string;

  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let dateLocale = $derived(data.localization?.locale || "en");
  let invoices = $derived((data.invoices || []) as any[]);
  let currency = $derived(String((data.settings as any)?.currency || (invoices[0]?.currency as string) || "NPR"));

  function fmtMoney(n: number) {
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, numberFormat), {
        style: "currency",
        currency,
      }).format(n || 0);
    } catch {
      return `${currency} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function fmtDate(d: Date | null): string {
    if (!d) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Group invoices by Nepali fiscal year (newest first).
  let fiscalYearEntries = $derived.by(() => {
    const groups: Record<number, any[]> = {};
    for (const inv of invoices) {
      const fy = nepaliFiscalYear(inv.issueDate);
      if (fy == null) continue;
      if (!groups[fy]) groups[fy] = [];
      groups[fy].push(inv);
    }
    return Object.entries(groups)
      .map(([fy, list]) => [Number(fy), list] as [number, any[]])
      .sort((a, b) => b[0] - a[0]);
  });

  let selectedFy = $state(page.url.searchParams.get("fy") ? Number(page.url.searchParams.get("fy")) : currentFiscalYear());

  // Options for the year selector: every fiscal year with invoices, plus the
  // current fiscal year so an empty/ongoing year is selectable too.
  let fiscalYearOptions = $derived.by(() => {
    const years = fiscalYearEntries.map(([fy]) => fy);
    const current = currentFiscalYear();
    if (!years.includes(current)) years.push(current);
    return years.sort((a, b) => b - a);
  });

  let selectedInvoices = $derived(fiscalYearEntries.find(([fy]) => fy === selectedFy)?.[1] || []);
  let fiscalRange = $derived(fiscalYearRange(selectedFy));

  let summary = $derived.by(() => {
    const list = selectedInvoices;
    const billed = list.reduce((s, i) => s + (Number(i.total) || 0), 0);
    const tax = list.reduce((s, i) => s + (Number(i.taxAmount) || 0), 0);
    const paid = list.filter((i) => i.status === "paid" || i.status === "complete").reduce((s, i) => s + (Number(i.total) || 0), 0);
    const outstanding = list.filter((i) => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + (Number(i.total) || 0), 0);
    const draft = list.filter((i) => i.status === "draft").reduce((s, i) => s + (Number(i.total) || 0), 0);
    return {
      count: list.length,
      billed,
      tax,
      paid,
      outstanding,
      draft,
      voided: list.filter((i) => i.status === "voided").length,
    };
  });

  let months = $derived.by(() =>
    fiscalYearMonths(selectedFy).map((m) => {
      const inMonth = selectedInvoices.filter((i) => {
        const d = parseDateValue(i.issueDate);
        return !!d && d >= m.start && d <= m.end;
      });
      return {
        ...m,
        count: inMonth.length,
        billed: inMonth.reduce((s, i) => s + (Number(i.total) || 0), 0),
        paid: inMonth.filter((i) => i.status === "paid" || i.status === "complete").reduce((s, i) => s + (Number(i.total) || 0), 0),
      };
    }),
  );
  let maxMonthlyBilled = $derived(Math.max(1, ...months.map((m) => m.billed)));
  let yearRows = $derived(
    fiscalYearEntries.map(([fy, list]) => {
      const billed = list.reduce((s, i) => s + (Number(i.total) || 0), 0);
      const paid = list.filter((i) => i.status === "paid" || i.status === "complete").reduce((s, i) => s + (Number(i.total) || 0), 0);
      const outstanding = list.filter((i) => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + (Number(i.total) || 0), 0);
      return { fy, count: list.length, billed, paid, outstanding };
    }),
  );

  // ---- Profit & Loss / Stock valuation ----
  let view = $state<"summary" | "pl" | "stock" | "audit">("summary");
  let pl = $derived(data.profitLoss as any);
  let stockValuation = $derived(data.stockValuation as any);
  let plStart = $state(page.url.searchParams.get("start") || "");
  let plEnd = $state(page.url.searchParams.get("end") || "");
  // Sync the P&L date fields with the selected fiscal year when the user has
  // not picked a custom range yet.
  $effect(() => {
    if (!page.url.searchParams.get("start")) {
      plStart = String(fiscalYearRange(selectedFy)?.start || "");
    }
    if (!page.url.searchParams.get("end")) {
      plEnd = String(fiscalYearRange(selectedFy)?.end || "");
    }
  });

  function applyPlRange() {
    const params = new URLSearchParams();
    if (selectedFy) params.set("fy", String(selectedFy));
    if (plStart) params.set("start", plStart);
    if (plEnd) params.set("end", plEnd);
    goto(`/reports?${params.toString()}`);
  }

  // ---- Audit report ----
  let auditInvoices = $derived(((data.audit || []) as any[]).filter((e: any) => inFiscalYear(e.invoice?.issueDate, selectedFy)));
  let auditSummary = $derived.by(() => {
    let count = 0;
    let billed = 0;
    let paid = 0;
    let outstanding = 0;
    let voided = 0;
    for (const e of auditInvoices) {
      const inv = e.invoice;
      count++;
      billed += Number(inv.total) || 0;
      if (inv.status === "paid" || inv.status === "complete") paid += Number(inv.total) || 0;
      if (inv.status === "sent" || inv.status === "overdue") outstanding += Number(inv.total) || 0;
      if (inv.status === "voided") voided++;
    }
    return { count, billed, paid, outstanding, voided };
  });
  let byCustomer = $derived.by(() => {
    const groups: Record<string, { name: string; count: number; billed: number; paid: number; outstanding: number }> = {};
    for (const e of auditInvoices) {
      const inv = e.invoice;
      const name = e.customerName || t("Walk-in Customer");
      const g = groups[name] || (groups[name] = { name, count: 0, billed: 0, paid: 0, outstanding: 0 });
      g.count++;
      g.billed += Number(inv.total) || 0;
      if (inv.status === "paid" || inv.status === "complete") g.paid += Number(inv.total) || 0;
      if (inv.status === "sent" || inv.status === "overdue") g.outstanding += Number(inv.total) || 0;
    }
    return Object.values(groups).sort((a, b) => b.billed - a.billed);
  });
  let byPaymentMethod = $derived.by(() => {
    const groups: Record<string, { method: string; count: number; billed: number }> = {};
    for (const e of auditInvoices) {
      const inv = e.invoice;
      const method = inv.paymentMethod || t("Not recorded");
      const g = groups[method] || (groups[method] = { method, count: 0, billed: 0 });
      g.count++;
      g.billed += Number(inv.total) || 0;
    }
    return Object.values(groups).sort((a, b) => b.billed - a.billed);
  });
  let changeLog = $derived.by(() => {
    const out: any[] = [];
    for (const e of auditInvoices) {
      for (const h of e.history || []) {
        out.push({ invoice: e.invoice, customer: e.customerName, event: h });
      }
    }
    return out.sort((a, b) => new Date(b.event.changedAt).getTime() - new Date(a.event.changedAt).getTime());
  });
  let payments = $derived.by(() => {
    const out: any[] = [];
    for (const e of auditInvoices) {
      for (const p of e.payments || []) {
        out.push({ invoice: e.invoice, customer: e.customerName, payment: p });
      }
    }
    return out.sort((a, b) => new Date(b.payment.verifiedAt).getTime() - new Date(a.payment.verifiedAt).getTime());
  });

  function exportStockCsv() {
    const items = stockValuation?.items || [];
    const esc = (v: unknown): string => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [
      ["Product", "SKU", "Barcode", "On hand", "Cost", "Value", "Reorder level"],
      ...items.map((i: any) => [i.name, i.sku || "", i.barcode || "", String(i.quantityOnHand), String(i.costPrice), String(i.value), String(i.reorderLevel)]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stock-valuation.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function statusLabel(status: string): string {
    const map: Record<string, string> = {
      draft: t("Draft"),
      sent: t("Sent"),
      paid: t("Paid"),
      complete: t("Complete"),
      overdue: t("Overdue"),
      voided: t("Voided"),
    };
    return map[status] || status;
  }
</script>

<svelte:head>
  <style>
    @media print {
      .navbar,
      .breadcrumbs,
      .no-print {
        display: none !important;
      }
      main.container {
        max-width: 100% !important;
        padding: 0 !important;
      }
      .card,
      .bg-base-100 {
        box-shadow: none !important;
        border: none !important;
      }
    }
  </style>
</svelte:head>

<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
  <div>
    <div class="text-primary mb-1 text-sm font-semibold tracking-[0.18em] uppercase">{t("Reports")}</div>
    <h1 class="text-3xl font-bold tracking-tight">{t("Fiscal Report")}</h1>
    <p class="mt-1 text-sm opacity-70">{t("Nepali fiscal year summaries")}</p>
  </div>
  {#if fiscalYearOptions.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      <select class="select select-bordered select-sm" bind:value={selectedFy} aria-label={t("Fiscal Year")}>
        {#each fiscalYearOptions as fy (fy)}
          <option value={fy}>{fiscalYearLabel(fy)}</option>
        {/each}
      </select>
      <a class="btn btn-outline btn-sm" href={`/invoices?period=fiscal&fy=${selectedFy}`}>
        <ReceiptText size={15} />
        {t("View invoices")}
      </a>
    </div>
  {/if}
</div>

<div class="tabs tabs-boxed mb-4 w-fit flex-wrap">
  <button type="button" class={`tab ${view === "summary" ? "tab-active" : ""}`} onclick={() => (view = "summary")}>{t("Fiscal Summary")}</button>
  <button type="button" class={`tab ${view === "pl" ? "tab-active" : ""}`} onclick={() => (view = "pl")}>{t("Profit & Loss")}</button>
  <button type="button" class={`tab ${view === "stock" ? "tab-active" : ""}`} onclick={() => (view = "stock")}>{t("Stock Valuation")}</button>
  <button type="button" class={`tab ${view === "audit" ? "tab-active" : ""}`} onclick={() => (view = "audit")}>{t("Audit Report")}</button>
</div>

{#if invoices.length === 0 && (view === "summary" || view === "audit")}
  <div class="bg-base-100 border-base-300 rounded-box border py-12 text-center">
    <div class="bg-base-200 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full">
      <BarChart3 size={22} class="opacity-50" />
    </div>
    <div class="text-lg opacity-50">{t("No invoices yet")}</div>
  </div>
{:else if view === "summary"}
  {#if summary.count === 0}
    <div class="alert alert-info mb-4">
      <span>{t("No invoices in this fiscal year")}</span>
    </div>
  {/if}

  <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><ReceiptText size={16} class="text-primary" /><span>{t("Invoices")}</span></div>
        <div class="text-xl font-bold">{summary.count}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><TrendingUp size={16} class="text-primary" /><span>{t("Billed")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(summary.billed)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><Wallet size={16} class="text-primary" /><span>{t("Tax")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(summary.tax)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><Wallet size={16} class="text-success" /><span>{t("Paid")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(summary.paid)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><CalendarRange size={16} class="text-error" /><span>{t("Outstanding")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(summary.outstanding)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><ReceiptText size={16} class="opacity-50" /><span>{t("Draft")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(summary.draft)}</div>
        {#if summary.voided > 0}<div class="text-xs opacity-60">{summary.voided} {t("Voided")}</div>{/if}
      </div>
    </div>
  </div>

  <div class="bg-base-100 border-base-300 rounded-box mb-4 border p-4">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <span class="text-lg font-bold">{fiscalYearLabel(selectedFy)}</span>
      <span class="opacity-70">{t("BS period")}: {bsMonthName(3, dateLocale)} {selectedFy} – {bsMonthName(2, dateLocale)} {selectedFy + 1}</span>
      <span class="opacity-70">{t("AD range")}: {fmtDate(fiscalRange?.start ?? null)} – {fmtDate(fiscalRange?.end ?? null)}</span>
    </div>
  </div>

  <div class="bg-base-100 border-base-300 rounded-box mb-4 overflow-x-auto border">
    <div class="border-base-300 border-b px-4 py-3 text-lg font-semibold">{t("Monthly breakdown")}</div>
    <table class="table w-full whitespace-nowrap">
      <thead class="bg-base-200">
        <tr>
          <th>{t("Month")}</th>
          <th>{t("AD range")}</th>
          <th class="text-right">{t("Invoices")}</th>
          <th class="text-right">{t("Billed")}</th>
          <th class="text-right">{t("Paid")}</th>
          <th class="w-1/4">{t("Share")}</th>
        </tr>
      </thead>
      <tbody>
        {#each months as m (m.fyMonth)}
          <tr class="hover">
            <td class="font-medium">{bsMonthName(m.bsMonth, dateLocale)}</td>
            <td class="text-sm tabular-nums opacity-70">{fmtDate(m.start)} – {fmtDate(m.end)}</td>
            <td class="text-right tabular-nums">{m.count || 0}</td>
            <td class="text-right font-medium tabular-nums">{fmtMoney(m.billed)}</td>
            <td class="text-right tabular-nums opacity-80">{fmtMoney(m.paid)}</td>
            <td>
              <progress class="progress progress-primary h-2 w-full" value={m.billed} max={maxMonthlyBilled} aria-label={t("Share")}></progress>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
    <div class="border-base-300 border-b px-4 py-3 text-lg font-semibold">{t("Fiscal Years")}</div>
    <table class="table w-full whitespace-nowrap">
      <thead class="bg-base-200">
        <tr>
          <th>{t("Fiscal Year")}</th>
          <th class="text-right">{t("Invoices")}</th>
          <th class="text-right">{t("Billed")}</th>
          <th class="text-right">{t("Paid")}</th>
          <th class="text-right">{t("Outstanding")}</th>
          <th class="text-right">{t("Actions")}</th>
        </tr>
      </thead>
      <tbody>
        {#each yearRows as row (row.fy)}
          <tr class="hover cursor-pointer" onclick={() => (selectedFy = row.fy)}>
            <td class="font-semibold">{fiscalYearLabel(row.fy)}</td>
            <td class="text-right tabular-nums">{row.count}</td>
            <td class="text-right font-medium tabular-nums">{fmtMoney(row.billed)}</td>
            <td class="text-right tabular-nums">{fmtMoney(row.paid)}</td>
            <td class="text-right tabular-nums opacity-80">{fmtMoney(row.outstanding)}</td>
            <td class="text-right">
              <a class="btn btn-ghost btn-xs" href={`/invoices?period=fiscal&fy=${row.fy}`} onclick={(e) => e.stopPropagation()}>
                <ReceiptText size={14} />
                {t("View invoices")}
              </a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if view === "pl"}
  <div class="bg-base-100 border-base-300 rounded-box mb-4 border p-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="form-control">
        <span class="label-text mb-1 text-xs font-medium opacity-70">{t("From")}</span>
        <input type="date" class="input input-bordered input-sm" bind:value={plStart} />
      </label>
      <label class="form-control">
        <span class="label-text mb-1 text-xs font-medium opacity-70">{t("To")}</span>
        <input type="date" class="input input-bordered input-sm" bind:value={plEnd} />
      </label>
      <button type="button" class="btn btn-primary btn-sm" onclick={applyPlRange}>
        <CalendarRange size={15} />
        {t("Apply")}
      </button>
      {#if pl?.lastUpdated}
        <span class="text-xs opacity-60">{t("Last updated")}: {pl.lastUpdated?.slice(0, 10)}</span>
      {/if}
    </div>
  </div>

  {#if !pl}
    <div class="alert alert-info"><span>{t("No report data available")}</span></div>
  {:else}
    <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><TrendingUp size={16} class="text-primary" /><span>{t("Revenue")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(pl.revenue)}</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><Boxes size={16} class="text-primary" /><span>{t("COGS")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(pl.cogs)}</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><TrendingUp size={16} class="text-success" /><span>{t("Gross profit")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(pl.grossProfit)}</div>
          <div class="text-xs opacity-60">{pl.grossMarginPercent}%</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><Wallet size={16} class="text-warning" /><span>{t("Expenses")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(pl.expenses)}</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><ReceiptText size={16} class="text-error" /><span>{t("Credit notes")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(pl.creditNotes)}</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><TrendingUp size={16} class="text-success" /><span>{t("Net profit")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(pl.netProfit)}</div>
          <div class="text-xs opacity-60">{pl.netMarginPercent}% {t("margin")}</div>
        </div>
      </div>
    </div>

    <div class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
        <div class="border-base-300 border-b px-4 py-3 font-semibold">{t("Revenue by invoice")}</div>
        <table class="table w-full whitespace-nowrap">
          <thead class="bg-base-200">
            <tr>
              <th>{t("Invoice No")}</th>
              <th class="text-right">{t("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {#each pl.revenueRows || [] as row (row.label + row.amount)}
              <tr class="hover">
                <td class="font-medium">{row.label}</td>
                <td class="text-right font-medium tabular-nums">{fmtMoney(row.amount)}</td>
              </tr>
            {:else}
              <tr><td colspan="2" class="py-6 text-center opacity-50">{t("No revenue in this range")}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
        <div class="border-base-300 border-b px-4 py-3 font-semibold">{t("Expenses by category")}</div>
        <table class="table w-full whitespace-nowrap">
          <thead class="bg-base-200">
            <tr>
              <th>{t("Category")}</th>
              <th class="text-right">{t("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {#each pl.expenseRows || [] as row (row.label + row.amount)}
              <tr class="hover">
                <td>{row.label}</td>
                <td class="text-right font-medium tabular-nums">{fmtMoney(row.amount)}</td>
              </tr>
            {:else}
              <tr><td colspan="2" class="py-6 text-center opacity-50">{t("No expenses in this range")}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
{:else if view === "stock"}
  {#if !stockValuation}
    <div class="alert alert-info"><span>{t("No stock data available")}</span></div>
  {:else}
    <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><Boxes size={16} class="text-primary" /><span>{t("Stock value")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(stockValuation.totalValue)}</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><Boxes size={16} class="text-primary" /><span>{t("Total quantity")}</span></div>
          <div class="text-xl font-bold">{stockValuation.totalQuantity}</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><CalendarRange size={16} class="text-warning" /><span>{t("Low stock items")}</span></div>
          <div class="text-xl font-bold">{stockValuation.lowStockCount}</div>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border shadow-sm">
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2 text-sm opacity-70"><Wallet size={16} class="text-error" /><span>{t("Reorder cost")}</span></div>
          <div class="text-xl font-bold">{fmtMoney(stockValuation.reorderCost)}</div>
        </div>
      </div>
    </div>

    <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
      <div class="border-base-300 flex items-center justify-between border-b px-4 py-3">
        <span class="text-lg font-semibold">{t("Inventory valuation")}</span>
        <button type="button" class="btn btn-outline btn-sm no-print" onclick={exportStockCsv}>
          <Download size={15} />
          {t("Export CSV")}
        </button>
      </div>
      <table class="table w-full whitespace-nowrap">
        <thead class="bg-base-200">
          <tr>
            <th>{t("Product")}</th>
            <th>{t("SKU")}</th>
            <th>{t("Barcode")}</th>
            <th class="text-right">{t("On hand")}</th>
            <th class="text-right">{t("Cost")}</th>
            <th class="text-right">{t("Value")}</th>
            <th class="text-right">{t("Reorder level")}</th>
          </tr>
        </thead>
        <tbody>
          {#each stockValuation.items || [] as item (item.productId)}
            <tr class="hover">
              <td class="font-medium">{item.name}</td>
              <td class="text-sm opacity-70">{item.sku || "—"}</td>
              <td class="text-sm opacity-70">{item.barcode || "—"}</td>
              <td class="text-right tabular-nums">
                <span class="badge {item.lowStock ? 'badge-warning' : 'badge-ghost'}">{item.quantityOnHand}</span>
              </td>
              <td class="text-right tabular-nums">{fmtMoney(item.costPrice)}</td>
              <td class="text-right font-medium tabular-nums">{fmtMoney(item.value)}</td>
              <td class="text-right tabular-nums opacity-70">{item.reorderLevel || 0}</td>
            </tr>
          {:else}
            <tr><td colspan="7" class="py-8 text-center opacity-50">{t("No products")}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{:else}
  <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><ReceiptText size={16} class="text-primary" /><span>{t("Invoices")}</span></div>
        <div class="text-xl font-bold">{auditSummary.count}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><TrendingUp size={16} class="text-primary" /><span>{t("Billed")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(auditSummary.billed)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><Wallet size={16} class="text-success" /><span>{t("Paid")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(auditSummary.paid)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><CalendarRange size={16} class="text-error" /><span>{t("Outstanding")}</span></div>
        <div class="text-xl font-bold">{fmtMoney(auditSummary.outstanding)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body gap-1 p-4">
        <div class="flex items-center gap-2 text-sm opacity-70"><ReceiptText size={16} class="opacity-50" /><span>{t("Voided")}</span></div>
        <div class="text-xl font-bold">{auditSummary.voided}</div>
      </div>
    </div>
  </div>

  <div class="bg-base-100 border-base-300 rounded-box mb-4 overflow-x-auto border">
    <div class="border-base-300 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <span class="text-lg font-semibold">{t("Register")}</span>
      <button type="button" class="btn btn-outline btn-sm no-print" onclick={() => window.print()}>
        <Printer size={15} />
        {t("Print report")}
      </button>
    </div>
    <table class="table w-full whitespace-nowrap">
      <thead class="bg-base-200">
        <tr>
          <th>{t("Invoice No")}</th>
          <th>{t("Issue Date")}</th>
          <th>{t("Customer")}</th>
          <th class="text-right">{t("Items")}</th>
          <th class="text-right">{t("Total")}</th>
          <th>{t("Status")}</th>
          <th>{t("Payment method")}</th>
        </tr>
      </thead>
      <tbody>
        {#each auditInvoices as e (e.invoice.id)}
          <tr class="hover">
            <td class="font-medium hover:underline"><a href={`/invoices/${e.invoice.id}`}>{e.invoice.invoiceNumber}</a></td>
            <td class="text-sm">{formatDateWithBs(e.invoice.issueDate, dateLocale, undefined, { year: "numeric", month: "short", day: "numeric" })}</td>
            <td>{e.customerName || "—"}</td>
            <td class="text-right tabular-nums">{e.items?.length || 0}</td>
            <td class="text-right font-medium tabular-nums">{fmtMoney(e.invoice.total)}</td>
            <td>{statusLabel(e.invoice.status)}</td>
            <td>{e.invoice.paymentMethod || "—"}</td>
          </tr>
        {/each}
        {#if auditInvoices.length === 0}
          <tr>
            <td colspan="99" class="py-8 text-center opacity-50">{t("No invoices in this fiscal year")}</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>

  <div class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
    <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
      <div class="border-base-300 border-b px-4 py-3 font-semibold">{t("By customer")}</div>
      <table class="table w-full whitespace-nowrap">
        <thead class="bg-base-200">
          <tr>
            <th>{t("Customer")}</th>
            <th class="text-right">{t("Invoices")}</th>
            <th class="text-right">{t("Billed")}</th>
            <th class="text-right">{t("Paid")}</th>
            <th class="text-right">{t("Outstanding")}</th>
          </tr>
        </thead>
        <tbody>
          {#each byCustomer as row (row.name)}
            <tr class="hover">
              <td>{row.name}</td>
              <td class="text-right tabular-nums">{row.count}</td>
              <td class="text-right font-medium tabular-nums">{fmtMoney(row.billed)}</td>
              <td class="text-right tabular-nums">{fmtMoney(row.paid)}</td>
              <td class="text-right tabular-nums opacity-80">{fmtMoney(row.outstanding)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
      <div class="border-base-300 border-b px-4 py-3 font-semibold">{t("By payment method")}</div>
      <table class="table w-full whitespace-nowrap">
        <thead class="bg-base-200">
          <tr>
            <th>{t("Payment method")}</th>
            <th class="text-right">{t("Invoices")}</th>
            <th class="text-right">{t("Billed")}</th>
          </tr>
        </thead>
        <tbody>
          {#each byPaymentMethod as row (row.method)}
            <tr class="hover">
              <td>{row.method}</td>
              <td class="text-right tabular-nums">{row.count}</td>
              <td class="text-right font-medium tabular-nums">{fmtMoney(row.billed)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="bg-base-100 border-base-300 rounded-box mb-4 overflow-x-auto border">
    <div class="border-base-300 border-b px-4 py-3 font-semibold">{t("Status changes")}</div>
    {#if changeLog.length === 0}
      <div class="py-8 text-center text-sm opacity-50">{t("No status changes")}</div>
    {:else}
      <table class="table w-full whitespace-nowrap">
        <thead class="bg-base-200">
          <tr>
            <th>{t("Changed at")}</th>
            <th>{t("Invoice No")}</th>
            <th>{t("Customer")}</th>
            <th>{t("Status")}</th>
            <th>{t("Payment method")}</th>
            <th>{t("Note")}</th>
          </tr>
        </thead>
        <tbody>
          {#each changeLog as entry (entry.event.id)}
            <tr class="hover">
              <td class="text-sm tabular-nums"
                >{formatDateWithBs(entry.event.changedAt, dateLocale, undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td
              >
              <td class="font-medium hover:underline"><a href={`/invoices/${entry.invoice.id}`}>{entry.invoice.invoiceNumber}</a></td>
              <td>{entry.customer || "—"}</td>
              <td>{statusLabel(entry.event.status)}</td>
              <td>{entry.event.paymentMethod || "—"}</td>
              <td>{entry.event.note || "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="bg-base-100 border-base-300 rounded-box mb-4 overflow-x-auto border">
    <div class="border-base-300 border-b px-4 py-3 font-semibold">{t("Payments")}</div>
    {#if payments.length === 0}
      <div class="py-8 text-center text-sm opacity-50">{t("No payments recorded")}</div>
    {:else}
      <table class="table w-full whitespace-nowrap">
        <thead class="bg-base-200">
          <tr>
            <th>{t("Verified at")}</th>
            <th>{t("Invoice No")}</th>
            <th>{t("Customer")}</th>
            <th>{t("Provider")}</th>
            <th>{t("Transaction ID")}</th>
            <th>{t("Reference")}</th>
            <th class="text-right">{t("Amount")}</th>
          </tr>
        </thead>
        <tbody>
          {#each payments as entry (entry.payment.id)}
            <tr class="hover">
              <td class="text-sm tabular-nums"
                >{formatDateWithBs(entry.payment.verifiedAt, dateLocale, undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td
              >
              <td class="font-medium hover:underline"><a href={`/invoices/${entry.invoice.id}`}>{entry.invoice.invoiceNumber}</a></td>
              <td>{entry.customer || "—"}</td>
              <td>{entry.payment.provider}</td>
              <td class="tabular-nums">{entry.payment.providerTransactionId}</td>
              <td>{entry.payment.providerReference || "—"}</td>
              <td class="text-right font-medium tabular-nums">{fmtMoney(entry.payment.amount)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}
