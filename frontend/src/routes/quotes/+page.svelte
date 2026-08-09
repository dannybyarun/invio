<script lang="ts">
  import { getContext } from "svelte";
  import { FileText, Plus } from "lucide-svelte";
  import { hasPermission } from "$lib/types";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canCreate = $derived(hasPermission(user, "quotes", "create"));
  let quotes = $derived(data.quotes || []);
  let currency = $derived(
    String(data.settings?.currency || "USD")
      .trim()
      .toUpperCase(),
  );

  function fmtMoney(cur: string | undefined, n: number) {
    const c = String(cur || currency)
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

<div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Quotes")}</h1>
  {#if canCreate}
    <a href="/quotes/new" class="btn btn-primary btn-sm w-full sm:w-auto"><Plus size={16} /> {t("New Quote")}</a>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-3"><span>{data.error}</span></div>
{/if}

<div class="rounded-box bg-base-100 border-base-300 hidden overflow-x-auto border md:block">
  <table class="table-zebra table w-full text-sm">
    <thead class="bg-base-200 text-base-content">
      <tr class="font-medium">
        <th>{t("Quote Number")}</th>
        <th>{t("Customer")}</th>
        <th>{t("Issue Date")}</th>
        <th>{t("Expiry")}</th>
        <th>{t("Status")}</th>
        <th class="text-right">{t("Total")}</th>
      </tr>
    </thead>
    <tbody>
      {#each quotes as q (q.id)}
        <tr class="hover">
          <td><a class="link" href={`/quotes/${q.id}`}>{q.quoteNumber}</a></td>
          <td class="opacity-70">{q.customer?.name || "—"}</td>
          <td class="opacity-70">{q.issueDate}</td>
          <td class="opacity-70">{q.expiryDate || "—"}</td>
          <td><span class="badge {statusBadge(q.status)}">{t(q.status[0].toUpperCase() + q.status.slice(1))}</span></td>
          <td class="text-right font-medium">{fmtMoney(q.currency, q.total)}</td>
        </tr>
      {/each}
      {#if quotes.length === 0}
        <tr><td colspan="6" class="py-10 text-center text-sm opacity-70"><span class="inline-flex items-center gap-2"><FileText size={16} />{t("No quotes yet")}.</span></td></tr>
      {/if}
    </tbody>
  </table>
</div>

<div class="block space-y-3 md:hidden">
  {#each quotes as q (q.id)}
    <a href={`/quotes/${q.id}`} class="card bg-base-100 border-base-300 border">
      <div class="card-body p-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-semibold">{q.quoteNumber}</div>
            <div class="text-sm opacity-70">{q.customer?.name || "—"} · {q.issueDate}</div>
          </div>
          <div class="text-right">
            <span class="badge {statusBadge(q.status)}">{t(q.status[0].toUpperCase() + q.status.slice(1))}</span>
            <div class="mt-1 font-semibold">{fmtMoney(q.currency, q.total)}</div>
          </div>
        </div>
      </div>
    </a>
  {/each}
  {#if quotes.length === 0}
    <div class="card bg-base-100 border-base-300 border"><div class="card-body py-10 text-center text-sm opacity-70">{t("No quotes yet")}.</div></div>
  {/if}
</div>
