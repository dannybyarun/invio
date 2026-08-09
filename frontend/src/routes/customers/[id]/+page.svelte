<script lang="ts">
  import { getContext } from "svelte";
  import { Pencil, Trash2 } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { hasPermission } from "$lib/types";
  import { formatPostalCityLine } from "$lib/address";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  const getLoc = getContext("localization") as () => any;

  let c = $derived(data.customer);
  let user = $derived(data.user);
  let canUpdate = $derived(hasPermission(user, "customers", "update"));
  let canDelete = $derived(hasPermission(user, "customers", "delete"));
  let stmt = $derived(data.statement);
  let currency = $derived(
    String((data as any).settings?.currency || "USD")
      .trim()
      .toUpperCase(),
  );

  function fmtMoney(n: number) {
    const loc = getLoc?.() || {};
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n || 0);
    } catch {
      return `${currency} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function confirmDelete(): SubmitFunction {
    return ({ cancel }) => {
      if (!confirm(t("Are you sure you want to delete this customer? This cannot be undone."))) cancel();
    };
  }
</script>

{#if form?.error || data.error}
  <div class="alert alert-error mb-4">
    <span>{form?.error || data.error}</span>
  </div>
{/if}

{#if c}
  <div class="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
    <div>
      <h1 class="text-2xl font-semibold">{t("Customer")} {c.name || c.id}</h1>
    </div>

    <div class="flex flex-wrap gap-2">
      {#if canUpdate}
        <a href={`/customers/${c.id}/edit`} class="btn btn-sm">
          <Pencil size={16} />
          {t("Edit")}
        </a>
      {/if}

      {#if canDelete}
        <form method="post" action="?/delete" use:enhance={confirmDelete()}>
          <button type="submit" class="btn btn-sm btn-error">
            <Trash2 size={16} />
            {t("Delete")}
          </button>
        </form>
      {/if}
    </div>
  </div>

  {#if stmt}
    <div class="bg-base-100 rounded-box border-base-200 mb-6 border p-6">
      <h2 class="mb-4 text-lg font-semibold">{t("Statement")}</h2>
      <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="stat">
          <div class="stat-title">{t("Billed")}</div>
          <div class="stat-value text-base">{fmtMoney(stmt.totalBilled)}</div>
        </div>
        <div class="stat">
          <div class="stat-title">{t("Paid")}</div>
          <div class="stat-value text-success text-base">{fmtMoney(stmt.totalPaid)}</div>
        </div>
        <div class="stat">
          <div class="stat-title">{t("Credited")}</div>
          <div class="stat-value text-base">{fmtMoney(stmt.totalCredited)}</div>
        </div>
        <div class="stat">
          <div class="stat-title">{t("Outstanding")}</div>
          <div class="stat-value text-base {stmt.outstanding > 0 ? 'text-error' : 'text-success'}">{fmtMoney(stmt.outstanding)}</div>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="table w-full text-sm">
          <thead class="bg-base-200">
            <tr class="font-medium">
              <th>{t("Invoice")}</th>
              <th>{t("Date")}</th>
              <th>{t("Due")}</th>
              <th>{t("Status")}</th>
              <th class="text-right">{t("Total")}</th>
              <th class="text-right">{t("Paid")}</th>
              <th class="text-right">{t("Balance")}</th>
            </tr>
          </thead>
          <tbody>
            {#each stmt.entries as e (e.invoiceId)}
              <tr class="hover">
                <td><a class="link" href={`/invoices/${e.invoiceId}`}>{e.invoiceNumber}</a></td>
                <td>{e.issueDate}</td>
                <td class="opacity-70">{e.dueDate || "—"}</td>
                <td><span class="badge badge-ghost badge-sm">{t(e.status[0].toUpperCase() + e.status.slice(1))}</span></td>
                <td class="text-right">{fmtMoney(e.total)}</td>
                <td class="text-right">{fmtMoney(e.paid)}</td>
                <td class="text-right font-medium">{fmtMoney(e.balance)}</td>
              </tr>
            {/each}
            {#if stmt.entries.length === 0}
              <tr><td colspan="7" class="py-6 text-center text-sm opacity-70">{t("No issued invoices yet")}.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <div class="bg-base-100 rounded-box border-base-200 border p-6">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <div class="mb-1 text-sm opacity-70">{t("Name")}</div>
        <div class="font-medium">{c.name || "-"}</div>
      </div>
      <div>
        <div class="mb-1 text-sm opacity-70">{t("Contact Name")}</div>
        <div class="font-medium">{c.contactName || "-"}</div>
      </div>
      <div>
        <div class="mb-1 text-sm opacity-70">{t("Email")}</div>
        <div class="font-medium">{c.email || "-"}</div>
      </div>
      <div>
        <div class="mb-1 text-sm opacity-70">{t("Phone")}</div>
        <div class="font-medium">{c.phone || "-"}</div>
      </div>
      <div>
        <div class="mb-1 text-sm opacity-70">{t("Address")}</div>
        <div class="font-medium whitespace-pre-wrap">{c.address || "-"}</div>
      </div>
      <div>
        <div class="mb-1 text-sm opacity-70">
          {t("City")} / {t("Postal Code")}
        </div>
        <div class="font-medium">{formatPostalCityLine(c.city, c.postalCode, c.countryCode, getLoc()?.postalCityFormat) || "-"}</div>
      </div>
      <div>
        <div class="mb-1 text-sm opacity-70">{t("Tax ID")}</div>
        <div class="font-medium">{c.taxId || "-"}</div>
      </div>
      <div>
        <div class="mb-1 text-sm opacity-70">{t("Country Code")}</div>
        <div class="font-medium">{c.countryCode || "-"}</div>
      </div>
    </div>
  </div>
{/if}
