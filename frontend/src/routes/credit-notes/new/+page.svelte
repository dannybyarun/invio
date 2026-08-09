<script lang="ts">
  import { getContext } from "svelte";
  import { Undo2 } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let invoice = $derived(data.invoice as any);
  let customers = $derived(data.customers || []);
  let defaultCustomerId = $derived(invoice?.customerId || "");
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

<div class="mx-auto max-w-3xl">
  <h1 class="mb-4 text-2xl font-semibold">{t("New Credit Note")}</h1>
  {#if form?.error}
    <div class="alert alert-error mb-3"><span>{form.error}</span></div>
  {/if}

  {#if invoice}
    <div class="alert alert-info mb-4 flex items-center gap-2">
      <Undo2 size={16} />
      {t("Return for invoice")} <strong>{invoice.invoiceNumber}</strong> — {t("Customer")}: {invoice.customer?.name}
    </div>
  {/if}

  <form method="POST" use:enhance class="card bg-base-100 border-base-300 space-y-4 border p-6">
    <input type="hidden" name="invoiceId" value={invoice?.id || ""} />

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="form-control">
        <span class="label-text mb-1">{t("Customer")} <span class="text-error">*</span></span>
        <select name="customerId" class="select select-bordered" required>
          <option value="">{t("Select customer")}</option>
          {#each customers as c (c.id)}
            <option value={c.id} selected={c.id === defaultCustomerId}>{c.name}</option>
          {/each}
        </select>
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Date")}</span>
        <input name="issueDate" type="date" class="input input-bordered" value={new Date().toISOString().slice(0, 10)} required />
      </label>
    </div>

    <div>
      <div class="mb-2 text-sm font-semibold">{t("Items being returned")}</div>
      <div class="space-y-2">
        {#if (invoice?.items || []).length > 0}
          {#each invoice.items as it (it.id)}
            <div class="flex flex-nowrap items-center gap-2">
              <input type="hidden" name="productId" value={it.productId || ""} />
              <input class="input input-bordered w-full min-w-0" name="description" value={it.description} />
              <input type="number" min="0" step="any" class="input input-bordered w-20 shrink-0 text-center" name="quantity" value={it.quantity} />
              <input type="number" min="0" step="any" class="input input-bordered w-28 shrink-0 text-center" name="unitPrice" value={it.unitPrice} />
            </div>
          {/each}
        {:else}
          <div class="flex flex-nowrap items-center gap-2">
            <input class="input input-bordered w-full min-w-0" name="description" placeholder={t("Description")} />
            <input type="number" min="0" step="any" class="input input-bordered w-20 shrink-0 text-center" name="quantity" value="1" />
            <input type="number" min="0" step="any" class="input input-bordered w-28 shrink-0 text-center" name="unitPrice" placeholder={t("Price")} />
          </div>
        {/if}
      </div>
      <p class="mt-2 text-xs opacity-60">{t("Lines are grouped by description when saved.")}</p>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="form-control">
        <span class="label-text mb-1">{t("Tax Rate (%)")}</span>
        <input name="taxRate" type="number" min="0" step="any" class="input input-bordered" value={invoice?.taxRate || 0} />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Reason")}</span>
        <input name="reason" class="input input-bordered" placeholder={t("e.g. Damaged goods, customer return")} />
      </label>
    </div>

    <div class="flex justify-end gap-2">
      <a href="/credit-notes" class="btn btn-ghost">{t("Cancel")}</a>
      <button type="submit" class="btn btn-primary"><Undo2 size={16} /> {t("Create Credit Note")}</button>
    </div>
  </form>
</div>
