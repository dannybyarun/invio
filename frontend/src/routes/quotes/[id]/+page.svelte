<script lang="ts">
  import { getContext } from "svelte";
  import { CopyPlus, FilePlus2, Trash2, TriangleAlert } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { hasPermission } from "$lib/types";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canUpdate = $derived(hasPermission(user, "quotes", "update"));
  let canDelete = $derived(hasPermission(user, "quotes", "delete"));
  let q = $derived(data.quote);

  function fmtMoney(cur: string | undefined, n: number) {
    const c = String(cur || "USD")
      .trim()
      .toUpperCase();
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, data.localization?.numberFormat), { style: "currency", currency: c }).format(n || 0);
    } catch {
      return `${c} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function statusBadge(s: string) {
    const map: Record<string, string> = {
      draft: "badge-ghost",
      sent: "badge-info",
      accepted: "badge-success",
      declined: "badge-error",
      converted: "badge-primary",
    };
    return map[s] || "badge-ghost";
  }
</script>

{#if form?.error || data.error}
  <div class="alert alert-error mb-4"><span>{form?.error || data.error}</span></div>
{/if}
{#if form?.success}
  <div class="alert alert-success mb-4"><span>{t("Saved")}</span></div>
{/if}

{#if q}
  <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">{q.quoteNumber}</h1>
      <p class="text-sm opacity-60">{q.customer?.name || "—"} · {t("Issue")}: {q.issueDate}{q.expiryDate ? ` · ${t("Expiry")}: ${q.expiryDate}` : ""}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if q.status === "draft"}
        {#if canUpdate}
          <form method="POST" action="?/status"><input type="hidden" name="status" value="sent" /><button class="btn btn-sm" type="submit">{t("Mark Sent")}</button></form>
          <form method="POST" action="?/status"><input type="hidden" name="status" value="accepted" /><button class="btn btn-sm" type="submit">{t("Mark Accepted")}</button></form>
        {/if}
      {/if}
      {#if q.status === "draft" || q.status === "sent" || q.status === "accepted"}
        {#if canUpdate}
          <form method="POST" action="?/convert" use:enhance>
            <button type="submit" class="btn btn-sm btn-primary" onclick={() => confirm(t("Convert this quote into an invoice?"))}>
              <FilePlus2 size={16} />
              {t("Convert to Invoice")}
            </button>
          </form>
        {/if}
      {/if}
      {#if q.convertedInvoiceId}
        <a href={`/invoices/${q.convertedInvoiceId}`} class="btn btn-sm btn-outline">{t("View Invoice")}</a>
      {/if}
      {#if canUpdate && q.status !== "converted"}
        <button
          type="button"
          class="btn btn-sm btn-outline"
          title={t("Create a new quote from this one")}
          onclick={async () => {
            try {
              const res = await fetch(`/api/v1/quotes/${q.id}/duplicate`, { method: "POST" });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error || t("Failed to re-quote"));
              goto(`/quotes/${body.id}`);
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <CopyPlus size={16} />
          {t("Re-quote")}
        </button>
      {/if}
      {#if canDelete && q.status !== "converted"}
        <form method="POST" action="?/delete" use:enhance>
          <button type="submit" class="btn btn-sm btn-error" onclick={() => confirm(t("Delete this quote?"))}><Trash2 size={16} /> {t("Delete")}</button>
        </form>
      {/if}
    </div>
  </div>

  <div class="mb-4 flex items-center gap-2">
    <span class="badge {statusBadge(q.status)}">{t(q.status[0].toUpperCase() + q.status.slice(1))}</span>
    {#if q.isExpired && q.status !== "converted"}
      <span class="badge badge-error badge-outline gap-1"><TriangleAlert size={12} />{t("Expired")}</span>
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
        {#each q.items || [] as it (it.id)}
          <tr>
            <td>{it.description}{it.unit ? ` (${it.unit})` : ""}</td>
            <td class="text-right">{it.quantity}</td>
            <td class="text-right">{fmtMoney(q.currency, it.unitPrice)}</td>
            <td class="text-right font-medium">{fmtMoney(q.currency, it.lineTotal)}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot class="bg-base-200 font-medium">
        <tr><td colspan="3" class="text-right">{t("Subtotal")}:</td><td class="text-right">{fmtMoney(q.currency, q.subtotal)}</td></tr>
        {#if q.discountAmount > 0}<tr><td colspan="3" class="text-right">{t("Discount")}:</td><td class="text-right">−{fmtMoney(q.currency, q.discountAmount)}</td></tr>{/if}
        {#if q.taxAmount > 0}<tr><td colspan="3" class="text-right">{t("Tax")}:</td><td class="text-right">{fmtMoney(q.currency, q.taxAmount)}</td></tr>{/if}
        <tr><td colspan="3" class="text-right">{t("Total")}:</td><td class="text-right">{fmtMoney(q.currency, q.total)}</td></tr>
      </tfoot>
    </table>
  </div>

  {#if q.notes || q.paymentTerms}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {#if q.notes}
        <div class="bg-base-100 rounded-box border-base-300 mt-4 border p-4 text-sm">
          <div class="mb-1 font-semibold">{t("Notes")}</div>
          <div class="whitespace-pre-wrap opacity-70">{q.notes}</div>
        </div>
      {/if}
      {#if q.paymentTerms}
        <div class="bg-base-100 rounded-box border-base-300 mt-4 border p-4 text-sm">
          <div class="mb-1 font-semibold">{t("Payment Terms")}</div>
          <div class="whitespace-pre-wrap opacity-70">{q.paymentTerms}</div>
        </div>
      {/if}
    </div>
  {/if}
{/if}
