<script lang="ts">
  import { getContext } from "svelte";
  import { Plus, Undo2 } from "lucide-svelte";
  import { hasPermission } from "$lib/types";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canCreate = $derived(hasPermission(user, "credit_notes", "create"));
  let notes = $derived(data.creditNotes || []);
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
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Credit Notes")}</h1>
  {#if canCreate}
    <a href="/credit-notes/new" class="btn btn-primary btn-sm w-full sm:w-auto"><Plus size={16} /> {t("New Credit Note")}</a>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-3"><span>{data.error}</span></div>
{/if}

<div class="rounded-box bg-base-100 border-base-300 hidden overflow-x-auto border md:block">
  <table class="table-zebra table w-full text-sm">
    <thead class="bg-base-200 text-base-content">
      <tr class="font-medium">
        <th>{t("Credit Number")}</th>
        <th>{t("Invoice")}</th>
        <th>{t("Customer")}</th>
        <th>{t("Date")}</th>
        <th>{t("Status")}</th>
        <th class="text-right">{t("Total")}</th>
      </tr>
    </thead>
    <tbody>
      {#each notes as n (n.id)}
        <tr class="hover">
          <td><a class="link" href={`/credit-notes/${n.id}`}>{n.creditNumber}</a></td>
          <td class="opacity-70">{n.invoiceNumber || "—"}</td>
          <td class="opacity-70">{n.customer?.name || "—"}</td>
          <td class="opacity-70">{n.issueDate}</td>
          <td><span class="badge {n.status === 'voided' ? 'badge-error' : 'badge-success'}">{t(n.status[0].toUpperCase() + n.status.slice(1))}</span></td>
          <td class="text-right font-medium">{fmtMoney(undefined, n.total)}</td>
        </tr>
      {/each}
      {#if notes.length === 0}
        <tr><td colspan="6" class="py-10 text-center text-sm opacity-70"><span class="inline-flex items-center gap-2"><Undo2 size={16} />{t("No credit notes yet")}.</span></td></tr>
      {/if}
    </tbody>
  </table>
</div>

<div class="block space-y-3 md:hidden">
  {#each notes as n (n.id)}
    <a href={`/credit-notes/${n.id}`} class="card bg-base-100 border-base-300 border">
      <div class="card-body p-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-semibold">{n.creditNumber}</div>
            <div class="text-sm opacity-70">{n.customer?.name || "—"} · {n.issueDate}</div>
          </div>
          <div class="text-right">
            <span class="badge {n.status === 'voided' ? 'badge-error' : 'badge-success'}">{t(n.status[0].toUpperCase() + n.status.slice(1))}</span>
            <div class="mt-1 font-semibold">{fmtMoney(undefined, n.total)}</div>
          </div>
        </div>
      </div>
    </a>
  {/each}
  {#if notes.length === 0}
    <div class="card bg-base-100 border-base-300 border"><div class="card-body py-10 text-center text-sm opacity-70">{t("No credit notes yet")}.</div></div>
  {/if}
</div>
