<script lang="ts">
  import { getContext } from "svelte";
  import { CheckCircle2, Trash2, XCircle } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { hasPermission } from "$lib/types";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canUpdate = $derived(hasPermission(user, "purchase_orders", "update"));
  let canDelete = $derived(hasPermission(user, "purchase_orders", "delete"));
  let po = $derived(data.po);
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
</script>

{#if form?.error || data.error}
  <div class="alert alert-error mb-4"><span>{form?.error || data.error}</span></div>
{/if}
{#if form?.success}
  <div class="alert alert-success mb-4"><span>{t("Saved")}</span></div>
{/if}

{#if po}
  <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">{po.poNumber}</h1>
      <p class="text-sm opacity-60">{t("Supplier")}: {po.supplierName || "—"} · {po.orderDate}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if po.status === "draft" || po.status === "ordered"}
        {#if canUpdate}
          <form method="POST" action="?/receive" use:enhance>
            <button type="submit" class="btn btn-sm btn-success" onclick={() => confirm(t("Mark as received? Stock will be added."))}>
              <CheckCircle2 size={16} />
              {t("Receive Stock")}
            </button>
          </form>
          <form method="POST" action="?/void" use:enhance>
            <button type="submit" class="btn btn-sm btn-ghost" onclick={() => confirm(t("Void this purchase order?"))}>
              <XCircle size={16} />
              {t("Void")}
            </button>
          </form>
        {/if}
      {/if}
      {#if canDelete && po.status !== "received"}
        <form method="POST" action="?/delete" use:enhance>
          <button type="submit" class="btn btn-sm btn-error" onclick={() => confirm(t("Delete this purchase order?"))}>
            <Trash2 size={16} />
            {t("Delete")}
          </button>
        </form>
      {/if}
    </div>
  </div>

  <div class="mb-4 flex gap-2">
    <span class="badge badge-ghost">{t("Status")}: {t(po.status[0].toUpperCase() + po.status.slice(1))}</span>
    {#if po.receivedAt}
      <span class="badge badge-success">{t("Received")}: {po.receivedAt.slice(0, 10)}</span>
    {/if}
  </div>

  <div class="rounded-box bg-base-100 border-base-300 overflow-x-auto border">
    <table class="table w-full text-sm">
      <thead class="bg-base-200">
        <tr class="font-medium">
          <th>{t("Description")}</th>
          <th class="text-right">{t("Quantity")}</th>
          <th class="text-right">{t("Unit Price")}</th>
          <th class="text-right">{t("Line Total")}</th>
        </tr>
      </thead>
      <tbody>
        {#each po.items || [] as it (it.id)}
          <tr>
            <td>{it.description}</td>
            <td class="text-right">{it.quantity}</td>
            <td class="text-right">{fmtMoney(it.unitPrice)}</td>
            <td class="text-right font-medium">{fmtMoney(it.lineTotal)}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot class="bg-base-200 font-medium">
        <tr>
          <td colspan="3" class="text-right">{t("Total")}:</td>
          <td class="text-right">{fmtMoney(po.total)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  {#if po.notes}
    <div class="bg-base-100 rounded-box border-base-300 mt-4 border p-4 text-sm">
      <div class="mb-1 font-semibold">{t("Notes")}</div>
      <div class="whitespace-pre-wrap opacity-70">{po.notes}</div>
    </div>
  {/if}
{/if}
