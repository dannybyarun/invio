<script lang="ts">
  import { getContext } from "svelte";
  import { Plus, X } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { generateId } from "$lib/utils/id";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let suppliers = $derived(data.suppliers || []);
  let products = $derived(data.products || []);

  let items = $state([{ id: generateId(), productId: "", description: "", quantity: 1, unitPrice: 0 }]);

  function addItem() {
    items.push({ id: generateId(), productId: "", description: "", quantity: 1, unitPrice: 0 });
  }
  function removeItem(i: number) {
    if (items.length > 1) items.splice(i, 1);
  }
  function onProductChange(item: any) {
    const p = products.find((x) => x.id === item.productId);
    if (p) {
      item.description = p.name;
      item.unitPrice = Number(p.unitPrice ?? p.unit_price ?? 0);
    }
  }
  let subtotal = $derived(items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0));
  let taxRate = $state(0);
  let tax = $derived((subtotal * (Number(taxRate) || 0)) / 100);
  let total = $derived(subtotal + tax);
</script>

<div class="mx-auto max-w-3xl">
  <h1 class="mb-4 text-2xl font-semibold">{t("New Purchase Order")}</h1>
  {#if form?.error}
    <div class="alert alert-error mb-3"><span>{form.error}</span></div>
  {/if}

  <form method="POST" use:enhance class="card bg-base-100 border-base-300 space-y-4 border p-6">
    <input
      type="hidden"
      name="items"
      value={JSON.stringify(items.map((i) => ({ productId: i.productId || undefined, description: i.description, quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0 })))}
    />
    <input type="hidden" name="taxRate" value={taxRate} />

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label class="form-control sm:col-span-2">
        <span class="label-text mb-1">{t("Supplier")}</span>
        <select name="supplierId" class="select select-bordered">
          <option value="">{t("Select supplier")}</option>
          {#each suppliers as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Order Date")}</span>
        <input name="orderDate" type="date" class="input input-bordered" value={new Date().toISOString().slice(0, 10)} required />
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
            <input type="number" min="0" step="any" class="input input-bordered w-20 shrink-0 text-center" bind:value={item.quantity} />
            <input type="number" min="0" step="any" class="input input-bordered w-28 shrink-0 text-center" bind:value={item.unitPrice} placeholder={t("Unit Price")} />
            <button type="button" class="btn btn-ghost btn-sm btn-square shrink-0" onclick={() => removeItem(i)}><X size={15} /></button>
          </div>
        {/each}
      </div>

      <div class="mt-4 flex flex-col items-end gap-1 text-sm">
        <div class="flex w-48 justify-between"><span>{t("Subtotal")}:</span><span>{Number(subtotal).toFixed(2)}</span></div>
        <div class="flex w-48 justify-between"><span>{t("Tax")}:</span><span>{Number(tax).toFixed(2)}</span></div>
        <div class="flex w-48 justify-between font-bold"><span>{t("Total")}:</span><span>{Number(total).toFixed(2)}</span></div>
      </div>
    </div>

    <label class="form-control">
      <span class="label-text mb-1">{t("Notes")}</span>
      <textarea name="notes" class="textarea textarea-bordered h-20"></textarea>
    </label>

    <div class="flex justify-end gap-2">
      <a href="/purchase-orders" class="btn btn-ghost">{t("Cancel")}</a>
      <button type="submit" class="btn btn-primary">{t("Create Purchase Order")}</button>
    </div>
  </form>
</div>
