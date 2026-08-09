<script lang="ts">
  import { getContext, untrack } from "svelte";
  import { Plus, X } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { generateId } from "$lib/utils/id";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let customers = $derived(data.customers || []);
  let products = $derived(data.products || []);
  let defaultCurrency = $derived(
    String(data.settings?.currency || "USD")
      .trim()
      .toUpperCase(),
  );

  let currency = $state(untrack(() => defaultCurrency));
  let taxRate = $state(0);
  let discountPercentage = $state(0);
  let items = $state([{ id: generateId(), productId: "", description: "", quantity: 1, unit: "", unitPrice: 0 }]);

  function addItem() {
    items.push({ id: generateId(), productId: "", description: "", quantity: 1, unit: "", unitPrice: 0 });
  }
  function removeItem(i: number) {
    if (items.length > 1) items.splice(i, 1);
  }
  function onProductChange(item: any) {
    const p = products.find((x) => x.id === item.productId);
    if (p) {
      item.description = p.name;
      item.unit = p.unit || "";
      item.unitPrice = Number(p.unitPrice ?? p.unit_price ?? 0);
    }
  }

  let subtotal = $derived(items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0));
  let discount = $derived((subtotal * (Number(discountPercentage) || 0)) / 100);
  let afterDiscount = $derived(subtotal - discount);
  let tax = $derived((afterDiscount * (Number(taxRate) || 0)) / 100);
  let total = $derived(afterDiscount + tax);

  function fmtMoney(n: number) {
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, data.localization?.numberFormat), { style: "currency", currency }).format(n || 0);
    } catch {
      return `${currency} ${Number(n || 0).toFixed(2)}`;
    }
  }
</script>

<div class="mx-auto max-w-3xl">
  <h1 class="mb-4 text-2xl font-semibold">{t("New Quote")}</h1>
  {#if form?.error}
    <div class="alert alert-error mb-3"><span>{form.error}</span></div>
  {/if}

  <form method="POST" use:enhance class="card bg-base-100 border-base-300 space-y-4 border p-6">
    <input
      type="hidden"
      name="items"
      value={JSON.stringify(
        items.map((i) => ({ productId: i.productId || undefined, description: i.description, quantity: Number(i.quantity) || 0, unit: i.unit || undefined, unitPrice: Number(i.unitPrice) || 0 })),
      )}
    />
    <input type="hidden" name="currency" value={currency} />
    <input type="hidden" name="taxRate" value={taxRate} />
    <input type="hidden" name="discountPercentage" value={discountPercentage} />

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <label class="form-control sm:col-span-2">
        <span class="label-text mb-1">{t("Customer")} <span class="text-error">*</span></span>
        <select name="customerId" class="select select-bordered" required>
          <option value="">{t("Select customer")}</option>
          {#each customers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Issue Date")}</span>
        <input name="issueDate" type="date" class="input input-bordered" value={new Date().toISOString().slice(0, 10)} required />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Expiry")}</span>
        <input name="expiryDate" type="date" class="input input-bordered" />
      </label>
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm font-semibold">{t("Items")}</span>
        <button type="button" class="btn btn-sm" onclick={addItem}><Plus size={15} /> {t("Add item")}</button>
      </div>
      <div class="space-y-2">
        {#each items as item, i (item.id)}
          <div class="flex flex-nowrap items-center gap-2">
            <select class="select select-bordered w-44 shrink-0" bind:value={item.productId} onchange={() => onProductChange(item)}>
              <option value="">{t("Product")}</option>
              {#each products as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
            <input class="input input-bordered w-full min-w-0" bind:value={item.description} placeholder={t("Description")} required />
            <input type="number" min="0" step="any" class="input input-bordered w-16 shrink-0 text-center" bind:value={item.quantity} />
            <input class="input input-bordered w-20 shrink-0 text-center" bind:value={item.unit} placeholder={t("Unit")} />
            <input type="number" min="0" step="any" class="input input-bordered w-24 shrink-0 text-center" bind:value={item.unitPrice} placeholder={t("Price")} />
            <button type="button" class="btn btn-ghost btn-sm btn-square shrink-0" onclick={() => removeItem(i)}><X size={15} /></button>
          </div>
        {/each}
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label class="form-control">
        <span class="label-text mb-1">{t("Currency")}</span>
        <input class="input input-bordered" bind:value={currency} />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Discount %")}</span>
        <input type="number" min="0" step="any" class="input input-bordered" bind:value={discountPercentage} />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Tax Rate (%)")}</span>
        <input type="number" min="0" step="any" class="input input-bordered" bind:value={taxRate} />
      </label>
    </div>

    <div class="flex flex-col items-end gap-1 text-sm">
      <div class="flex w-56 justify-between"><span>{t("Subtotal")}:</span><span>{fmtMoney(subtotal)}</span></div>
      {#if discount > 0}<div class="flex w-56 justify-between"><span>{t("Discount")}:</span><span>−{fmtMoney(discount)}</span></div>{/if}
      {#if tax > 0}<div class="flex w-56 justify-between"><span>{t("Tax")}:</span><span>{fmtMoney(tax)}</span></div>{/if}
      <div class="flex w-56 justify-between text-lg font-bold"><span>{t("Total")}:</span><span>{fmtMoney(total)}</span></div>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="form-control"><span class="label-text mb-1">{t("Payment Terms")}</span><input name="paymentTerms" class="input input-bordered" /></label>
      <label class="form-control"><span class="label-text mb-1">{t("Notes")}</span><input name="notes" class="input input-bordered" /></label>
    </div>

    <div class="flex justify-end gap-2">
      <a href="/quotes" class="btn btn-ghost">{t("Cancel")}</a>
      <button type="submit" class="btn btn-primary">{t("Create Quote")}</button>
    </div>
  </form>
</div>
