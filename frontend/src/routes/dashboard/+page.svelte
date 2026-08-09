<script lang="ts">
  import { ArrowRight, Barcode, FilePlus2, ShieldOff, TrendingUp, TriangleAlert, Package } from "lucide-svelte";
  import { getContext } from "svelte";
  import { formatDateWithBs, numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();

  let t = getContext("i18n") as (key: string) => string;
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let dateLocale = $derived(data.localization?.locale || "en");
  let statusCounts = $derived((data.status || {}) as Record<string, number>);
  let user = $derived(data.user);
  let canViewInvoices = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "read"));
  let canViewCustomers = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "customers" && p.action === "read"));
  let canCreateInvoices = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "create"));
  let canUseQuickSell = $derived(
    user?.isAdmin ||
      (user?.permissions?.some((p) => p.resource === "quick_sell" && p.action === "use") &&
        user?.permissions?.some((p) => p.resource === "invoices" && p.action === "create") &&
        user?.permissions?.some((p) => p.resource === "products" && p.action === "read") &&
        user?.permissions?.some((p) => p.resource === "customers" && p.action === "read") &&
        user?.permissions?.some((p) => p.resource === "tax_definitions" && p.action === "read")),
  );
  let canViewProfit = $derived(Boolean(user?.isAdmin));
  let maxMonthlyBilled = $derived(Math.max(1, ...(data.kpis?.monthlyTrend || []).map((x) => x.billed)));

  function fmtMoney(n: number) {
    const cur = data.money?.currency || "USD";
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
</script>

<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  <h1 class="text-2xl font-semibold">{t("Dashboard")}</h1>
  {#if canUseQuickSell || (canViewInvoices && canCreateInvoices)}
    <div class="flex flex-wrap gap-2">
      {#if canUseQuickSell}
        <a href="/quick-sell" class="btn btn-primary btn-sm">
          <Barcode size={16} />
          {t("Quick Sell")}
        </a>
      {/if}
      {#if canViewInvoices && canCreateInvoices}
        <a href="/invoices/new" class="btn btn-outline btn-sm">
          <FilePlus2 size={16} />
          {t("Create Invoice")}
        </a>
      {/if}
    </div>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-4">
    <span>{data.error}</span>
  </div>
{/if}

{#if !canViewInvoices}
  <div class="card bg-base-100 border-base-300 rounded-box mb-4 border">
    <div class="card-body flex flex-row items-center gap-4 p-6">
      <ShieldOff size={24} class="shrink-0 opacity-50" />
      <div>
        <div class="font-semibold">{t("Invoice data hidden")}</div>
        <div class="text-sm opacity-70">
          {t("You do not have permission to view invoices. Contact an administrator to request access.")}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if !canViewCustomers}
  <div class="card bg-base-100 border-base-300 rounded-box mb-4 border">
    <div class="card-body flex flex-row items-center gap-4 p-6">
      <ShieldOff size={24} class="shrink-0 opacity-50" />
      <div>
        <div class="font-semibold">{t("Customer data hidden")}</div>
        <div class="text-sm opacity-70">
          {t("You do not have permission to view customers. Contact an administrator to request access.")}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if data.counts}
  <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Invoices")}</div>
        <div class="text-2xl font-extrabold sm:text-3xl">
          {data.counts.invoices}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Customers")}</div>
        <div class="text-2xl font-extrabold sm:text-3xl">
          {data.counts.customers}
        </div>
      </div>
    </div>
    <a href="/invoices?status=outstanding" class="card bg-base-100 border-base-300 rounded-box border transition-shadow hover:shadow-md">
      <div class="card-body p-4">
        <div class="flex items-center justify-between text-xs opacity-70 sm:text-sm">
          <span>{t("Open Invoices")}</span>
          <ArrowRight size={15} />
        </div>
        <div class="text-2xl font-extrabold sm:text-3xl">
          {(statusCounts.sent || 0) + (statusCounts.overdue || 0)}
        </div>
      </div>
    </a>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Version")}</div>
        <div class="text-2xl font-extrabold sm:text-3xl">{data.version}</div>
      </div>
    </div>
  </div>
{/if}

{#if data.money}
  <div class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Total Billed")}</div>
        <div class="text-xl font-bold sm:text-2xl">
          {fmtMoney(data.money.billed)}
        </div>
      </div>
    </div>
    <a href="/invoices?status=outstanding" class="card bg-base-100 border-base-300 rounded-box border transition-shadow hover:shadow-md">
      <div class="card-body p-4">
        <div class="flex items-center justify-between text-xs opacity-70 sm:text-sm">
          <span>{t("Outstanding")}</span>
          <ArrowRight size={15} />
        </div>
        <div class="text-xl font-bold sm:text-2xl">
          {fmtMoney(data.money.outstanding)}
        </div>
      </div>
    </a>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Paid")}</div>
        <div class="text-xl font-bold sm:text-2xl">
          {fmtMoney(data.money.paid)}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if data.status}
  <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Draft")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.draft || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Sent")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.sent || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Complete")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.complete || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Paid")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.paid || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Overdue")}</div>
        <div class={`text-lg font-semibold sm:text-xl ${statusCounts.overdue > 0 ? "text-error" : ""}`}>
          {statusCounts.overdue || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Voided")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.voided || 0}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if data.kpis || data.lowStock}
  <div class="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
    {#if canViewProfit && data.kpis}
      <div class="card bg-base-100 border-base-300 rounded-box border lg:col-span-2">
        <div class="card-body p-4">
          <div class="mb-3 flex items-center gap-2 font-semibold"><TrendingUp size={16} /> {t("Profit")}</div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div class="text-xs opacity-70">{t("Revenue")}</div>
              <div class="font-bold">{fmtMoney(data.kpis.profit?.revenue)}</div>
            </div>
            <div>
              <div class="text-xs opacity-70">{t("Cost of goods")}</div>
              <div class="font-bold">{fmtMoney(data.kpis.profit?.cogs)}</div>
            </div>
            <div>
              <div class="text-xs opacity-70">{t("Gross Profit")}</div>
              <div class="text-success font-bold">{fmtMoney(data.kpis.profit?.grossProfit)}</div>
            </div>
            <div>
              <div class="text-xs opacity-70">{t("Margin")}</div>
              <div class="font-bold">{data.kpis.profit?.marginPct ?? 0}%</div>
            </div>
          </div>
          <div class="mt-4">
            <div class="mb-2 text-xs opacity-70">{t("Monthly trend")} ({t("last 6 months")})</div>
            <div class="flex h-24 items-end gap-1">
              {#each data.kpis.monthlyTrend || [] as m (m.month)}
                <div class="group flex flex-1 flex-col items-center gap-1">
                  <div class="tooltip w-full" data-tip={`${m.label}: ${fmtMoney(m.billed)}`}>
                    <div class="bg-primary/70 w-full rounded" style={`height: ${Math.max(3, Math.round((m.billed / maxMonthlyBilled) * 80))}px`}></div>
                  </div>
                  <span class="text-[10px] opacity-60">{m.label}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}

    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="mb-3 flex items-center gap-2 font-semibold"><TriangleAlert size={16} /> {t("Low Stock")}</div>
        {#if (data.lowStock || []).length === 0}
          <p class="text-sm opacity-60">{t("All products in stock")}.</p>
        {:else}
          <div class="space-y-2">
            {#each data.lowStock as p (p.id)}
              <a href={`/products/${p.id}`} class="rounded-box bg-base-200 flex items-center justify-between px-3 py-2 text-sm hover:opacity-80">
                <span class="flex items-center gap-2 truncate"><Package size={14} class="shrink-0" />{p.name}</span>
                <span class="badge badge-warning badge-sm">{p.quantityOnHand} {t("left")}</span>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if canViewProfit && (data.kpis.topProducts || []).length > 0}
    <h2 class="mb-3 text-xl font-semibold">{t("Top Products")}</h2>
    <div class="bg-base-100 border-base-300 rounded-box mb-6 overflow-x-auto border">
      <table class="table w-full text-sm">
        <thead class="bg-base-200">
          <tr class="font-medium">
            <th>{t("Product")}</th>
            <th class="text-right">{t("Qty")}</th>
            <th class="text-right">{t("Revenue")}</th>
            <th class="text-right">{t("Profit")}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.kpis.topProducts as tp (tp.productId)}
            <tr class="hover">
              <td><a class="link" href={`/products/${tp.productId}`}>{tp.name}</a></td>
              <td class="text-right tabular-nums">{tp.quantity}</td>
              <td class="text-right tabular-nums">{fmtMoney(tp.revenue)}</td>
              <td class="text-success text-right tabular-nums">{fmtMoney(tp.profit)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}

{#if data.recent && data.recent.length > 0}
  <h2 class="mb-3 text-xl font-semibold">{t("Recent Invoices")}</h2>
  <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
    <table class="table-sm sm:table-md table w-full">
      <thead>
        <tr class="bg-base-200">
          <th>{t("Invoice No")}</th>
          <th>{t("Customer")}</th>
          <th>{t("Total")}</th>
          <th class="hidden sm:table-cell">{t("Status")}</th>
          <th class="text-right">{t("Issue Date")}</th>
        </tr>
      </thead>
      <tbody>
        {#each data.recent as inv (inv.id)}
          <tr class="hover">
            <td class="font-medium hover:underline">
              <a href={`/invoices/${inv.id}`}>{inv.invoiceNumber}</a>
              <div class="text-xs opacity-70 sm:hidden">
                {t(inv.status?.charAt(0).toUpperCase() + (inv.status || "").slice(1))}
              </div>
            </td>
            <td>{inv.customer?.name || ""}</td>
            <td>{fmtMoney(inv.total || 0)}</td>
            <td class="hidden sm:table-cell">
              {#if inv.status === "draft"}
                <div class="badge badge-ghost badge-sm">{t("Draft")}</div>
              {:else if inv.status === "sent"}
                <div class="badge badge-info badge-sm">{t("Sent")}</div>
              {:else if inv.status === "paid"}
                <div class="badge badge-success badge-sm">{t("Paid")}</div>
              {:else if (inv.status as string | undefined) === "complete"}
                <div class="badge badge-secondary badge-sm">
                  {t("Complete")}
                </div>
              {:else if inv.status === "overdue"}
                <div class="badge badge-error badge-sm">{t("Overdue")}</div>
              {:else if inv.status === "voided"}
                <div class="badge badge-neutral badge-sm">{t("Voided")}</div>
              {/if}
            </td>
            <td class="text-right text-sm tabular-nums">
              {#if inv.issueDate}
                {formatDateWithBs(inv.issueDate, dateLocale, data.localization?.dateFormat, { year: "numeric", month: "short", day: "numeric" })}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
