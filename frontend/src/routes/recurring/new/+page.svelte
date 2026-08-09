<script lang="ts">
  import { getContext } from "svelte";
  import { Plus, X } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { generateId } from "$lib/utils/id";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let customers = $derived(data.customers || []);
  let products = $derived(data.products || []);

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
</script>

<div class="mx-auto max-w-3xl">
  <h1 class="mb-4 text-2xl font-semibold">{t("New Recurring Invoice")}</h1>
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

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label class="form-control">
        <span class="label-text mb-1">{t("Name")} <span class="text-error">*</span></span>
        <input name="name" class="input input-bordered" placeholder={t("e.g. Monthly rent")} required />
      </label>
      <label class="form-control sm:col-span-2">
        <span class="label-text mb-1">{t("Customer")} <span class="text-error">*</span></span>
        <select name="customerId" class="select select-bordered" required>
          <option value="">{t("Select customer")}</option>
          {#each customers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Frequency")}</span>
        <select name="frequency" class="select select-bordered">
          <option value="monthly">{t("Monthly")}</option>
          <option value="weekly">{t("Weekly")}</option>
          <option value="daily">{t("Daily")}</option>
          <option value="yearly">{t("Yearly")}</option>
        </select>
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Interval")}</span>
        <input name="intervalCount" type="number" min="1" class="input input-bordered" value="1" />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Next Run")}</span>
        <input name="nextRunDate" type="date" class="input input-bordered" value={new Date().toISOString().slice(0, 10)} />
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
            <input type="number" min="0" step="any" class="input input-bordered w-24 shrink-0 text-center" bind:value={item.unitPrice} placeholder={t("Price")} />
            <button type="button" class="btn btn-ghost btn-sm btn-square shrink-0" onclick={() => removeItem(i)}><X size={15} /></button>
          </div>
        {/each}
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="form-control">
        <span class="label-text mb-1">{t("Created as")}</span>
        <select name="defaultStatus" class="select select-bordered">
          <option value="draft">{t("Draft")}</option>
          <option value="sent">{t("Sent")}</option>
        </select>
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("End Date")}</span>
        <input name="endDate" type="date" class="input input-bordered" />
      </label>
    </div>

    <div class="flex justify-end gap-2">
      <a href="/recurring" class="btn btn-ghost">{t("Cancel")}</a>
      <button type="submit" class="btn btn-primary">{t("Create Recurring")}</button>
    </div>
  </form>
</div>
