<script lang="ts">
  import { getContext } from "svelte";
  import { Plus } from "lucide-svelte";
  import { hasPermission } from "$lib/types";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canCreate = $derived(hasPermission(user, "purchase_orders", "create"));
  let pos = $derived(data.purchaseOrders || []);
  let currency = $derived(
    String(data.settings?.currency || "USD")
      .trim()
      .toUpperCase(),
  );

  function fmtMoney(n: number) {
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, data.localization?.numberFormat), { style: "currency", currency }).format(n || 0);
    } catch {
      return `${currency} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function statusBadge(s: string) {
    const map: Record<string, string> = {
      draft: "badge-ghost",
      ordered: "badge-info",
      received: "badge-success",
      voided: "badge-error",
    };
    return map[s] || "badge-ghost";
  }
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Purchase Orders")}</h1>
  {#if canCreate}
    <a href="/purchase-orders/new" class="btn btn-primary btn-sm w-full sm:w-auto"><Plus size={16} /> {t("New Purchase Order")}</a>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-3"><span>{data.error}</span></div>
{/if}

<div class="rounded-box bg-base-100 border-base-300 hidden overflow-x-auto border md:block">
  <table class="table-zebra table w-full text-sm">
    <thead class="bg-base-200 text-base-content">
      <tr class="font-medium">
        <th>{t("PO Number")}</th>
        <th>{t("Supplier")}</th>
        <th>{t("Date")}</th>
        <th>{t("Status")}</th>
        <th class="text-right">{t("Total")}</th>
      </tr>
    </thead>
    <tbody>
      {#each pos as po (po.id)}
        <tr class="hover">
          <td><a class="link" href={`/purchase-orders/${po.id}`}>{po.poNumber}</a></td>
          <td class="opacity-70">{po.supplierName || "—"}</td>
          <td class="opacity-70">{po.orderDate}</td>
          <td><span class="badge {statusBadge(po.status)}">{t(po.status[0].toUpperCase() + po.status.slice(1))}</span></td>
          <td class="text-right font-medium">{fmtMoney(po.total)}</td>
        </tr>
      {/each}
      {#if pos.length === 0}
        <tr><td colspan="5" class="py-10 text-center text-sm opacity-70">{t("No purchase orders yet")}.</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<div class="block space-y-3 md:hidden">
  {#each pos as po (po.id)}
    <a href={`/purchase-orders/${po.id}`} class="card bg-base-100 border-base-300 border">
      <div class="card-body p-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-semibold">{po.poNumber}</div>
            <div class="text-sm opacity-70">{po.supplierName || "—"} · {po.orderDate}</div>
          </div>
          <div class="text-right">
            <span class="badge {statusBadge(po.status)}">{t(po.status[0].toUpperCase() + po.status.slice(1))}</span>
            <div class="mt-1 font-semibold">{fmtMoney(po.total)}</div>
          </div>
        </div>
      </div>
    </a>
  {/each}
  {#if pos.length === 0}
    <div class="card bg-base-100 border-base-300 border"><div class="card-body py-10 text-center text-sm opacity-70">{t("No purchase orders yet")}.</div></div>
  {/if}
</div>
