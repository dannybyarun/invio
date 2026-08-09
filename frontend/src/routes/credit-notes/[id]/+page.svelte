<script lang="ts">
  import { getContext } from "svelte";
  import { XCircle } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { hasPermission } from "$lib/types";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canUpdate = $derived(hasPermission(user, "credit_notes", "update"));
  let n = $derived(data.note);
  let currency = $derived(
    String(data.settings?.currency || "USD")
      .trim()
      .toUpperCase(),
  );

  function fmtMoney(n2: number) {
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, data.localization?.numberFormat), { style: "currency", currency }).format(n2 || 0);
    } catch {
      return `${currency} ${Number(n2 || 0).toFixed(2)}`;
    }
  }
</script>

{#if form?.error || data.error}
  <div class="alert alert-error mb-4"><span>{form?.error || data.error}</span></div>
{/if}

{#if n}
  <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">{n.creditNumber}</h1>
      <p class="text-sm opacity-60">
        {n.customer?.name || "—"} · {n.issueDate}
        {#if n.invoiceNumber}
          · {t("Invoice")}: <a class="link" href={`/invoices/${n.invoiceId}`}>{n.invoiceNumber}</a>
        {/if}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <span class="badge {n.status === 'voided' ? 'badge-error' : 'badge-success'}">{t(n.status[0].toUpperCase() + n.status.slice(1))}</span>
      {#if n.status !== "voided" && canUpdate}
        <form method="POST" action="?/void" use:enhance>
          <button type="submit" class="btn btn-sm btn-ghost" onclick={() => confirm(t("Void this credit note? Stock will be returned to inventory."))}>
            <XCircle size={16} />
            {t("Void")}
          </button>
        </form>
      {/if}
    </div>
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
        {#each n.items || [] as it (it.id)}
          <tr>
            <td>{it.description}</td>
            <td class="text-right">{it.quantity}</td>
            <td class="text-right">{fmtMoney(it.unitPrice)}</td>
            <td class="text-right font-medium">{fmtMoney(it.lineTotal)}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot class="bg-base-200 font-medium">
        {#if n.taxAmount > 0}<tr><td colspan="3" class="text-right">{t("Tax")}:</td><td class="text-right">{fmtMoney(n.taxAmount)}</td></tr>{/if}
        <tr><td colspan="3" class="text-right">{t("Total")}:</td><td class="text-right">{fmtMoney(n.total)}</td></tr>
      </tfoot>
    </table>
  </div>

  {#if n.reason}
    <div class="bg-base-100 rounded-box border-base-300 mt-4 border p-4 text-sm">
      <div class="mb-1 font-semibold">{t("Reason")}</div>
      <div class="opacity-70">{n.reason}</div>
    </div>
  {/if}
{/if}
