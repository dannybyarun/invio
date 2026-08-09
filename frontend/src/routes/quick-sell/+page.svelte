<script lang="ts">
  import { getContext, onMount, tick } from "svelte";
  import { Barcode, Camera, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-svelte";
  import BarcodeScannerModal from "$lib/components/BarcodeScannerModal.svelte";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();
  const t = getContext("i18n") as (key: string) => string;
  const quickSellCart = getContext<{
    items: () => CartItem[];
    add: (product: Product) => void;
    remove: (id: string) => void;
    changeQuantity: (id: string, delta: number) => void;
    open: () => void;
    isOpen: () => boolean;
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
  let cart = $derived(quickSellCart.items());
  let error = $state("");
  let scanner: HTMLInputElement;
  let cartList = $state<HTMLDivElement>();

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
    scannerInput = "";
    searchInput = "";
    error = "";
    void tick().then(() => {
      const item = cartList?.querySelector<HTMLElement>(`[data-cart-item="${CSS.escape(product.id)}"]`);
      item?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    scanner?.focus();
  }

  function removeProduct(id: string) {
    quickSellCart.remove(id);
  }

  function changeQuantity(id: string, delta: number) {
    quickSellCart.changeQuantity(id, delta);
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
  let saleSubtotal = $derived(cart.reduce((sum, item) => sum + price(item) * item.quantity, 0));
  let saleUnits = $derived(cart.reduce((sum, item) => sum + item.quantity, 0));

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

<div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
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

  {#if !quickSellCart.isOpen()}
    <aside
      class="card bg-base-100 border-base-300 sticky top-2 z-10 order-first max-h-[min(75dvh,42rem)] overflow-y-auto border shadow-sm xl:sticky xl:top-4 xl:z-auto xl:order-none xl:h-fit xl:max-h-none xl:overflow-visible"
      aria-label={t("Current sale")}
    >
      <div class="card-body p-4 sm:p-5">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-lg font-bold"><ShoppingCart size={20} /> {t("Current sale")}</h2>
          <span class="badge badge-primary" aria-live="polite">{saleUnits}</span>
        </div>

        <div bind:this={cartList} class="mb-4 max-h-64 space-y-2 overflow-y-auto pr-1" aria-live="polite" aria-label={t("Scanned items")}>
          {#each cart as item (item.id)}
            <div data-cart-item={item.id} class="rounded-box bg-base-200/60 flex items-center gap-2 p-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{item.name}</div>
                <div class="text-xs opacity-60">{fmtMoney(price(item))} × {item.quantity}</div>
              </div>
              <button type="button" class="btn btn-ghost btn-xs btn-square" onclick={() => changeQuantity(item.id, -1)} aria-label={t("Decrease quantity")}><Minus size={14} /></button>
              <span class="w-5 text-center text-sm font-semibold">{item.quantity}</span>
              <button type="button" class="btn btn-ghost btn-xs btn-square" onclick={() => changeQuantity(item.id, 1)} aria-label={t("Increase quantity")}><Plus size={14} /></button>
              <button type="button" class="btn btn-ghost btn-xs btn-square text-error" onclick={() => removeProduct(item.id)} aria-label={t("Remove item")}><Trash2 size={14} /></button>
            </div>
          {:else}
            <div class="rounded-box border border-dashed border-base-300 p-8 text-center text-sm opacity-60">{t("Your cart is empty")}</div>
          {/each}
        </div>

        <div class="border-base-300 space-y-3 border-t pt-4">
          <div class="flex items-center justify-between text-sm opacity-70">
            <span>{t("Items")}: {saleUnits}</span>
            <span>{t("Subtotal")}: {fmtMoney(saleSubtotal)}</span>
          </div>
          <div class="flex items-center justify-between text-xl font-bold"><span>{t("Current sale")}</span><span>{fmtMoney(saleSubtotal)}</span></div>
          <button type="button" class="btn btn-primary btn-lg w-full" disabled={!cart.length} onclick={() => quickSellCart.open()}>
            <ShoppingCart size={19} />
            {t("Open checkout")}
          </button>
          <p class="text-center text-xs opacity-60">{t("Customer, tax, payment, and Fonepay options are handled in Current Sale.")}</p>
        </div>
      </div>
    </aside>
  {/if}
</div>
