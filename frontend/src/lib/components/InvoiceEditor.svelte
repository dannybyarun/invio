<script lang="ts">
  import { getContext, onMount, untrack } from "svelte";
  import { Plus, GripVertical, QrCode } from "lucide-svelte";
  import QRCode from "qrcode";
  import { goto } from "$app/navigation";
  import { generateId } from "$lib/utils/id";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data, invoice = null, formId = "invoice-editor-form" } = $props();
  let initInvoice = untrack(() => invoice);
  let initSettings = untrack(() => data?.settings || {});
  let initNextInvoiceNumber = untrack(() => data?.nextInvoiceNumber || "");
  let t = getContext("i18n") as (key: string) => string;
  let loc = getContext("localization") as any;

  let saving = $state(false);
  let error = $state("");
  let qrLoading = $state(false);
  let qrDataUrl = $state("");
  let qrRequestId = 0;
  // Tracks whether the user manually edited the invoice number, as opposed to
  // it just holding the auto-computed preview (which must not be submitted as
  // an explicit override — see the customerId-aware preview effect below).
  let invoiceNumberTouched = $state(false);

  let form = $state({
    customerId: initInvoice?.customerId || "",
    invoiceNumber: initInvoice?.invoiceNumber ?? initNextInvoiceNumber,
    currency: initInvoice?.currency || initSettings.currency || "USD",
    status: initInvoice?.status || "draft",
    issueDate: initInvoice?.issueDate ? new Date(initInvoice.issueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    dueDate: initInvoice?.dueDate ? new Date(initInvoice.dueDate).toISOString().slice(0, 10) : "",
    taxMode: initInvoice?.taxMode || "invoice",
    taxRate: initInvoice?.taxRate || 0,
    pricesIncludeTax: initInvoice?.pricesIncludeTax ? "true" : "false",
    roundingMode: initInvoice?.roundingMode || "line",
    paymentTerms: initInvoice?.paymentTerms ?? initSettings.paymentTerms ?? "",
    notes: initInvoice?.notes ?? initSettings.defaultNotes ?? "",
    paymentMethod: initInvoice?.paymentMethod || "",
    fonepayQrType: initInvoice?.fonepayQrType || "",
    fonepayQrData: initInvoice?.fonepayQrData || "",
    fonepayBillId: initInvoice?.fonepayBillId || "",
  });

  let items = $state(
    initInvoice?.items?.length
      ? initInvoice.items.map((i: any) => ({
          ...i,
          id: generateId(),
          unit: i.unit || "",
          productId: i.productId || "",
        }))
      : [
          {
            id: generateId(),
            productId: "",
            description: "",
            quantity: 1,
            unit: "",
            unitPrice: 0,
            taxPercent: 0,
            notes: "",
          },
        ],
  );

  let customers = $derived(data.customers || []);
  let products = $derived(data.products || []);
  let taxDefinitions = $derived(data.taxDefinitions || []);

  // Re-preview the next invoice number whenever the customer changes, so
  // customer-scoped patterns ({CSEQ}, {CNUM}) show something representative.
  // Only for new invoices, and only while the user hasn't typed their own
  // number — the actual final number is always assigned server-side.
  $effect(() => {
    if (initInvoice || invoiceNumberTouched) return;
    const customerId = form.customerId;
    const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
    fetch(`/api/v1/invoices/next-number${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.next && !invoiceNumberTouched) form.invoiceNumber = d.next;
      })
      .catch(() => {});
  });

  function addItem() {
    items.push({
      id: generateId(),
      productId: "",
      description: "",
      quantity: 1,
      unit: "",
      unitPrice: 0,
      taxPercent: 0,
      notes: "",
    });
  }

  function applyProductSelection(item: any, productId: string) {
    item.productId = productId;
    if (!productId) return;

    const product = products.find((p: any) => p.id === productId);
    if (!product) return;

    item.description = product.name || item.description;
    item.unitPrice = Number(product.unitPrice ?? product.unit_price ?? item.unitPrice ?? 0);
    item.unit = String(product.unit ?? item.unit ?? "");

    if (form.taxMode === "line" && product.taxDefinitionId) {
      const taxDef = taxDefinitions.find((t: any) => t.id === product.taxDefinitionId);
      if (taxDef) {
        item.taxPercent = Number(taxDef.percent || 0);
      }
    }
  }

  function removeItem(index: number) {
    if (items.length > 1) items.splice(index, 1);
  }

  let draggedId = $state<string | null>(null);
  let dragHoverId = $state<string | null>(null);

  function handleDragStart(e: DragEvent, id: string) {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
    // Defer setting the state to avoid firing dragend immediately
    setTimeout(() => {
      draggedId = id;
    }, 0);
  }

  function handleDragOver(e: DragEvent, id: string) {
    e.preventDefault();
    if (!draggedId || draggedId === id) return;
    dragHoverId = id;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  }

  function handleDragLeave(id: string) {
    if (dragHoverId === id) {
      dragHoverId = null;
    }
  }

  function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      draggedId = null;
      dragHoverId = null;
      return;
    }

    const fromIndex = items.findIndex((i: any) => i.id === draggedId);
    const toIndex = items.findIndex((i: any) => i.id === targetId);

    if (fromIndex !== -1 && toIndex !== -1) {
      const removed = items.splice(fromIndex, 1)[0];
      items.splice(toIndex, 0, removed);
    }

    draggedId = null;
    dragHoverId = null;
  }

  function handleDragEnd() {
    draggedId = null;
    dragHoverId = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSubmit(e as unknown as SubmitEvent);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  }

  let subtotal = $derived(items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0));
  let tax = $derived(
    form.taxMode === "invoice"
      ? subtotal * ((Number(form.taxRate) || 0) / 100)
      : items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) * ((Number(item.taxPercent) || 0) / 100), 0),
  );
  let total = $derived(form.pricesIncludeTax === "true" ? subtotal : subtotal + tax); // Simplified for visual parity

  function fmtMoney(value: number) {
    const currency = String(form.currency || initSettings.currency || "USD").trim().toUpperCase();
    try {
      return new Intl.NumberFormat(
        numberFormatLocale(data.localization?.locale, data.localization?.numberFormat),
        { style: "currency", currency },
      ).format(Number(value || 0));
    } catch {
      return `${currency} ${Number(value || 0).toFixed(2)}`;
    }
  }

  async function prepareFonepayQr() {
    // A new invoice has no final backend reference yet. Do not contact Fonepay
    // with a preview QR; the exact QR is generated after the invoice is saved.
    if (!initInvoice && form.paymentMethod === "Fonepay" && form.fonepayQrType === "dynamic") {
      qrRequestId += 1;
      qrLoading = false;
      form.fonepayQrData = "";
      qrDataUrl = "";
      return;
    }
    if (form.paymentMethod !== "Fonepay" || !form.fonepayQrType) {
      qrRequestId += 1;
      qrLoading = false;
      form.fonepayQrData = "";
      qrDataUrl = "";
      return;
    }
    if (form.fonepayQrType === "static") {
      qrRequestId += 1;
      qrLoading = false;
      form.fonepayQrData = "";
      qrDataUrl = String(data.settings?.fonepayStaticQr || "/fonepay-static-qr.png");
      return;
    }
    if (Number(total) <= 0) {
      qrRequestId += 1;
      qrLoading = false;
      form.fonepayQrData = "";
      qrDataUrl = "";
      return;
    }
    qrLoading = true;
    error = "";
    const requestId = ++qrRequestId;
    try {
      const response = await fetch(`/api/v1/invoices/${initInvoice?.id}/fonepay-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.qrMessage !== "string" || !body.qrMessage) {
        throw new Error(body.error || t("Unable to generate Fonepay QR"));
      }
      const nextQrData = await QRCode.toDataURL(body.qrMessage, { width: 320, margin: 2 });
      if (requestId !== qrRequestId) return;
      form.fonepayQrData = nextQrData;
      qrDataUrl = nextQrData;
    } catch (err: any) {
      if (requestId === qrRequestId) {
        form.fonepayQrData = "";
        qrDataUrl = "";
        throw new Error(err?.message || t("Unable to generate Fonepay QR"));
      }
      return;
    } finally {
      if (requestId === qrRequestId) qrLoading = false;
    }
  }

  async function handleQrTypeChange() {
    try {
      await prepareFonepayQr();
    } catch (err: any) {
      error = err.message;
    }
  }

  $effect(() => {
    const amount = Number(total);
    const method = form.paymentMethod;
    const type = form.fonepayQrType;
    if (!initInvoice || method !== "Fonepay" || type !== "dynamic" || amount <= 0) {
      qrRequestId += 1;
      qrLoading = false;
      return;
    }
    const timer = setTimeout(() => {
      prepareFonepayQr().catch((err: any) => {
        error = err?.message || t("Unable to generate Fonepay QR");
      });
    }, 250);
    return () => clearTimeout(timer);
  });

  async function handleSubmit(e: SubmitEvent | Event) {
    if (e && "preventDefault" in e) e.preventDefault();
    saving = true;
    error = "";

    try {
      await prepareFonepayQr();
      const payload = {
        ...form,
        // Only send an explicit invoice number when creating if the user actually
        // typed one; otherwise let the backend assign it using the real customerId.
        invoiceNumber: initInvoice ? form.invoiceNumber || undefined : undefined,
        fonepayQrData: initInvoice ? form.fonepayQrData || undefined : undefined,
        status: form.paymentMethod === "Fonepay" ? "sent" : form.status,
        fonepayBillId: initInvoice && form.paymentMethod === "Fonepay"
          ? String(form.fonepayBillId || form.invoiceNumber || "")
          : undefined,
        pricesIncludeTax: form.pricesIncludeTax === "true",
        items: items.map((i) => ({
          productId: i.productId || undefined,
          description: i.description,
          quantity: Number(i.quantity),
          unit: typeof i.unit === "string" ? i.unit.trim() : "",
          unitPrice: Number(i.unitPrice),
          taxPercent: Number(i.taxPercent || 0),
          notes: i.notes,
        })),
      };
      const url = initInvoice ? "/api/v1/invoices/" + initInvoice.id : "/api/v1/invoices";
      const res = await fetch(url, {
        method: initInvoice ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.text();
        let errMsg = "Failed to save invoice";
        try {
          const j = JSON.parse(d);
          errMsg = j.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const txt = await res.text();
      let result;
      try {
        result = JSON.parse(txt);
      } catch (err: any) {
        throw new Error("JSON parse error: " + err.message + " (Response: " + txt.substring(0, 100) + " )");
      }
      if (!initInvoice && form.paymentMethod === "Fonepay" && form.fonepayQrType === "dynamic") {
        const qrResponse = await fetch(`/api/v1/invoices/${result.id}/fonepay-qr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const qrBody = await qrResponse.json().catch(() => ({}));
        if (!qrResponse.ok || typeof qrBody.qrMessage !== "string") throw new Error(qrBody.error || t("Unable to generate Fonepay QR"));
        const exactQrData = await QRCode.toDataURL(qrBody.qrMessage, { width: 320, margin: 2 });
        const updateResponse = await fetch(`/api/v1/invoices/${result.id}/fonepay-qr-image`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: exactQrData, qrMessage: qrBody.qrMessage }),
        });
        if (!updateResponse.ok) throw new Error(t("Unable to save the exact Fonepay QR"));
      }
      goto("/invoices/" + result.id);
    } catch (err: any) {
      error = err.message;
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    //
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<form id={formId} onsubmit={handleSubmit} class="space-y-6">
  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Customer")} <span class="text-error">*</span></span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.customerId} required>
        <option value="">{t("Select customer")}</option>
        {#each customers as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Invoice Number")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" placeholder={t("e.g. INV-2025-001")} bind:value={form.invoiceNumber} oninput={() => (invoiceNumberTouched = true)} />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Currency")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" bind:value={form.currency} />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Status")}</span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.status}>
        <option value="draft">{t("Draft")}</option>
        <option value="sent">{t("Sent")}</option>
        <option value="paid">{t("Paid")}</option>
        <option value="complete">{t("Complete")}</option>
        <option value="overdue">{t("Overdue")}</option>
        <option value="voided">{t("Voided")}</option>
      </select>
    </label>
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Issue Date")}</span>
      </div>
      <input type="date" class="input input-bordered w-full" bind:value={form.issueDate} required />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Due Date")}</span>
      </div>
      <input type="date" class="input input-bordered w-full" bind:value={form.dueDate} />
    </label>
  </div>

  <div>
    <div class="mb-2 flex items-center justify-between">
      <div class="block text-sm font-semibold">
        {t("Items")} <span class="text-error">*</span>
      </div>
      <button type="button" class="btn btn-sm" onclick={addItem}>
        <Plus size={16} />
        <span class="ml-2">{t("Add item")}</span>
      </button>
    </div>

    <div class="mb-1 hidden flex-row flex-nowrap items-center gap-2 text-xs font-medium opacity-60 lg:flex">
      <div class="w-6 shrink-0"></div>
      {#if products.length > 0}
        <div class="w-44 max-w-xs shrink-0 text-center">{t("Product")}</div>
      {/if}
      <div class="min-w-0 flex-1 pl-3">{t("Description")}</div>
      <div class="w-16 shrink-0 text-center sm:w-20">{t("Quantity")}</div>
      <div class="w-24 shrink-0 text-center">{t("Unit")}</div>
      <div class="w-24 shrink-0 text-center">{t("Price")}</div>
      {#if form.taxMode === "line"}
        <div class="w-20 shrink-0 text-center">{t("Tax %")}</div>
      {/if}
      <div class="w-40 max-w-xs shrink-0 text-center">{t("Notes")}</div>
      <div class="w-8 shrink-0"></div>
    </div>

    <div class="space-y-3" role="list">
      {#each items as item, i (item.id)}
        <div
          role="listitem"
          class="rounded-box flex flex-nowrap items-center gap-2 p-1 transition-colors {draggedId === item.id ? 'opacity-50' : ''} {dragHoverId === item.id ? 'bg-base-200' : ''}"
          draggable="true"
          ondragstart={(e) => handleDragStart(e, item.id)}
          ondragover={(e) => handleDragOver(e, item.id)}
          ondragleave={() => handleDragLeave(item.id)}
          ondrop={(e) => handleDrop(e, item.id)}
          ondragend={handleDragEnd}
        >
          <button type="button" class="btn btn-ghost btn-sm btn-square shrink-0 cursor-move opacity-40 hover:opacity-100" tabindex="-1">
            <GripVertical size={16} />
          </button>

          {#if products.length > 0}
            <select class="select select-bordered w-44 max-w-xs shrink-0" bind:value={item.productId} onchange={(e) => applyProductSelection(item, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">{t("Select product")}</option>
              {#each products as p (p.id)}
                <option value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
              {/each}
            </select>
          {/if}

          <input class="input input-bordered w-full min-w-0" bind:value={item.description} placeholder={t("Description")} required />
          <input type="number" min="0" step="any" class="input input-bordered w-16 shrink-0 text-center sm:w-20" bind:value={item.quantity} />
          <input class="input input-bordered w-24 shrink-0 text-center" bind:value={item.unit} placeholder={t("Unit")} />
          <input type="number" min="0" step="any" class="input input-bordered w-24 shrink-0 text-center" bind:value={item.unitPrice} />
          {#if form.taxMode === "line"}
            <input type="number" min="0" step="any" class="input input-bordered w-20 shrink-0 text-center" bind:value={item.taxPercent} placeholder="%" />
          {/if}
          <input class="input input-bordered w-40 max-w-xs shrink-0" bind:value={item.notes} placeholder={t("Notes")} />

          <button type="button" class="btn btn-ghost btn-square btn-sm shrink-0" onclick={() => removeItem(i)} aria-label={t("Remove item")}>&times;</button>
        </div>
      {/each}
    </div>

    <div class="mt-6 flex flex-col items-end space-y-2 text-sm">
      <div class="flex w-48 justify-between">
        <span>{t("Subtotal")}:</span>
        <span>{fmtMoney(subtotal)}</span>
      </div>
      {#if tax > 0}
        <div class="flex w-48 justify-between">
          <span>{t("Tax")}:</span>
          <span>{fmtMoney(tax)}</span>
        </div>
      {/if}
      <div class="flex w-48 justify-between text-lg font-bold">
        <span>{t("Total")}:</span>
        <span>{fmtMoney(total)}</span>
      </div>
    </div>
  </div>

  <div class="flex gap-4 text-xs opacity-50">
    <span class="flex items-center gap-1"
      ><kbd class="kbd kbd-xs">Ctrl</kbd>+<kbd class="kbd kbd-xs">S</kbd>
      {t("Save")}</span
    >
    <span class="flex items-center gap-1"
      ><kbd class="kbd kbd-xs">Ctrl</kbd>+<kbd class="kbd kbd-xs">Enter</kbd>
      {t("Add item")}</span
    >
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Tax Mode")}</span></div>
      <select class="select select-bordered w-full" bind:value={form.taxMode}>
        <option value="invoice">{t("Invoice total")}</option>
        <option value="line">{t("Per line")}</option>
      </select>
    </label>

    <label class="form-control" class:hidden={form.taxMode !== "invoice"}>
      <div class="label">
        <span class="label-text">{t("Tax Rate (%)")}</span>
      </div>
      <input type="number" class="input input-bordered w-full" bind:value={form.taxRate} step="any" min="0" />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Prices include tax?")}</span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.pricesIncludeTax}>
        <option value="false">{t("No")}</option>
        <option value="true">{t("Yes")}</option>
      </select>
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Rounding mode")}</span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.roundingMode}>
        <option value="line">{t("Round per line")}</option>
        <option value="total">{t("Round on total")}</option>
      </select>
    </label>
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Payment Method")}</span></div>
      <select class="select select-bordered w-full" bind:value={form.paymentMethod} onchange={handleQrTypeChange}>
        <option value="">{t("Select payment method")}</option>
        <option value="Cash">{t("Cash")}</option>
        <option value="Bank Transfer">{t("Bank transfer")}</option>
        <option value="Card">{t("Card")}</option>
        <option value="Fonepay">Fonepay</option>
      </select>
    </label>
    {#if form.paymentMethod === "Fonepay"}
      <label class="form-control">
        <div class="label"><span class="label-text">{t("Fonepay QR")}</span></div>
        <select class="select select-bordered w-full" bind:value={form.fonepayQrType} onchange={handleQrTypeChange}>
          <option value="">{t("Select QR type")}</option>
          <option value="static">{t("Static QR")}</option>
          <option value="dynamic">{t("Dynamic QR")}</option>
        </select>
      </label>
    {/if}
  </div>

  {#if form.paymentMethod === "Fonepay" && form.fonepayQrType}
    <div class="rounded-box border border-primary/30 bg-primary/5 p-4">
      <div class="flex items-center gap-2 font-semibold"><QrCode size={18} /> {form.fonepayQrType === "dynamic" ? t("Dynamic Fonepay QR") : t("Static Fonepay QR")}</div>
      {#if qrLoading}
        <span class="loading loading-spinner loading-sm mt-3"></span>
      {:else if qrDataUrl}
        <img src={qrDataUrl} alt={t("Fonepay payment QR code")} class="mt-3 h-48 w-48 rounded-lg bg-white p-2" />
        {#if form.fonepayQrType === "dynamic"}<p class="mt-2 text-xs opacity-70">{t("This QR is generated for the invoice total.")}</p>{/if}
      {/if}
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Payment Terms")}</span>
      </div>
      <textarea class="textarea textarea-bordered h-24 w-full" bind:value={form.paymentTerms}></textarea>
    </label>

    <label class="form-control">
      <div class="label"><span class="label-text">{t("Notes")}</span></div>
      <textarea class="textarea textarea-bordered h-24 w-full" bind:value={form.notes}></textarea>
    </label>
  </div>
</form>
