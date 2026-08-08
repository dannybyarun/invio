<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { Barcode, Check, Minus, Plus, Search, ShoppingCart, Trash2, QrCode } from "lucide-svelte";
  import QRCode from "qrcode";
  import { goto } from "$app/navigation";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data } = $props();
  const t = getContext("i18n") as (key: string) => string;

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
  let taxDefinitions = $derived((data.taxDefinitions || []) as Array<{ id: string; percent: number }>);
  let customers = $derived(((data.customers || []) as Array<{ id: string; name: string }>).filter((customer) => customer.id !== "walk-in-customer"));
  let currency = $derived(
    String(data.settings?.currency || "NPR")
      .trim()
      .toUpperCase(),
  );
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let scannerInput = $state("");
  let searchInput = $state("");
  let cart = $state<CartItem[]>([]);
  let customerId = $state("");
  let paymentMethod = $state("Cash");
  let fonepayQrType = $state<"static" | "dynamic" | "">("");
  let error = $state("");
  let success = $state("");
  let selling = $state(false);
  let qrLoading = $state(false);
  let qrDataUrl = $state("");
  let qrRequestId = 0;
  let scanner: HTMLInputElement;

  function price(product: Product) {
    return Number(product.unitPrice ?? 0);
  }

  function fmtMoney(value: number) {
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, numberFormat), {
        style: "currency",
        currency,
      }).format(value || 0);
    } catch {
      return `${currency} ${Number(value || 0).toFixed(2)}`;
    }
  }

  function addProduct(product: Product) {
    const existing = cart.find((item) => item.id === product.id);
    if (existing) existing.quantity += 1;
    else cart.push({ ...product, quantity: 1 });
    scannerInput = "";
    searchInput = "";
    error = "";
    scanner?.focus();
  }

  function removeProduct(id: string) {
    cart = cart.filter((item) => item.id !== id);
  }

  function changeQuantity(item: CartItem, delta: number) {
    item.quantity = Math.max(1, item.quantity + delta);
  }

  async function lookupCode(code: string) {
    const normalized = code.trim();
    if (!normalized) return;
    const product = products.find((p) => p.barcode?.toLowerCase() === normalized.toLowerCase() || p.sku?.toLowerCase() === normalized.toLowerCase());
    if (!product) {
      try {
        const response = await fetch(`/api/v1/products/lookup?code=${encodeURIComponent(normalized)}`);
        if (response.ok) {
          addProduct(await response.json());
          return;
        }
      } catch {
        // Fall through to the friendly not-found message.
      }
      error = t("No product found for that barcode or SKU");
      scannerInput = "";
      scanner?.focus();
      return;
    }
    addProduct(product);
  }

  function handleScannerKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      lookupCode(scannerInput);
    }
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
  let subtotal = $derived(cart.reduce((sum, item) => sum + price(item) * item.quantity, 0));
  let taxTotal = $derived(
    cart.reduce((sum, item) => {
      const tax = taxDefinitions.find((definition) => definition.id === item.taxDefinitionId);
      return sum + (price(item) * item.quantity * (Number(tax?.percent) || 0)) / 100;
    }, 0),
  );
  let saleTotal = $derived(Math.round((subtotal + taxTotal) * 100) / 100);
  let fonepayStaticQr = $derived(String(data.settings?.fonepayStaticQr || "/fonepay-static-qr.png"));

  async function prepareFonepayQr() {
    // Quick Sell creates the invoice first so the backend can allocate the
    // authoritative reference and calculate the exact amount. Never request a
    // disposable preview QR from Fonepay here.
    if (paymentMethod === "Fonepay" && fonepayQrType === "dynamic") {
      qrRequestId += 1;
      qrLoading = false;
      qrDataUrl = "";
      return "";
    }
    if (paymentMethod !== "Fonepay") {
      qrRequestId += 1;
      qrLoading = false;
      qrDataUrl = "";
      return "";
    }
    if (fonepayQrType === "static") {
      qrRequestId += 1;
      qrLoading = false;
      qrDataUrl = fonepayStaticQr;
      return "";
    }
    // Dynamic Quick Sell QR generation happens only after the invoice has been
    // created and its final reference/total are known.
    qrRequestId += 1;
    qrLoading = false;
    qrDataUrl = "";
    return "";
  }

  $effect(() => {
    const amount = Number(saleTotal);
    if (paymentMethod !== "Fonepay" || fonepayQrType !== "dynamic" || amount <= 0) {
      qrRequestId += 1;
      qrLoading = false;
      qrDataUrl = "";
      return;
    }
    const timer = setTimeout(() => {
      const requestId = qrRequestId;
      prepareFonepayQr().catch((err: any) => {
        if (requestId === qrRequestId) error = err?.message || t("Unable to generate Fonepay QR");
      });
    }, 250);
    return () => clearTimeout(timer);
  });

  async function completeSale() {
    if (!cart.length) {
      error = t("Add at least one product to the cart");
      return;
    }
    // Walk-in sales are valid and do not require a named customer. The backend
    // creates/reuses the stable Walk-in Customer record when customerId is empty.

    selling = true;
    error = "";
    success = "";
    let createdInvoiceId = "";
    try {
      // Dynamic QR previews are intentionally not persisted. The backend
      // allocates the final invoice reference first; the exact QR is generated
      // and attached after the invoice is created.
      const qrData = fonepayQrType === "dynamic" ? undefined : await prepareFonepayQr();
      const response = await fetch("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          currency,
          status: paymentMethod === "Fonepay" ? "sent" : "paid",
          invoiceNumber: undefined,
          paymentMethod,
          fonepayQrType: paymentMethod === "Fonepay" ? fonepayQrType : undefined,
          fonepayQrData: paymentMethod === "Fonepay" && fonepayQrType === "static" ? undefined : qrData,
          fonepayBillId: undefined,
          discountAmount: 0,
          discountPercentage: 0,
          taxRate: 0,
          items: cart.map((item) => {
            const tax = taxDefinitions.find((definition) => definition.id === item.taxDefinitionId);
            return {
              productId: item.id,
              description: item.name,
              quantity: item.quantity,
              unit: item.unit || "piece",
              unitPrice: price(item),
              taxes: tax ? [{ percent: Number(tax.percent) || 0, taxDefinitionId: tax.id }] : [],
            };
          }),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Failed to complete sale"));

      // The backend allocates the final invoice number and computes the exact
      // total. Generate the dynamic QR only after those authoritative values
      // exist, then attach it to the pending invoice.
      createdInvoiceId = String(body.id || "");
      if (paymentMethod === "Fonepay" && fonepayQrType === "dynamic") {
        const qrResponse = await fetch(`/api/v1/invoices/${createdInvoiceId}/fonepay-qr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const qrBody = await qrResponse.json().catch(() => ({}));
        if (!qrResponse.ok || typeof qrBody.qrMessage !== "string") throw new Error(qrBody.error || t("Unable to generate Fonepay QR"));
        const exactQrData = await QRCode.toDataURL(qrBody.qrMessage, { width: 320, margin: 2 });
        const updateResponse = await fetch(`/api/v1/invoices/${createdInvoiceId}/fonepay-qr-image`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: exactQrData, qrMessage: qrBody.qrMessage }),
        });
        if (!updateResponse.ok) throw new Error(t("Unable to save the exact Fonepay QR"));
      }
      success = t("Sale completed successfully");
      cart = [];
      customerId = "";
      scanner?.focus();
      setTimeout(() => goto(`/invoices/${createdInvoiceId}`), 700);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      // Invoice creation is intentionally preserved if a downstream Fonepay
      // QR call fails. Send the cashier to the invoice so they can retry or
      // switch payment method instead of losing the sale.
      const failedInvoiceId = typeof createdInvoiceId === "string" ? createdInvoiceId : "";
      if (failedInvoiceId) {
        await goto(`/invoices/${failedInvoiceId}?payment=qr-failed`);
      }
    } finally {
      selling = false;
    }
  }

  onMount(() => scanner?.focus());
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "F2") {
      event.preventDefault();
      scanner?.focus();
    }
  }}
/>

<div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
  <div>
    <div class="text-primary mb-1 text-sm font-semibold tracking-[0.18em] uppercase">{t("Point of sale")}</div>
    <h1 class="text-3xl font-bold tracking-tight">{t("Quick Sell")}</h1>
    <p class="mt-1 text-sm opacity-70">{t("Scan a barcode or search by SKU to add products quickly.")}</p>
  </div>
  <kbd class="kbd kbd-sm self-start sm:self-auto">F2 {t("Focus scanner")}</kbd>
</div>

{#if error}<div class="alert alert-error mb-4"><span>{error}</span></div>{/if}
{#if success}<div class="alert alert-success mb-4"><Check size={18} /><span>{success}</span></div>{/if}

<div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
  <section class="space-y-4">
    <div class="card bg-base-100 border-base-300 border shadow-sm">
      <div class="card-body p-4 sm:p-5">
        <label class="input input-lg input-bordered border-primary/50 flex w-full items-center gap-3 shadow-sm" for="scanner-input">
          <Barcode size={22} class="text-primary" />
          <input id="scanner-input" bind:this={scanner} bind:value={scannerInput} onkeydown={handleScannerKeydown} placeholder={t("Scan barcode or enter SKU")} autocomplete="off" />
          <kbd class="kbd kbd-sm hidden sm:inline-flex">Enter</kbd>
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

  <aside class="card bg-base-100 border-base-300 border shadow-sm xl:sticky xl:top-4 xl:h-fit">
    <div class="card-body p-4 sm:p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-lg font-bold"><ShoppingCart size={20} /> {t("Current sale")}</h2>
        <span class="badge badge-primary">{cart.length}</span>
      </div>

      <div class="mb-4 space-y-2">
        {#each cart as item (item.id)}
          <div class="rounded-box bg-base-200/60 flex items-center gap-2 p-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{item.name}</div>
              <div class="text-xs opacity-60">{fmtMoney(price(item))} × {item.quantity}</div>
            </div>
            <button type="button" class="btn btn-ghost btn-xs btn-square" onclick={() => changeQuantity(item, -1)} aria-label={t("Decrease quantity")}><Minus size={14} /></button>
            <span class="w-5 text-center text-sm font-semibold">{item.quantity}</span>
            <button type="button" class="btn btn-ghost btn-xs btn-square" onclick={() => changeQuantity(item, 1)} aria-label={t("Increase quantity")}><Plus size={14} /></button>
            <button type="button" class="btn btn-ghost btn-xs btn-square text-error" onclick={() => removeProduct(item.id)} aria-label={t("Remove item")}><Trash2 size={14} /></button>
          </div>
        {:else}
          <div class="rounded-box border border-dashed border-base-300 p-8 text-center text-sm opacity-60">{t("Your cart is empty")}</div>
        {/each}
      </div>

      <div class="border-base-300 space-y-3 border-t pt-4">
        <label class="form-control">
          <span class="label-text mb-1 text-sm font-medium">{t("Customer")}</span>
          <select class="select select-bordered w-full" bind:value={customerId}>
            <option value="">{t("Walk-in Customer")}</option>
            {#each customers as customer (customer.id)}<option value={customer.id}>{customer.name}</option>{/each}
          </select>
        </label>
        <label class="form-control">
          <span class="label-text mb-1 text-sm font-medium">{t("Payment method")}</span>
          <select
            class="select select-bordered w-full"
            bind:value={paymentMethod}
            onchange={() => {
              qrDataUrl = "";
            }}
          >
            <option>Cash</option>
            <option>Card</option>
            <option>Bank transfer</option>
            <option>Mobile wallet</option>
            <option>Fonepay</option>
          </select>
        </label>
        {#if paymentMethod === "Fonepay"}
          <label class="form-control">
            <span class="label-text mb-1 text-sm font-medium">{t("Fonepay QR")}</span>
            <select class="select select-bordered w-full" bind:value={fonepayQrType} onchange={() => prepareFonepayQr().catch((e) => (error = e.message))}>
              <option value="">{t("Select QR type")}</option>
              <option value="static">{t("Static QR")}</option>
              <option value="dynamic">{t("Dynamic QR")}</option>
            </select>
          </label>
          {#if fonepayQrType}
            <div class="rounded-box border-primary/30 bg-primary/5 border p-3">
              {#if qrLoading}<span class="loading loading-spinner loading-sm"></span>{:else if qrDataUrl}<img
                  src={qrDataUrl}
                  alt={t("Fonepay payment QR code")}
                  class="mx-auto h-44 w-44 rounded bg-white p-2"
                />{/if}
              {#if fonepayQrType === "dynamic"}<p class="mt-2 text-center text-xs opacity-70">{t("QR amount matches the current sale total.")}</p>{/if}
            </div>
          {/if}
        {/if}
        {#if taxTotal > 0}<div class="flex items-center justify-between text-sm opacity-70"><span>{t("Tax")}</span><span>{fmtMoney(taxTotal)}</span></div>{/if}
        <div class="flex items-center justify-between text-xl font-bold"><span>{t("Total")}</span><span>{fmtMoney(saleTotal)}</span></div>
        <button type="button" class="btn btn-primary btn-lg w-full" disabled={selling || !cart.length} onclick={completeSale}>
          {#if selling}<span class="loading loading-spinner"></span>{t("Completing...")}{:else}<Check size={19} />{t("Complete sale")}{/if}
        </button>
      </div>
    </div>
  </aside>
</div>
