<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import QRCode from "qrcode";
  import "@fontsource-variable/inter/wght.css";
  import {
    BarChart3,
    Barcode,
    CreditCard,
    LayoutDashboard,
    LogOut,
    Ellipsis,
    Package,
    ReceiptText,
    Settings,
    UserCog,
    Users,
    Truck,
    Wallet,
    ShoppingCart,
    FileText,
    Trash2,
    Minus,
    Plus,
    Check,
    Undo2,
    RefreshCcw,
  } from "lucide-svelte";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import "./layout.css";
  import DemoAlert from "$lib/components/DemoAlert.svelte";
  import { setContext } from "svelte";
  import { createTranslator } from "$lib/i18n/mod";

  let { data, children } = $props();

  let authUser = $derived(data.user);
  let localizationData = $derived(data.localization);
  let translator = $derived(createTranslator(localizationData?.locale));
  let t = $derived(translator.t);

  // Expose to children as a function that delegates to the derived `t`
  setContext("i18n", (key: string, params?: Record<string, string | number>) => t(key, params));
  setContext("localization", () => localizationData);

  type QuickSellProduct = {
    id: string;
    name: string;
    sku?: string;
    barcode?: string;
    unit?: string;
    unitPrice?: number;
    taxDefinitionId?: string;
  };
  type QuickSellCartItem = QuickSellProduct & { quantity: number };

  let quickSellCart = $state<QuickSellCartItem[]>([]);
  let quickSellCartOwner = "";
  const quickSellCartContext = {
    items: () => quickSellCart,
    add(product: QuickSellProduct) {
      const existing = quickSellCart.find((item) => item.id === product.id);
      if (existing) existing.quantity += 1;
      else quickSellCart.push({ ...product, quantity: 1 });
    },
    remove(id: string) {
      const index = quickSellCart.findIndex((item) => item.id === id);
      if (index >= 0) quickSellCart.splice(index, 1);
    },
    changeQuantity(id: string, delta: number) {
      const item = quickSellCart.find((entry) => entry.id === id);
      if (item) item.quantity = Math.max(1, item.quantity + delta);
    },
    clear() {
      quickSellCart.splice(0, quickSellCart.length);
    },
    open() {
      globalCartPromptOpen = true;
      void loadGlobalCheckoutData();
    },
    isOpen: () => globalCartPromptOpen,
  };
  setContext("quickSellCart", quickSellCartContext);

  let demoMode = false;
  let isAdmin = $derived(authUser?.isAdmin ?? false);

  function hasPermission(resource: string, action: string) {
    if (!authUser) return false;
    if (authUser.isAdmin) return true;
    return authUser.permissions?.some((p: any) => p.resource === resource && p.action === action) ?? false;
  }

  let canViewInvoices = $derived(hasPermission("invoices", "read"));
  let canUseQuickSell = $derived(
    hasPermission("quick_sell", "use") && hasPermission("invoices", "create") && hasPermission("products", "read") && hasPermission("customers", "read") && hasPermission("tax_definitions", "read"),
  );
  let canViewProducts = $derived(hasPermission("products", "read"));
  let canViewCustomers = $derived(hasPermission("customers", "read"));
  let canViewSettings = $derived(hasPermission("settings", "read"));
  let canViewFonepay = $derived(!!authUser?.isAdmin);
  let canViewReports = $derived(!!authUser?.isAdmin);
  let canViewUsers = $derived(hasPermission("users", "read"));
  let canViewSuppliers = $derived(hasPermission("suppliers", "read"));
  let canViewExpenses = $derived(hasPermission("expenses", "read"));
  let canViewPurchaseOrders = $derived(hasPermission("purchase_orders", "read"));
  let canViewQuotes = $derived(hasPermission("quotes", "read"));
  let canViewCreditNotes = $derived(hasPermission("credit_notes", "read"));
  let canViewRecurring = $derived(hasPermission("recurring_invoices", "read"));
  let authed = $derived(!!authUser);
  let wide = $derived(page.data.wide ?? false);
  let isPublic = $derived(page.url.pathname.startsWith("/public"));
  let moreMenuDetails = $state<HTMLDetailsElement | null>(null);
  let globalScanBuffer = "";
  let globalScanStartedAt = 0;
  let globalScanLastAt = 0;
  let globalScanResetTimer: ReturnType<typeof setTimeout> | undefined;
  let globalScanQueue = Promise.resolve();
  let globalCartPromptOpen = $state(false);
  let globalScanMessage = $state("");
  let globalScanError = $state("");
  let globalCheckoutLoading = $state(false);
  let globalCheckoutLoaded = $state(false);
  let globalCustomers = $state<Array<{ id: string; name: string }>>([]);
  let globalTaxDefinitions = $state<Array<{ id: string; percent: number }>>([]);
  let globalSettings = $state<Record<string, unknown>>({});
  let globalCustomerId = $state("");
  let globalPaymentMethod = $state("Cash");
  let globalFonepayQrType = $state<"static" | "dynamic" | "">("");
  let globalSelling = $state(false);
  let globalGeneratedQr = $state("");
  let globalGeneratedInvoiceId = $state("");

  $effect(() => {
    const currentOwner = String(authUser?.id || "");
    if (quickSellCartOwner && quickSellCartOwner !== currentOwner) {
      quickSellCartContext.clear();
      globalCartPromptOpen = false;
      globalCheckoutLoaded = false;
      globalCheckoutLoading = false;
      globalCustomers = [];
      globalTaxDefinitions = [];
      globalSettings = {};
      globalCustomerId = "";
      globalPaymentMethod = "Cash";
      globalFonepayQrType = "";
      globalScanError = "";
      globalScanMessage = "";
      globalGeneratedQr = "";
      globalGeneratedInvoiceId = "";
    }
    quickSellCartOwner = currentOwner;
  });

  let globalCurrency = $derived(
    String(globalSettings.currency || "NPR")
      .trim()
      .toUpperCase(),
  );
  let globalSubtotal = $derived(quickSellCart.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0));
  let globalTaxTotal = $derived(
    quickSellCart.reduce((sum, item) => {
      const tax = globalTaxDefinitions.find((definition) => definition.id === item.taxDefinitionId);
      return sum + (Number(item.unitPrice || 0) * item.quantity * (Number(tax?.percent) || 0)) / 100;
    }, 0),
  );
  let globalSaleTotal = $derived(Math.round((globalSubtotal + globalTaxTotal) * 100) / 100);

  function formatGlobalMoney(value: number) {
    try {
      return new Intl.NumberFormat(localizationData?.locale || "en", {
        style: "currency",
        currency: globalCurrency,
      }).format(value || 0);
    } catch {
      return `${globalCurrency} ${Number(value || 0).toFixed(2)}`;
    }
  }

  async function loadGlobalCheckoutData() {
    if (globalCheckoutLoaded || globalCheckoutLoading) return;
    const requestOwner = String(authUser?.id || "");
    if (!requestOwner) return;
    globalCheckoutLoading = true;
    try {
      const [customersResponse, settingsResponse, taxResponse] = await Promise.all([fetch("/api/v1/customers"), fetch("/api/v1/settings"), fetch("/api/v1/tax-definitions")]);
      if (!customersResponse.ok || !settingsResponse.ok || !taxResponse.ok) throw new Error(t("Unable to load checkout options"));
      const [customers, settings, taxDefinitions] = await Promise.all([customersResponse.json(), settingsResponse.json(), taxResponse.json()]);
      if (requestOwner !== String(authUser?.id || "")) return;
      globalCustomers = Array.isArray(customers) ? customers.filter((customer) => customer.id !== "walk-in-customer") : [];
      globalSettings = settings && typeof settings === "object" ? settings : {};
      globalTaxDefinitions = Array.isArray(taxDefinitions) ? taxDefinitions : [];
      globalCheckoutLoaded = true;
    } catch (error) {
      if (requestOwner === String(authUser?.id || "")) {
        globalScanError = error instanceof Error ? error.message : t("Unable to load checkout options");
      }
    } finally {
      if (requestOwner === String(authUser?.id || "")) globalCheckoutLoading = false;
    }
  }

  async function resolveGlobalScan(code: string) {
    const scanOwner = String(authUser?.id || "");
    if (!scanOwner) return;

    const normalized = code.trim();
    if (!normalized) return;
    globalScanError = "";
    globalScanMessage = t("Looking up product...");
    globalGeneratedQr = "";
    globalGeneratedInvoiceId = "";
    try {
      const response = await fetch(`/api/v1/products/lookup?code=${encodeURIComponent(normalized)}`);
      if (!response.ok) throw new Error(t("No product found for that barcode or SKU"));
      const product = await response.json();
      if (scanOwner !== String(authUser?.id || "")) return;
      quickSellCartContext.add(product);
      globalCartPromptOpen = true;
      globalScanMessage = t("Product added to current sale");
      void loadGlobalCheckoutData();
    } catch (error) {
      globalScanError = error instanceof Error ? error.message : t("Unable to look up product");
      globalScanMessage = "";
      globalCartPromptOpen = true;
    }
  }

  function enqueueHardwareScan(code: string) {
    if (page.url.pathname === "/quick-sell") {
      window.dispatchEvent(new CustomEvent("invio:hardware-scan", { detail: code }));
      return;
    }
    globalScanQueue = globalScanQueue
      .then(() => resolveGlobalScan(code))
      .catch((error) => {
        globalScanError = error instanceof Error ? error.message : t("Unable to look up product");
        globalCartPromptOpen = true;
      });
  }

  async function completeGlobalSale() {
    if (!quickSellCart.length) return;
    if (globalPaymentMethod === "Fonepay" && !globalFonepayQrType) {
      globalScanError = t("Select a Fonepay QR type");
      return;
    }
    const requestOwner = String(authUser?.id || "");
    if (!requestOwner) return;
    globalSelling = true;
    globalScanError = "";
    globalGeneratedQr = "";
    globalGeneratedInvoiceId = "";
    let createdInvoiceId = "";
    const wasDynamicFonepay = globalPaymentMethod === "Fonepay" && globalFonepayQrType === "dynamic";
    try {
      const response = await fetch("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: globalCustomerId,
          currency: globalCurrency,
          status: globalPaymentMethod === "Fonepay" ? "sent" : "paid",
          paymentMethod: globalPaymentMethod,
          fonepayQrType: globalPaymentMethod === "Fonepay" ? globalFonepayQrType : undefined,
          discountAmount: 0,
          discountPercentage: 0,
          taxRate: 0,
          items: quickSellCart.map((item) => {
            const tax = globalTaxDefinitions.find((definition) => definition.id === item.taxDefinitionId);
            return {
              productId: item.id,
              description: item.name,
              quantity: item.quantity,
              unit: item.unit || "piece",
              unitPrice: Number(item.unitPrice || 0),
              taxes: tax ? [{ percent: Number(tax.percent) || 0, taxDefinitionId: tax.id }] : [],
            };
          }),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Failed to complete sale"));
      createdInvoiceId = String(body.id || "");

      if (requestOwner !== String(authUser?.id || "")) return;
      if (globalPaymentMethod === "Fonepay" && globalFonepayQrType === "dynamic") {
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
        if (requestOwner !== String(authUser?.id || "")) return;
        globalGeneratedQr = exactQrData;
        globalGeneratedInvoiceId = createdInvoiceId;
      }

      quickSellCartContext.clear();
      globalCustomerId = "";
      globalPaymentMethod = "Cash";
      globalFonepayQrType = "";
      globalCartPromptOpen = wasDynamicFonepay;
      globalScanMessage = t("Sale completed successfully");
      if (!wasDynamicFonepay) {
        await goto(`/invoices/${createdInvoiceId}`);
      }
    } catch (error) {
      globalScanError = error instanceof Error ? error.message : t("Failed to complete sale");
      if (createdInvoiceId && requestOwner === String(authUser?.id || "")) await goto(`/invoices/${createdInvoiceId}?payment=qr-failed`);
    } finally {
      globalSelling = false;
    }
  }

  function resetGlobalScanBuffer() {
    globalScanBuffer = "";
    globalScanStartedAt = 0;
    globalScanLastAt = 0;
    if (globalScanResetTimer) {
      clearTimeout(globalScanResetTimer);
      globalScanResetTimer = undefined;
    }
  }

  function getEventElement(target: EventTarget | null): HTMLElement | null {
    return target instanceof HTMLElement ? target : null;
  }

  function clearScanFromEditableElement(target: EventTarget | null, code: string) {
    const element = getEventElement(target);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
    if (!element.value.endsWith(code)) return;
    element.value = element.value.slice(0, -code.length);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleGlobalScannerKeydown(event: KeyboardEvent) {
    if (!authed || !canUseQuickSell || event.defaultPrevented) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.key === "Tab") {
      resetGlobalScanBuffer();
      return;
    }

    const target = getEventElement(event.target);
    // Quick Sell's dedicated input and the camera scanner's manual field own
    // their Enter behavior. Avoid processing either one twice.
    if (target?.id === "scanner-input" || target?.closest('[role="dialog"]')) {
      resetGlobalScanBuffer();
      return;
    }
    // Do not interfere with rich-text editors or other contenteditable areas.
    if (target?.isContentEditable) {
      resetGlobalScanBuffer();
      return;
    }

    const now = performance.now();
    if (event.key === "Enter") {
      const looksLikeScan = globalScanBuffer.length >= 4 && globalScanStartedAt > 0 && now - globalScanStartedAt <= 1000;
      const code = globalScanBuffer;
      resetGlobalScanBuffer();
      if (!looksLikeScan) return;

      event.preventDefault();
      event.stopPropagation();
      clearScanFromEditableElement(event.target, code);
      enqueueHardwareScan(code);
      return;
    }

    if (event.key.length !== 1) {
      resetGlobalScanBuffer();
      return;
    }

    if (!globalScanStartedAt || now - globalScanLastAt > 75) {
      globalScanBuffer = event.key;
      globalScanStartedAt = now;
    } else {
      globalScanBuffer += event.key;
    }
    globalScanLastAt = now;

    if (globalScanResetTimer) clearTimeout(globalScanResetTimer);
    globalScanResetTimer = setTimeout(resetGlobalScanBuffer, 1000);

    // Let the browser keep normal text input. If this becomes a scanner burst,
    // the completed code is removed from the field when Enter arrives.
  }

  function closeMoreMenuOnOutsideClick(event: MouseEvent) {
    if (!moreMenuDetails?.open) return;
    const target = event.target as Node | null;
    if (target && !moreMenuDetails.contains(target)) {
      moreMenuDetails.open = false;
    }
  }

  $effect(() => {
    document.addEventListener("click", closeMoreMenuOnOutsideClick, true);
    window.addEventListener("keydown", handleGlobalScannerKeydown, true);
    return () => {
      document.removeEventListener("click", closeMoreMenuOnOutsideClick, true);
      window.removeEventListener("keydown", handleGlobalScannerKeydown, true);
    };
  });
</script>

{#if isPublic}
  <main class="bg-base-100 flex min-h-screen flex-col">
    {@render children()}
  </main>
{:else}
  <div class="bg-base-200 min-h-screen">
    <div class="navbar bg-base-100 border-base-300 border-b px-3 sm:px-4" data-demo={demoMode ? "true" : "false"}>
      <div class="container mx-auto flex items-center">
        <div class="navbar-start flex-1">
          <a href="/" class="btn btn-ghost text-lg sm:text-xl">
            <span class="brand-logo inline-flex items-center">
              <svg class="mr-2 h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 500 500" aria-hidden="true" focusable="false">
                <path
                  d="M104.16661834716797,437.5000305175781L104.16661834716797,104.1666488647461C104.16661834716797,81.1548080444336,122.82152557373047,62.50002670288086,145.83335876464844,62.50002670288086L354.1666259765625,62.50002670288086C377.1785888671875,62.50002670288086,395.8333740234375,81.1548080444336,395.8333740234375,104.1666488647461L395.8333740234375,437.5000305175781L333.3333740234375,395.8334045410156L291.6666259765625,437.5000305175781L249.99998474121094,395.8334045410156L208.33335876464844,437.5000305175781L166.66661071777344,395.8334045410156ZM187.49998474121094,145.83340454101562L312.5,145.83340454101562M187.49998474121094,229.16665649414062L312.5,229.16665649414062M270.8333740234375,312.5000305175781L312.5,312.5000305175781"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="41.6667"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>{t("Invio")}</span>
            </span>
          </a>
        </div>
        <div class="navbar-end ml-auto items-center justify-end gap-2">
          {#if authed}
            <ul class="menu menu-horizontal hidden px-1 md:flex">
              <li>
                <a href="/dashboard">
                  <LayoutDashboard size={16} />
                  {t("Dashboard")}
                </a>
              </li>
              {#if canViewInvoices}
                <li>
                  <a href="/invoices">
                    <ReceiptText size={16} />
                    {t("Invoices")}
                  </a>
                </li>
              {/if}
              {#if canUseQuickSell}
                <li>
                  <a href="/quick-sell">
                    <Barcode size={16} />
                    {t("Quick Sell")}
                  </a>
                </li>
              {/if}
              {#if canViewCustomers}
                <li>
                  <a href="/customers">
                    <Users size={16} />
                    {t("Customers")}
                  </a>
                </li>
              {/if}
              <li>
                <details bind:this={moreMenuDetails}>
                  <summary>
                    <Ellipsis size={16} />
                    {t("More")}
                  </summary>
                  <ul class="bg-base-100 rounded-box z-20 w-52 p-2">
                    {#if canViewProducts}
                      <li>
                        <a href="/products">
                          <Package size={16} />
                          {t("Products")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewQuotes}
                      <li>
                        <a href="/quotes">
                          <FileText size={16} />
                          {t("Quotes")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewPurchaseOrders}
                      <li>
                        <a href="/purchase-orders">
                          <ShoppingCart size={16} />
                          {t("Purchase Orders")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewSuppliers}
                      <li>
                        <a href="/suppliers">
                          <Truck size={16} />
                          {t("Suppliers")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewExpenses}
                      <li>
                        <a href="/expenses">
                          <Wallet size={16} />
                          {t("Expenses")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewCreditNotes}
                      <li>
                        <a href="/credit-notes">
                          <Undo2 size={16} />
                          {t("Credit Notes")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewRecurring}
                      <li>
                        <a href="/recurring">
                          <RefreshCcw size={16} />
                          {t("Recurring")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewSettings}
                      <li>
                        <a href="/settings">
                          <Settings size={16} />
                          {t("Settings")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewReports}
                      <li>
                        <a href="/reports">
                          <BarChart3 size={16} />
                          {t("Reports")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewFonepay}
                      <li>
                        <a href="/fonepay">
                          <CreditCard size={16} />
                          {t("Fonepay")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewUsers}
                      <li>
                        <a href="/users">
                          <UserCog size={16} />
                          {t("Users")}
                        </a>
                      </li>
                    {/if}
                    <li>
                      <a href="/logout">
                        <LogOut size={16} />
                        {t("Logout")}
                      </a>
                    </li>
                  </ul>
                </details>
              </li>
            </ul>

            <div class="dropdown dropdown-end md:hidden">
              <div tabindex="0" role="button" class="btn btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </div>
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <ul tabindex="0" class="menu dropdown-content bg-base-100 rounded-box z-10 mt-2 w-52 p-2 shadow">
                <li>
                  <a href="/dashboard">
                    <LayoutDashboard size={16} />
                    {t("Dashboard")}
                  </a>
                </li>
                {#if canViewInvoices}
                  <li>
                    <a href="/invoices">
                      <ReceiptText size={16} />
                      {t("Invoices")}
                    </a>
                  </li>
                {/if}
                {#if canUseQuickSell}
                  <li>
                    <a href="/quick-sell">
                      <Barcode size={16} />
                      {t("Quick Sell")}
                    </a>
                  </li>
                {/if}
                {#if canViewProducts}
                  <li>
                    <a href="/products">
                      <Package size={16} />
                      {t("Products")}
                    </a>
                  </li>
                {/if}
                {#if canViewCustomers}
                  <li>
                    <a href="/customers">
                      <Users size={16} />
                      {t("Customers")}
                    </a>
                  </li>
                {/if}
                {#if canViewQuotes}
                  <li>
                    <a href="/quotes">
                      <FileText size={16} />
                      {t("Quotes")}
                    </a>
                  </li>
                {/if}
                {#if canViewPurchaseOrders}
                  <li>
                    <a href="/purchase-orders">
                      <ShoppingCart size={16} />
                      {t("Purchase Orders")}
                    </a>
                  </li>
                {/if}
                {#if canViewSuppliers}
                  <li>
                    <a href="/suppliers">
                      <Truck size={16} />
                      {t("Suppliers")}
                    </a>
                  </li>
                {/if}
                {#if canViewExpenses}
                  <li>
                    <a href="/expenses">
                      <Wallet size={16} />
                      {t("Expenses")}
                    </a>
                  </li>
                {/if}
                {#if canViewCreditNotes}
                  <li>
                    <a href="/credit-notes">
                      <Undo2 size={16} />
                      {t("Credit Notes")}
                    </a>
                  </li>
                {/if}
                {#if canViewRecurring}
                  <li>
                    <a href="/recurring">
                      <RefreshCcw size={16} />
                      {t("Recurring")}
                    </a>
                  </li>
                {/if}
                {#if canViewSettings}
                  <li>
                    <a href="/settings">
                      <Settings size={16} />
                      {t("Settings")}
                    </a>
                  </li>
                {/if}
                {#if canViewReports}
                  <li>
                    <a href="/reports">
                      <BarChart3 size={16} />
                      {t("Reports")}
                    </a>
                  </li>
                {/if}
                {#if canViewFonepay}
                  <li>
                    <a href="/fonepay">
                      <CreditCard size={16} />
                      {t("Fonepay")}
                    </a>
                  </li>
                {/if}
                {#if canViewUsers}
                  <li>
                    <a href="/users">
                      <UserCog size={16} />
                      {t("Users")}
                    </a>
                  </li>
                {/if}
                <li>
                  <a href="/logout">
                    <LogOut size={16} />
                    {t("Logout")}
                  </a>
                </li>
              </ul>
            </div>
          {/if}
        </div>
      </div>
    </div>
    <main class={"container mx-auto px-3 py-4 sm:px-4 sm:py-6 " + (wide ? "max-w-screen-2xl" : "")}>
      {#if authed}
        <DemoAlert data={page.data} />
        <Breadcrumbs {t} />
      {/if}
      {@render children()}
    </main>
    {#if authed && canUseQuickSell && globalCartPromptOpen}
      <div class="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md sm:inset-x-auto sm:right-5 sm:left-auto">
        <section class="card bg-base-100 border-primary/40 border-2 shadow-2xl" aria-live="polite" aria-label={t("Current sale")}>
          <div class="card-body gap-3 p-4">
            <div class="flex items-center justify-between gap-3">
              <h2 class="flex items-center gap-2 text-lg font-bold"><ShoppingCart size={20} /> {t("Current sale")}</h2>
              <button type="button" class="btn btn-ghost btn-sm btn-square" onclick={() => (globalCartPromptOpen = false)} aria-label={t("Close")}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {#if globalScanMessage}<div class="text-success text-sm">{globalScanMessage}</div>{/if}
            {#if globalScanError}<div class="alert alert-error py-2 text-sm"><span>{globalScanError}</span></div>{/if}
            {#if globalGeneratedQr}
              <div class="space-y-3 text-center">
                <p class="text-success text-sm">{t("Dynamic Fonepay QR generated successfully")}</p>
                <img src={globalGeneratedQr} alt={t("Fonepay payment QR code")} class="mx-auto h-48 w-48 rounded bg-white p-2" />
                <button
                  type="button"
                  class="btn btn-primary btn-sm w-full"
                  onclick={() => {
                    const invoiceId = globalGeneratedInvoiceId;
                    globalCartPromptOpen = false;
                    globalGeneratedQr = "";
                    globalGeneratedInvoiceId = "";
                    void goto(`/invoices/${invoiceId}`);
                  }}
                >
                  {t("View Invoice")}
                </button>
              </div>
            {:else if quickSellCart.length}
              <div class="max-h-48 space-y-2 overflow-y-auto">
                {#each quickSellCart as item (item.id)}
                  <div class="rounded-box bg-base-200/60 flex items-center gap-2 p-2">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium">{item.name}</div>
                      <div class="text-xs opacity-60">{formatGlobalMoney(Number(item.unitPrice || 0))} × {item.quantity}</div>
                    </div>
                    <button type="button" class="btn btn-ghost btn-xs btn-square" onclick={() => quickSellCartContext.changeQuantity(item.id, -1)} aria-label={t("Decrease quantity")}
                      ><Minus size={14} /></button
                    >
                    <span class="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                    <button type="button" class="btn btn-ghost btn-xs btn-square" onclick={() => quickSellCartContext.changeQuantity(item.id, 1)} aria-label={t("Increase quantity")}
                      ><Plus size={14} /></button
                    >
                    <button type="button" class="btn btn-ghost btn-xs btn-square text-error" onclick={() => quickSellCartContext.remove(item.id)} aria-label={t("Remove item")}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                {/each}
              </div>
              {#if globalCheckoutLoading}<span class="loading loading-spinner loading-sm"></span>{/if}
              {#if globalCheckoutLoaded}
                <label class="form-control">
                  <span class="label-text mb-1 text-sm font-medium">{t("Customer")}</span>
                  <select class="select select-bordered select-sm w-full" bind:value={globalCustomerId}>
                    <option value="">{t("Walk-in Customer")}</option>
                    {#each globalCustomers as customer (customer.id)}<option value={customer.id}>{customer.name}</option>{/each}
                  </select>
                </label>
                <label class="form-control">
                  <span class="label-text mb-1 text-sm font-medium">{t("Payment method")}</span>
                  <select
                    class="select select-bordered select-sm w-full"
                    bind:value={globalPaymentMethod}
                    onchange={() => {
                      globalFonepayQrType = "";
                    }}
                  >
                    <option>Cash</option>
                    <option>Card</option>
                    <option>Bank transfer</option>
                    <option>Mobile wallet</option>
                    <option>Fonepay</option>
                  </select>
                </label>
                {#if globalPaymentMethod === "Fonepay"}
                  <label class="form-control">
                    <span class="label-text mb-1 text-sm font-medium">{t("Fonepay QR")}</span>
                    <select class="select select-bordered select-sm w-full" bind:value={globalFonepayQrType}>
                      <option value="">{t("Select QR type")}</option>
                      <option value="static">{t("Static QR")}</option>
                      <option value="dynamic">{t("Dynamic QR")}</option>
                    </select>
                  </label>
                  {#if globalFonepayQrType === "static"}
                    <img src={String(globalSettings.fonepayStaticQr || "/fonepay-static-qr.png")} alt={t("Fonepay payment QR code")} class="mx-auto h-32 w-32 rounded bg-white p-2" />
                  {/if}
                  {#if globalFonepayQrType === "dynamic"}<p class="text-xs opacity-70">{t("The exact QR will be generated after the sale is created.")}</p>{/if}
                {/if}
                <div class="flex items-center justify-between border-t pt-3 text-sm">
                  <span>{t("Items")}: {quickSellCart.reduce((sum, item) => sum + item.quantity, 0)}</span><span>{t("Subtotal")}: {formatGlobalMoney(globalSubtotal)}</span>
                </div>
                {#if globalTaxTotal > 0}<div class="flex items-center justify-between text-sm opacity-70"><span>{t("Tax")}</span><span>{formatGlobalMoney(globalTaxTotal)}</span></div>{/if}
                <div class="flex items-center justify-between text-lg font-bold"><span>{t("Total")}</span><span>{formatGlobalMoney(globalSaleTotal)}</span></div>
                <button type="button" class="btn btn-primary w-full" disabled={globalSelling || !globalSaleTotal} onclick={completeGlobalSale}>
                  {#if globalSelling}<span class="loading loading-spinner"></span>{t("Completing...")}{:else}<Check size={18} />{t("Complete sale")}{/if}
                </button>
              {/if}
              {#if page.url.pathname !== "/quick-sell"}
                <button
                  type="button"
                  class="btn btn-ghost btn-sm w-full"
                  onclick={() => {
                    globalCartPromptOpen = false;
                    void goto("/quick-sell");
                  }}
                >
                  {t("Open Quick Sell")}
                </button>
              {/if}
            {:else if !globalScanError}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
          </div>
        </section>
      </div>
    {/if}
  </div>
{/if}
