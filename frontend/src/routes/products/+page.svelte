<script lang="ts">
  import { Download, PackagePlus, TriangleAlert } from "lucide-svelte";
  import { getContext } from "svelte";
  import { numberFormatLocale } from "$lib/utils/dates";
  import { hasPermission } from "$lib/types";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;

  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let user = $derived(data.user);
  let canCreate = $derived(hasPermission(user, "products", "create"));
  let canExport = $derived(hasPermission(user, "products", "read"));
  let products = $derived(data.products || []);
  let lowStockCount = $derived(products.filter((p: any) => (Number(p.reorderLevel) || 0) > 0 && (Number(p.quantityOnHand) || 0) <= Number(p.reorderLevel)).length);

  function getProductPrice(p: { unitPrice?: number; unit_price?: number; price?: number }) {
    return Number(p.unitPrice ?? p.unit_price ?? p.price ?? 0);
  }

  function fmtMoney(cur: string | undefined, n: number) {
    cur = String(data.settings?.currency || cur || "USD")
      .trim()
      .toUpperCase();
    try {
      const locale = numberFormatLocale(data.localization?.locale, numberFormat);
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: cur,
      }).format(n || 0);
    } catch {
      return `${cur} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function isLow(p: any) {
    return (Number(p.reorderLevel) || 0) > 0 && (Number(p.quantityOnHand) || 0) <= Number(p.reorderLevel);
  }
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Products")}</h1>
  <div class="flex flex-wrap items-center gap-2">
    {#if lowStockCount > 0}
      <span class="badge badge-warning gap-1"><TriangleAlert size={13} /> {lowStockCount} {t("low stock")}</span>
    {/if}
    {#if canExport}
      <a href="/api/v1/export/products.csv" class="btn btn-sm btn-outline"><Download size={15} /> CSV</a>
    {/if}
    {#if canCreate}
      <a href="/products/new" class="btn btn-sm btn-primary w-full sm:w-auto">
        <PackagePlus size={16} />
        {t("New Product")}
      </a>
    {/if}
  </div>
</div>

{#if data.error}
  <div class="alert alert-error mb-3">
    <span>{data.error}</span>
  </div>
{/if}

<!-- Mobile List -->
<div class="block space-y-3 md:hidden">
  {#each products as p (p.id)}
    <a href={`/products/${p.id}`} class="card bg-base-100 border-base-300 border transition-shadow hover:shadow-md">
      <div class="card-body p-4">
        <div class="mb-2 flex items-start justify-between">
          <div class="line-clamp-2 pr-2 font-semibold">{p.name || p.id}</div>
          <div class="font-medium whitespace-nowrap">
            {fmtMoney(p.currency, getProductPrice(p))}
          </div>
        </div>
        {#if p.description}
          <div class="line-clamp-2 text-sm opacity-70">{p.description}</div>
        {/if}
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span class="badge badge-ghost">{t("Stock")}: {Number(p.quantityOnHand) || 0}</span>
          {#if isLow(p)}<span class="badge badge-warning gap-1"><TriangleAlert size={11} /> {t("Low")}</span>{/if}
        </div>
      </div>
    </a>
  {/each}
  {#if products.length === 0}
    <div class="card bg-base-100 border-base-300 border">
      <div class="card-body py-10 text-center text-sm opacity-70">
        <span>
          {t("No products yet.")}
          <a href="/products/new" class="link">{t("Create your first product")}</a>.
        </span>
      </div>
    </div>
  {/if}
</div>

<!-- Desktop Table -->
<div class="rounded-box bg-base-100 border-base-300 hidden overflow-x-auto border md:block">
  <table class="table-zebra table w-full text-sm">
    <thead class="bg-base-200 text-base-content">
      <tr class="font-medium">
        <th>{t("Name")}</th>
        <th>{t("Description")}</th>
        <th>{t("Barcode")}</th>
        <th class="text-right">{t("Cost")}</th>
        <th class="text-right">{t("Price")}</th>
        <th class="text-right">{t("Stock")}</th>
      </tr>
    </thead>
    <tbody>
      {#each products as p (p.id)}
        <tr class="hover">
          <td class="max-w-[12rem] truncate">
            <a class="link" href={`/products/${p.id}`}>{p.name || p.id}</a>
          </td>
          <td class="max-w-[16rem] truncate opacity-70">{p.description || ""}</td>
          <td class="text-sm opacity-70">{p.barcode || "-"}</td>
          <td class="text-right opacity-70">{fmtMoney(p.currency, p.costPrice)}</td>
          <td class="pr-2 text-right font-medium">{fmtMoney(p.currency, getProductPrice(p))}</td>
          <td class="pr-4 text-right">
            <span class="badge {isLow(p) ? 'badge-warning gap-1' : 'badge-ghost'}">
              {#if isLow(p)}<TriangleAlert size={11} />{/if}
              {Number(p.quantityOnHand) || 0}
            </span>
          </td>
        </tr>
      {/each}
      {#if products.length === 0}
        <tr>
          <td colspan="6" class="py-10 text-center text-sm opacity-70">
            <span>
              {t("No products yet.")}
              <a href="/products/new" class="link">{t("Create your first product")}</a>.
            </span>
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>
