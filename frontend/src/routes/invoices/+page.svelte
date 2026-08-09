<script lang="ts">
  import { CheckSquare, ChevronLeft, ChevronRight, Download, Eye, Mail, Pencil, Search, Send, SquarePen, Trash2 } from "lucide-svelte";
  import { getContext } from "svelte";
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { SvelteSet } from "svelte/reactivity";
  import { formatDateWithBs, numberFormatLocale } from "$lib/utils/dates";
  import {
    bsMonthName,
    currentBsParts,
    currentFiscalYear,
    fiscalYearLabel,
    inBsMonth,
    inBsYear,
    inDay,
    inFiscalYear,
    inRange,
    inWeekOf,
    nepaliFiscalYear,
    parseDateValue,
    toBs,
    toDateInputValue,
  } from "$lib/utils/fiscal";

  let { data } = $props();

  let t = getContext("i18n") as (key: string) => string;
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let dateLocale = $derived(data.localization?.locale || "en");
  let user = $derived(data.user);
  let canCreate = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "create"));
  let canUpdate = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "update"));
  let canViewCustomers = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "customers" && p.action === "read"));

  function fmtMoney(cur: string | undefined, n: number) {
    if (!cur) cur = "USD";
    try {
      const locale = numberFormatLocale(data.localization?.locale, numberFormat);
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: cur,
      }).format(n || 0);
    } catch {
      return `${cur} ${Number(n || 0).toFixed(2)}`;
    }
  }

  let sourceInvoices = $derived(data.invoices || []);
  // The list is locally mutable after bulk actions; synchronize it when the server data changes.
  let invoices = $state<any[]>([]);
  let filterStatus = $state(page.url.searchParams.get("status") || "all");
  let isOutstandingFilter = (status: string) => status === "outstanding";

  // Period (date) filter — Nepali-friendly periods read from the URL.
  let periodMode = $state(page.url.searchParams.get("period") || "all"); // all | fiscal | year | month | week | day | custom
  let todayInput = $state(toDateInputValue(new Date()));
  let filterFy = $state(page.url.searchParams.get("fy") ? Number(page.url.searchParams.get("fy")) : currentFiscalYear());
  let filterBsYear = $state(page.url.searchParams.get("year") ? Number(page.url.searchParams.get("year")) : currentBsParts().year);
  let filterBsMonth = $state(
    (() => {
      const raw = page.url.searchParams.get("month");
      const m = raw ? Number(raw) : NaN;
      return Number.isInteger(m) && m >= 0 && m <= 11 ? m : currentBsParts().month;
    })(),
  );
  let weekAnchor = $state(page.url.searchParams.get("week") || todayInput);
  let dayValue = $state(page.url.searchParams.get("day") || todayInput);
  let customFrom = $state(page.url.searchParams.get("from") || "");
  let customTo = $state(page.url.searchParams.get("to") || "");

  let fiscalYears = $derived.by(() => {
    const years: number[] = [];
    for (const i of invoices) {
      const fy = nepaliFiscalYear(i.issueDate);
      if (fy != null && !years.includes(fy)) years.push(fy);
    }
    if (!years.includes(currentFiscalYear())) years.push(currentFiscalYear());
    if (Number.isInteger(filterFy) && !years.includes(filterFy)) years.push(filterFy);
    return years.sort((a, b) => a - b);
  });
  let bsYears = $derived.by(() => {
    const years: number[] = [];
    for (const i of invoices) {
      const bs = toBs(i.issueDate);
      if (bs && !years.includes(bs.year)) years.push(bs.year);
    }
    if (!years.includes(currentBsParts().year)) years.push(currentBsParts().year);
    if (Number.isInteger(filterBsYear) && !years.includes(filterBsYear)) years.push(filterBsYear);
    return years.sort((a, b) => a - b);
  });
  let weekRangeText = $derived.by(() => {
    const a = parseDateValue(weekAnchor);
    if (!a) return "";
    const offset = (a.getDay() + 6) % 7;
    const start = new Date(a.getFullYear(), a.getMonth(), a.getDate() - offset);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return `${formatDateWithBs(start, dateLocale)} – ${formatDateWithBs(end, dateLocale)}`;
  });

  let searchQuery = $state("");
  let sortKey = $state<"invoiceNumber" | "customer" | "total" | "status" | "issueDate" | "updatedAt">("invoiceNumber");
  let sortDirection = $state<"asc" | "desc">("desc");
  let pageNumber = $state(1);
  let pageSize = $state(25);
  let selectedIds = new SvelteSet<string>();
  let bulkBusy = $state(false);
  let bulkMessage = $state("");
  let bulkError = $state("");

  let canBulkUpdate = $derived(Boolean(canUpdate));
  let canBulkDelete = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "delete"));
  let canBulkExport = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "export"));
  let canSelect = $derived(canBulkUpdate || canBulkDelete || canBulkExport);

  function bulkExportCsv() {
    if (selectedInvoices.length === 0) return;
    const ids = selectedInvoices.map((inv) => String(inv.id)).join(",");
    window.location.href = `/api/v1/export/invoices.csv?ids=${encodeURIComponent(ids)}`;
  }

  async function bulkSendReminders() {
    if (bulkBusy || selectedInvoices.length === 0) return;
    const eligible = selectedInvoices.filter((inv) => inv.status === "sent" || inv.status === "overdue");
    if (eligible.length === 0) {
      bulkError = t("Only sent or overdue invoices can be reminded.");
      return;
    }
    if (!confirm(t("Send payment reminders for the selected invoices?"))) return;
    bulkBusy = true;
    bulkMessage = "";
    bulkError = "";
    try {
      const response = await fetch("/api/v1/invoices/bulk-remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: eligible.map((inv) => String(inv.id)) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
      bulkMessage = `${t("Reminders sent")}: ${body.sent ?? 0}${(body.skipped || []).length > 0 ? ` (${t("skipped")}: ${body.skipped.length})` : ""}`;
      if ((body.skipped || []).length > 0) {
        bulkError = t("Some invoices were skipped (no email or not configured).");
      }
    } catch (e: any) {
      bulkError = e.message || String(e);
    } finally {
      bulkBusy = false;
    }
  }

  function toDateMs(v: unknown) {
    return new Date((v as string) || 0).getTime();
  }

  function compareText(a: unknown, b: unknown) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function handleSort(key: "invoiceNumber" | "customer" | "total" | "status" | "issueDate" | "updatedAt") {
    if (sortKey === key) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
      return;
    }
    sortKey = key;
    sortDirection = key === "invoiceNumber" ? "desc" : "asc";
  }

  function sortMarker(key: "invoiceNumber" | "customer" | "total" | "status" | "issueDate" | "updatedAt") {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  }

  let filtered = $derived(
    invoices.filter((i) => {
      if (filterStatus !== "all") {
        if (isOutstandingFilter(filterStatus)) {
          if (i.status !== "sent" && i.status !== "overdue") return false;
        } else if (i.status !== filterStatus) {
          return false;
        }
      }
      if (periodMode !== "all") {
        const issueDate = i.issueDate as string | undefined;
        let ok = false;
        if (periodMode === "fiscal") ok = inFiscalYear(issueDate, filterFy);
        else if (periodMode === "year") ok = inBsYear(issueDate, filterBsYear);
        else if (periodMode === "month") ok = inBsMonth(issueDate, filterBsYear, filterBsMonth);
        else if (periodMode === "week") ok = inWeekOf(issueDate, weekAnchor);
        else if (periodMode === "day") ok = inDay(issueDate, dayValue);
        else if (periodMode === "custom") ok = inRange(issueDate, customFrom, customTo);
        if (!ok) return false;
      }
      const query = searchQuery.trim().toLowerCase();
      if (!query) return true;
      return [i.invoiceNumber, i.customer?.name, i.paidWith, i.paymentMethod].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      );
    }),
  );

  let sortedFiltered = $derived(
    [...filtered].sort((a, b) => {
      let result = 0;
      if (sortKey === "invoiceNumber") {
        result = compareText(a.invoiceNumber, b.invoiceNumber);
      } else if (sortKey === "customer") {
        result = compareText(a.customer?.name, b.customer?.name);
      } else if (sortKey === "total") {
        result = Number(a.total || 0) - Number(b.total || 0);
      } else if (sortKey === "status") {
        result = compareText(a.status, b.status);
      } else if (sortKey === "issueDate") {
        result = toDateMs(a.issueDate) - toDateMs(b.issueDate);
      } else if (sortKey === "updatedAt") {
        result = toDateMs(a.updatedAt) - toDateMs(b.updatedAt);
      }

      if (result === 0) {
        result = compareText(a.invoiceNumber, b.invoiceNumber);
      }

      return sortDirection === "asc" ? result : -result;
    }),
  );

  let pageCount = $derived(Math.max(1, Math.ceil(sortedFiltered.length / pageSize)));
  let visiblePage = $derived(sortedFiltered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize));
  let selectedOnPage = $derived(visiblePage.filter((invoice) => selectedIds.has(String(invoice.id))));
  let allVisibleSelected = $derived(visiblePage.length > 0 && selectedOnPage.length === visiblePage.length);
  let selectedInvoices = $derived(invoices.filter((invoice) => selectedIds.has(String(invoice.id))));

  // Keep the local snapshot synchronized after a server refresh.
  $effect(() => {
    invoices = [...sourceInvoices];
    pageNumber = 1;
    selectedIds.clear();
  });

  let listViewKey = $derived(
    `${searchQuery}\u0000${filterStatus}\u0000${periodMode}\u0000${filterFy}\u0000${filterBsYear}\u0000${filterBsMonth}\u0000${weekAnchor}\u0000${dayValue}\u0000${customFrom}\u0000${customTo}\u0000${sortKey}\u0000${sortDirection}\u0000${pageSize}`,
  );
  $effect(() => {
    listViewKey;
    pageNumber = 1;
    selectedIds.clear();
  });

  $effect(() => {
    const validIds = new SvelteSet(invoices.map((invoice) => String(invoice.id)));
    const next = new SvelteSet([...selectedIds].filter((id) => validIds.has(id)));
    if (next.size !== selectedIds.size) {
      selectedIds.clear();
      for (const id of next) selectedIds.add(id);
    }
  });

  function resetListPosition() {
    pageNumber = 1;
    selectedIds.clear();
    bulkMessage = "";
    bulkError = "";
  }

  function clearPeriodFilter() {
    periodMode = "all";
    resetListPosition();
  }

  function toggleSelection(id: string) {
    const next = new SvelteSet(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.clear();
    for (const id of next) selectedIds.add(id);
    bulkMessage = "";
    bulkError = "";
  }

  function togglePageSelection() {
    const next = new SvelteSet(selectedIds);
    if (allVisibleSelected) {
      for (const invoice of visiblePage) next.delete(String(invoice.id));
    } else {
      for (const invoice of visiblePage) next.add(String(invoice.id));
    }
    selectedIds.clear();
    for (const id of next) selectedIds.add(id);
    bulkMessage = "";
    bulkError = "";
  }

  function clearSelection() {
    selectedIds.clear();
    bulkMessage = "";
    bulkError = "";
  }

  async function runBulkAction(action: "mark-sent" | "delete") {
    if (bulkBusy || selectedInvoices.length === 0) return;
    const eligible = selectedInvoices.filter((invoice) => (action === "mark-sent" ? invoice.status === "draft" : invoice.status === "draft" || invoice.status === "voided"));
    const skipped = selectedInvoices.length - eligible.length;
    if (eligible.length === 0) {
      bulkError = action === "mark-sent" ? t("Only draft invoices can be marked as sent.") : t("Only draft or voided invoices can be deleted.");
      return;
    }
    if (action === "delete" && !confirm(t("Delete the selected draft or voided invoices? This cannot be undone."))) return;

    bulkBusy = true;
    bulkMessage = "";
    bulkError = "";
    const results = await Promise.allSettled(
      eligible.map(async (invoice) => {
        const response = await fetch(`/api/v1/invoices/${invoice.id}`, {
          method: action === "delete" ? "DELETE" : "PUT",
          headers: action === "mark-sent" ? { "Content-Type": "application/json" } : undefined,
          body: action === "mark-sent" ? JSON.stringify({ status: "sent" }) : undefined,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `${response.status} ${response.statusText}`);
        }
        return invoice;
      }),
    );
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    const succeededIds = new SvelteSet(results.flatMap((result) => (result.status === "fulfilled" ? [String(result.value.id)] : [])));
    if (action === "delete") {
      invoices = invoices.filter((invoice) => !succeededIds.has(String(invoice.id)));
    } else {
      invoices = invoices.map((invoice) => (succeededIds.has(String(invoice.id)) ? { ...invoice, status: "sent" } : invoice));
    }
    const remainingIds = [...selectedIds].filter((id) => !succeededIds.has(id));
    selectedIds.clear();
    for (const id of remainingIds) selectedIds.add(id);
    await invalidateAll();
    bulkMessage = `${succeeded} ${action === "delete" ? t("invoice(s) deleted") : t("invoice(s) marked as sent")}${skipped ? ` · ${skipped} ${t("skipped")}` : ""}${failed ? ` · ${failed} ${t("failed")}` : ""}`;
    if (failed) bulkError = t("Some invoices could not be updated. Review their individual status.");
    bulkBusy = false;
  }

  // Show "Paid with" only when at least one visible (filtered) invoice has a payment method.
  // This hides the column automatically when filtering to statuses that can never carry one
  // (e.g. Draft, Sent, Voided) — the column would otherwise appear with all cells empty.
  let showPaidWith = $derived(sortedFiltered.some((i: any) => i.paidWith));
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Invoices")}</h1>
  {#if canCreate}
    <a href="/invoices/new" class="btn btn-primary btn-sm w-full sm:w-auto">
      <SquarePen size={16} />
      {t("Create Invoice")}
    </a>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-4">
    <span>{data.error}</span>
  </div>
{/if}

<div class="bg-base-100 border-base-300 rounded-box mb-4 space-y-3 border p-4">
  <label class="input input-bordered flex w-full max-w-xl items-center gap-2">
    <Search size={16} class="opacity-60" />
    <input bind:value={searchQuery} placeholder={t("Search invoice number, customer, or payment")} aria-label={t("Search invoices")} />
  </label>
  <div class="flex flex-wrap gap-2">
    <button
      class={`btn btn-sm ${filterStatus === "all" ? "btn-neutral" : "btn-ghost"}`}
      onclick={() => {
        filterStatus = "all";
        resetListPosition();
      }}>{t("All")}</button
    >
    <button
      class={`btn btn-sm ${filterStatus === "outstanding" ? "btn-neutral" : "btn-ghost"}`}
      onclick={() => {
        filterStatus = "outstanding";
        resetListPosition();
      }}>{t("Outstanding")}</button
    >
    <button
      class={`btn btn-sm ${filterStatus === "sent" ? "btn-neutral" : "btn-ghost"}`}
      onclick={() => {
        filterStatus = "sent";
        resetListPosition();
      }}>{t("Sent")}</button
    >
    <button
      class={`btn btn-sm ${filterStatus === "draft" ? "btn-neutral" : "btn-ghost"}`}
      onclick={() => {
        filterStatus = "draft";
        resetListPosition();
      }}>{t("Draft")}</button
    >
    <button
      class={`btn btn-sm ${filterStatus === "complete" ? "btn-neutral" : "btn-ghost"}`}
      onclick={() => {
        filterStatus = "complete";
        resetListPosition();
      }}>{t("Complete")}</button
    >
    <button
      class={`btn btn-sm ${filterStatus === "paid" ? "btn-neutral" : "btn-ghost"}`}
      onclick={() => {
        filterStatus = "paid";
        resetListPosition();
      }}>{t("Paid")}</button
    >
    <button
      class={`btn btn-sm ${filterStatus === "voided" ? "btn-neutral" : "btn-ghost"}`}
      onclick={() => {
        filterStatus = "voided";
        resetListPosition();
      }}>{t("Voided")}</button
    >
  </div>
  <div class="border-base-300 flex flex-wrap items-center gap-2 border-t pt-3">
    <select class="select select-bordered select-sm" bind:value={periodMode} onchange={resetListPosition} aria-label={t("Period")}>
      <option value="all">{t("All periods")}</option>
      <option value="fiscal">{t("Fiscal Year")}</option>
      <option value="year">{t("Year")}</option>
      <option value="month">{t("Month")}</option>
      <option value="week">{t("Week")}</option>
      <option value="day">{t("Day")}</option>
      <option value="custom">{t("Custom range")}</option>
    </select>
    {#if periodMode === "fiscal"}
      <select class="select select-bordered select-sm" bind:value={filterFy} onchange={resetListPosition} aria-label={t("Fiscal Year")}>
        {#each fiscalYears as fy (fy)}
          <option value={fy}>{fiscalYearLabel(fy)}</option>
        {/each}
      </select>
    {:else if periodMode === "year"}
      <select class="select select-bordered select-sm" bind:value={filterBsYear} onchange={resetListPosition} aria-label={t("Year")}>
        {#each bsYears as y (y)}
          <option value={y}>{y}</option>
        {/each}
      </select>
    {:else if periodMode === "month"}
      <select class="select select-bordered select-sm" bind:value={filterBsYear} onchange={resetListPosition} aria-label={t("Year")}>
        {#each bsYears as y (y)}
          <option value={y}>{y}</option>
        {/each}
      </select>
      <select class="select select-bordered select-sm" bind:value={filterBsMonth} onchange={resetListPosition} aria-label={t("Month")}>
        {#each Array.from({ length: 12 }, (_, m) => m) as m (m)}
          <option value={m}>{bsMonthName(m, dateLocale)}</option>
        {/each}
      </select>
    {:else if periodMode === "week"}
      <input type="date" class="input input-bordered input-sm" bind:value={weekAnchor} onchange={resetListPosition} aria-label={t("Week containing")} />
    {:else if periodMode === "day"}
      <input type="date" class="input input-bordered input-sm" bind:value={dayValue} onchange={resetListPosition} aria-label={t("Day")} />
    {:else if periodMode === "custom"}
      <input type="date" class="input input-bordered input-sm" bind:value={customFrom} onchange={resetListPosition} aria-label={t("From")} />
      <span class="text-xs opacity-60">–</span>
      <input type="date" class="input input-bordered input-sm" bind:value={customTo} onchange={resetListPosition} aria-label={t("To")} />
    {/if}
    {#if periodMode !== "all"}
      <button type="button" class="btn btn-ghost btn-xs" onclick={clearPeriodFilter}>{t("Clear filter")}</button>
    {/if}
    <span class="text-xs opacity-70">
      {#if periodMode === "fiscal"}
        {t("Fiscal Year")}: {fiscalYearLabel(filterFy)}
      {:else if periodMode === "year"}
        {t("Year")}: {filterBsYear}
      {:else if periodMode === "month"}
        {bsMonthName(filterBsMonth, dateLocale)} {filterBsYear}
      {:else if periodMode === "week"}
        {t("Week")}: {weekRangeText}
      {:else if periodMode === "day"}
        {t("Day")}: {formatDateWithBs(dayValue, dateLocale)}
      {:else if periodMode === "custom"}
        {t("Custom range")}: {formatDateWithBs(customFrom, dateLocale) || "…"} – {formatDateWithBs(customTo, dateLocale) || "…"}
      {/if}
    </span>
  </div>
  {#if canSelect && selectedInvoices.length > 0}
    <div class="border-base-300 bg-base-200/60 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2 text-sm">
        <CheckSquare size={16} />
        <span>{selectedInvoices.length} {t("selected")}</span>
        <button type="button" class="btn btn-ghost btn-xs" onclick={clearSelection}>{t("Clear")}</button>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if canBulkUpdate}
          <button type="button" class="btn btn-sm btn-primary" onclick={() => runBulkAction("mark-sent")} disabled={bulkBusy}>
            {#if bulkBusy}<span class="loading loading-spinner loading-xs"></span>{/if}<Send size={15} />{t("Mark drafts as sent")}
          </button>
        {/if}
        {#if canBulkDelete}
          <button type="button" class="btn btn-sm btn-error btn-outline" onclick={() => runBulkAction("delete")} disabled={bulkBusy}>
            <Trash2 size={15} />{t("Delete drafts/voided")}
          </button>
        {/if}
        {#if canBulkExport}
          <button type="button" class="btn btn-sm btn-outline" onclick={bulkExportCsv} disabled={bulkBusy}>
            <Download size={15} />CSV
          </button>
        {/if}
        {#if canBulkUpdate}
          <button type="button" class="btn btn-sm btn-outline" onclick={bulkSendReminders} disabled={bulkBusy}>
            {#if bulkBusy}<span class="loading loading-spinner loading-xs"></span>{/if}<Mail size={15} />{t("Send Reminders")}
          </button>
        {/if}
      </div>
    </div>
  {/if}
  {#if bulkMessage}
    <div class="alert alert-success py-2 text-sm"><span>{bulkMessage}</span></div>
  {/if}
  {#if bulkError}
    <div class="alert alert-warning py-2 text-sm"><span>{bulkError}</span></div>
  {/if}
</div>

{#if invoices.length === 0}
  <div class="bg-base-100 border-base-300 rounded-box border py-12 text-center">
    <div class="mb-4 text-lg opacity-50">{t("No invoices found")}</div>
    {#if canCreate}
      <a href="/invoices/new" class="btn btn-primary">{t("Create your first invoice")}</a>
    {/if}
  </div>
{:else}
  <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
    <table class="table-sm sm:table-md table w-full whitespace-nowrap">
      <thead class="bg-base-200">
        <tr>
          {#if canSelect}
            <th class="w-10">
              <input class="checkbox checkbox-sm" type="checkbox" checked={allVisibleSelected} onchange={togglePageSelection} aria-label={t("Select visible invoices")} />
            </th>
          {/if}
          <th>
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("invoiceNumber")}>
              {t("Invoice No")}{sortMarker("invoiceNumber")}
            </button>
          </th>
          {#if canViewCustomers}
            <th>
              <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("customer")}>
                {t("Customer")}{sortMarker("customer")}
              </button>
            </th>
          {/if}
          <th>
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("total")}>
              {t("Total")}{sortMarker("total")}
            </button>
          </th>
          <th>
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("status")}>
              {t("Status")}{sortMarker("status")}
            </button>
          </th>
          <th class="hidden sm:table-cell">
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("issueDate")}>
              {t("Issue Date")}{sortMarker("issueDate")}
            </button>
          </th>
          {#if showPaidWith}
            <th class="hidden sm:table-cell">
              {t("Paid with")}
            </th>
          {/if}
          <th class="hidden text-right md:table-cell">
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("updatedAt")}>
              {t("Updated")}{sortMarker("updatedAt")}
            </button>
          </th>
          <th class="text-right">{t("Actions")}</th>
        </tr>
      </thead>
      <tbody>
        {#each visiblePage as inv (inv.id)}
          <tr class="hover">
            {#if canSelect}
              <td>
                <input
                  class="checkbox checkbox-sm"
                  type="checkbox"
                  checked={selectedIds.has(String(inv.id))}
                  onchange={() => toggleSelection(String(inv.id))}
                  aria-label={`${t("Select invoice")} ${inv.invoiceNumber}`}
                />
              </td>
            {/if}
            <td class="font-medium hover:underline">
              <a href={`/invoices/${inv.id}`}>{inv.invoiceNumber}</a>
              <div class="text-xs opacity-70 sm:hidden">
                {#if inv.issueDate}
                  {formatDateWithBs(inv.issueDate, dateLocale, data.localization?.dateFormat, { year: "numeric", month: "short", day: "numeric" })}
                {/if}
              </div>
            </td>
            {#if canViewCustomers}
              <td class="max-w-[12rem] truncate sm:max-w-xs" title={inv.customer?.name}>
                {inv.customer?.name || "-"}
              </td>
            {/if}
            <td class="font-medium">{fmtMoney(inv.currency, inv.total)}</td>
            <td>
              {#if inv.status === "draft"}
                <div class="badge badge-ghost badge-sm">{t("Draft")}</div>
              {:else if inv.status === "sent"}
                <div class="badge badge-info badge-sm">{t("Sent")}</div>
              {:else if inv.status === "paid"}
                <div class="badge badge-success badge-sm">{t("Paid")}</div>
              {:else if inv.status === "complete"}
                <div class="badge badge-secondary badge-sm">
                  {t("Complete")}
                </div>
              {:else if inv.status === "overdue"}
                <div class="badge badge-error badge-sm">{t("Overdue")}</div>
              {:else if inv.status === "voided"}
                <div class="badge badge-neutral badge-sm">{t("Voided")}</div>
              {/if}
            </td>
            <td class="hidden text-sm tabular-nums sm:table-cell">
              {#if inv.issueDate}
                {formatDateWithBs(inv.issueDate, dateLocale, data.localization?.dateFormat, { year: "numeric", month: "short", day: "numeric" })}
              {/if}
            </td>
            {#if showPaidWith}
              <td class="hidden text-sm sm:table-cell">
                {(inv as any).paidWith || ""}
              </td>
            {/if}
            <td class="hidden text-right text-sm tabular-nums opacity-70 md:table-cell">
              {#if inv.updatedAt}
                {formatDateWithBs(inv.updatedAt, dateLocale, data.localization?.dateFormat, { year: "numeric", month: "short", day: "numeric" })}
              {/if}
            </td>
            <td>
              <div class="flex justify-end gap-1">
                <a class="btn btn-ghost btn-xs btn-square" href={`/invoices/${inv.id}`} title={t("View invoice")} aria-label={t("View invoice")}><Eye size={15} /></a>
                {#if canUpdate && inv.status === "draft"}
                  <a class="btn btn-ghost btn-xs btn-square" href={`/invoices/${inv.id}/edit`} title={t("Edit invoice")} aria-label={t("Edit invoice")}><Pencil size={15} /></a>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
        {#if visiblePage.length === 0}
          <tr>
            <td colspan="99" class="py-8 text-center opacity-50">{t("No invoices match this filter")}</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
  {#if sortedFiltered.length > 0}
    <div class="mt-3 flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
      <div class="flex items-center gap-2 opacity-70">
        <span>{t("Rows per page")}</span>
        <select class="select select-bordered select-sm" bind:value={pageSize} onchange={resetListPosition} aria-label={t("Rows per page")}>
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span>{(pageNumber - 1) * pageSize + 1}–{Math.min(pageNumber * pageSize, sortedFiltered.length)} {t("of")} {sortedFiltered.length}</span>
      </div>
      <div class="join">
        <button class="btn btn-sm join-item" type="button" onclick={() => (pageNumber = Math.max(1, pageNumber - 1))} disabled={pageNumber <= 1} aria-label={t("Previous page")}
          ><ChevronLeft size={16} /></button
        >
        <span class="btn btn-sm join-item pointer-events-none">{pageNumber} / {pageCount}</span>
        <button class="btn btn-sm join-item" type="button" onclick={() => (pageNumber = Math.min(pageCount, pageNumber + 1))} disabled={pageNumber >= pageCount} aria-label={t("Next page")}
          ><ChevronRight size={16} /></button
        >
      </div>
    </div>
  {/if}
{/if}
