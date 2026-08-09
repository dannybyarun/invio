<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { Barcode, Camera, Plus, Search } from "lucide-svelte";
  import BarcodeScannerModal from "$lib/components/BarcodeScannerModal.svelte";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();
  const t = getContext("i18n") as (key: string) => string;
  const quickSellCart = getContext<{
    items: () => CartItem[];
    add: (product: Product) => void;
    open: () => void;
  }>("quickSellCart");

  type Product = {
    id: string;
    name: string;
    sku?: string;
    barcode?: string;
    unit?: string;
    unitPrice?: number;
    taxDefinitionId?: string;
  };
  type CartItem = Product & { quantity: number };

  let products = $derived((data.products || []) as Product[]);
  let currency = $derived(
    String(data.settings?.currency || "NPR")
      .trim()
      .toUpperCase(),
  );
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let scannerInput = $state("");
  let scannerModalOpen = $state(false);
  let searchInput = $state("");
  let error = $state("");
  let scanner: HTMLInputElement;

  function price(product: Product) {
    return Number(product.unitPrice ?? 0);
  }

  function fmtMoney(value: number) {
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, numberFormat), { style: "currency", currency }).format(value || 0);
    } catch {
      return `${currency} ${Number(value || 0).toFixed(2)}`;
    }
  }

  function addProduct(product: Product) {
    quickSellCart.add(product);
    quickSellCart.open();
    scannerInput = "";
    searchInput = "";
    error = "";
    scanner?.focus();
  }

  async function lookupCode(code: string): Promise<boolean> {
    const normalized = code.trim();
    if (!normalized) return false;
    const product = products.find((p) => p.barcode?.toLowerCase() === normalized.toLowerCase() || p.sku?.toLowerCase() === normalized.toLowerCase());
    if (!product) {
      try {
        const response = await fetch(`/api/v1/products/lookup?code=${encodeURIComponent(normalized)}`);
        if (response.ok) {
          addProduct(await response.json());
          return true;
        }
      } catch {
        // Fall through to the friendly not-found message.
      }
      error = t("No product found for that barcode or SKU");
      scannerInput = "";
      scanner?.focus();
      return false;
    }
    addProduct(product);
    return true;
  }

  function handleScannerKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      queueHardwareScan(scannerInput);
    }
  }

  function handleDetectedCode(code: string) {
    queueHardwareScan(code);
  }

  let visibleProducts = $derived(
    products
      .filter((p) => {
        const q = searchInput.trim().toLowerCase();
        return (
          !q ||
          [p.name, p.sku, p.barcode].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(q),
          )
        );
      })
      .slice(0, 12),
  );
  let hardwareScanQueue = Promise.resolve();

  async function processHardwareScan(code: string): Promise<boolean> {
    const normalized = code.trim();
    if (!normalized) return false;
    const processed = await lookupCode(normalized);
    scanner?.focus();
    return processed;
  }

  function queueHardwareScan(code: string) {
    hardwareScanQueue = hardwareScanQueue
      .then(() => processHardwareScan(code))
      .then((processed) => {
        if (!processed) error = t("No product found for that barcode or SKU");
      })
      .catch((err) => {
        error = err instanceof Error ? err.message : String(err);
      });
  }

  function handleGlobalHardwareScan(event: Event) {
    const code = (event as CustomEvent<string>).detail;
    if (typeof code === "string") queueHardwareScan(code);
  }

  onMount(() => {
    window.addEventListener("invio:hardware-scan", handleGlobalHardwareScan);
    scanner?.focus();
    return () => window.removeEventListener("invio:hardware-scan", handleGlobalHardwareScan);
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "F2") {
      event.preventDefault();
      scanner?.focus();
    }
  }}
/>

<BarcodeScannerModal open={scannerModalOpen} onDetected={handleDetectedCode} />

<div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
  <div>
    <div class="text-primary mb-1 text-sm font-semibold tracking-[0.18em] uppercase">{t("Point of sale")}</div>
    <h1 class="text-3xl font-bold tracking-tight">{t("Quick Sell")}</h1>
    <p class="mt-1 text-sm opacity-70">{t("Scan a barcode or search by SKU to add products quickly.")}</p>
  </div>
  <kbd class="kbd kbd-sm self-start sm:self-auto">F2 {t("Focus scanner")}</kbd>
</div>

{#if error}<div class="alert alert-error mb-4"><span>{error}</span></div>{/if}

<div class="space-y-5">
  <section class="space-y-4">
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body p-4 sm:p-5">
        <label class="input input-lg input-bordered border-primary/50 flex w-full items-center gap-3 shadow-sm" for="scanner-input">
          <Barcode size={22} class="text-primary" />
          <input id="scanner-input" bind:this={scanner} bind:value={scannerInput} onkeydown={handleScannerKeydown} placeholder={t("Scan barcode or enter SKU")} autocomplete="off" />
          <kbd class="kbd kbd-sm hidden sm:inline-flex">Enter</kbd>
          <button type="button" class="btn btn-ghost btn-sm btn-square text-primary" onclick={() => (scannerModalOpen = true)} aria-label={t("Scan with camera")} title={t("Scan with camera")}>
            <Camera size={20} />
          </button>
        </label>
        <div class="divider my-2 text-xs opacity-50">{t("or choose a product")}</div>
        <label class="input input-bordered flex w-full items-center gap-2" for="product-search">
          <Search size={17} class="opacity-60" />
          <input id="product-search" bind:value={searchInput} placeholder={t("Search products, SKU, or barcode")} />
        </label>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each visibleProducts as product (product.id)}
        <button
          type="button"
          class="card bg-base-100 border-base-300 hover:border-primary hover:bg-primary/5 border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          onclick={() => addProduct(product)}
        >
          <div class="card-body gap-1 p-4">
            <div class="flex items-start justify-between gap-3">
              <span class="leading-tight font-semibold">{product.name}</span>
              <Plus size={18} class="text-primary shrink-0" />
            </div>
            <span class="text-primary text-lg font-bold">{fmtMoney(price(product))}</span>
            <span class="text-xs opacity-60">{product.barcode || product.sku || t("No barcode")}</span>
          </div>
        </button>
      {:else}
        <div class="col-span-full rounded-box border border-dashed border-base-300 p-8 text-center text-sm opacity-60">{t("No products found")}</div>
      {/each}
    </div>
  </section>
</div>
