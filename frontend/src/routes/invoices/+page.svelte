<script lang="ts">
  import { CheckSquare, ChevronLeft, ChevronRight, Eye, Pencil, Search, Send, SquarePen, Trash2 } from "lucide-svelte";
  import { getContext } from "svelte";
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { SvelteSet } from "svelte/reactivity";
  import { formatDateWithBs, numberFormatLocale } from "$lib/utils/dates";

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
  let canSelect = $derived(canBulkUpdate || canBulkDelete);

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

  let listViewKey = $derived(`${searchQuery}\u0000${filterStatus}\u0000${sortKey}\u0000${sortDirection}\u0000${pageSize}`);
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
