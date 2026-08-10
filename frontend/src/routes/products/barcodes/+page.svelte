<script lang="ts">
  import { ArrowLeft, Printer } from "lucide-svelte";
  import { getContext } from "svelte";
  import { SvelteSet } from "svelte/reactivity";

  let { data } = $props();
  const t = getContext("i18n") as (key: string) => string;
  let products = $derived((data.products || []).filter((product: any) => product.barcode));
  let selected = new SvelteSet<string>();
  let selectionInitialized = $state(false);

  $effect(() => {
    if (selectionInitialized) return;
    selectionInitialized = true;
    const productId = data.selectedProductId;
    if (productId) selected.add(String(productId));
  });

  function toggle(id: string) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }

  function selectAll() {
    selected.clear();
    for (const product of products) selected.add(String(product.id));
  }

  let printable = $derived(selected.size ? products.filter((product: any) => selected.has(String(product.id))) : products);
</script>

<svelte:head><title>{t("Print product barcodes")}</title></svelte:head>

<div class="no-print mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <a href="/products" class="btn btn-ghost btn-sm mb-2 gap-2"><ArrowLeft size={16} /> {t("Products")}</a>
    <h1 class="text-2xl font-semibold">{t("Print product barcodes")}</h1>
    <p class="mt-1 text-sm opacity-70">{t("Select products, then print labels for your own products.")}</p>
  </div>
  <button type="button" class="btn btn-primary gap-2" onclick={() => window.print()} disabled={!printable.length}><Printer size={16} /> {t("Print labels")}</button>
</div>

{#if data.error}<div class="no-print alert alert-error mb-4"><span>{data.error}</span></div>{/if}

<div class="no-print bg-base-100 border-base-300 rounded-box mb-5 border p-4">
  <div class="mb-3 flex flex-wrap gap-2">
    <button type="button" class="btn btn-sm btn-outline" onclick={selectAll}>{t("Select all")}</button>
    <button type="button" class="btn btn-sm btn-ghost" onclick={() => selected.clear()}>{t("Clear selection")}</button>
    <span class="self-center text-sm opacity-70">{selected.size ? `${selected.size} ${t("selected")}` : t("All products will print")}</span>
  </div>
  <div class="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
    {#each products as product (product.id)}
      <label class="border-base-300 hover:bg-base-200 flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm">
        <input type="checkbox" class="checkbox checkbox-sm" checked={selected.has(String(product.id))} onchange={() => toggle(String(product.id))} />
        <span class="min-w-0 flex-1 truncate">{product.name}</span>
        <span class="font-mono text-xs opacity-60">{product.barcode}</span>
      </label>
    {:else}<p class="text-sm opacity-70">{t("No products have barcodes yet")}</p>{/each}
  </div>
</div>

<div class="labels-grid">
  {#each printable as product (product.id)}
    <div class="barcode-label">
      <div class="label-name">{product.name}</div>
      <img src={`/api/v1/products/${product.id}/barcode.svg`} alt={`${t("Barcode")} ${product.barcode}`} />
      <div class="label-meta">{product.sku || product.unit || ""}</div>
    </div>
  {/each}
</div>

<style>
  .labels-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.18in;
  }
  .barcode-label {
    min-height: 1.1in;
    break-inside: avoid;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0.08in;
    border: 1px dashed color-mix(in srgb, currentColor 24%, transparent);
    background: white;
    color: black;
  }
  .barcode-label img {
    width: 100%;
    height: 0.68in;
    object-fit: contain;
  }
  .label-name {
    max-width: 100%;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9pt;
    font-weight: 600;
  }
  .label-meta {
    font-size: 7pt;
    opacity: 0.7;
  }
  @media print {
    :global(body) {
      background: white !important;
    }
    :global(.navbar),
    :global(.breadcrumbs),
    :global(.no-print) {
      display: none !important;
    }
    .labels-grid {
      grid-template-columns: repeat(3, 1fr);
      gap: 0.12in;
    }
    .barcode-label {
      border-color: transparent;
    }
    @page {
      size: A4;
      margin: 0.3in;
    }
  }
</style>
