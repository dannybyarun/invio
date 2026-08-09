// @ts-nocheck: route handlers use Hono context without typings to keep edits minimal
import { Hono } from "hono";
import {
  createInvoice,
  deleteInvoice,
  duplicateInvoice,
  getInvoiceAudit,
  getInvoiceById,
  getInvoices,
  getLatestPaidPaymentMethods,
  publishInvoice,
  unpublishInvoice,
  updateInvoice,
  verifyFonepayPayment,
  voidInvoice,
} from "../controllers/invoices.ts";
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  getTemplates,
  installLocalTemplateFromZip,
  installTemplateFromManifest,
  loadTemplateFromFile,
  renderTemplate,
  setDefaultTemplate,
} from "../controllers/templates.ts";
import {
  deleteSetting,
  getSetting,
  getSettings,
  setSetting,
  updateSettings,
} from "../controllers/settings.ts";
import {
  createCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomers,
  updateCustomer,
} from "../controllers/customers.ts";
import {
  createProduct,
  deleteProduct,
  getProductByCode,
  getProductById,
  getProducts,
  isProductUsedInInvoices,
  reactivateProduct,
  updateProduct,
} from "../controllers/products.ts";
import {
  createTaxDefinition,
  deleteTaxDefinition,
  getTaxDefinitionById,
  getTaxDefinitions,
  updateTaxDefinition,
} from "../controllers/taxDefinitions.ts";
import {
  createCategory,
  createUnit,
  deleteCategory,
  deleteUnit,
  getCategories,
  getUnits,
  isCategoryUsed,
  isUnitUsed,
  updateCategory,
  updateUnit,
} from "../controllers/productOptions.ts";
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSuppliers,
  isSupplierUsed,
  updateSupplier,
} from "../controllers/suppliers.ts";
import {
  createExpense,
  deleteExpense,
  getExpenseById,
  getExpenseCategories,
  getExpenses,
  updateExpense,
} from "../controllers/expenses.ts";
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderById,
  getPurchaseOrders,
  nextPurchaseOrderNumber,
  receivePurchaseOrder,
  voidPurchaseOrder,
} from "../controllers/purchaseOrders.ts";
import {
  convertQuoteToInvoice,
  createQuote,
  deleteQuote,
  duplicateQuote,
  getQuoteById,
  getQuotes,
  nextQuoteNumber,
  setQuoteStatus,
  updateQuote,
} from "../controllers/quotes.ts";
import {
  createCreditNote,
  deleteCreditNote,
  getCreditNoteById,
  getCreditNotes,
  nextCreditNumber,
  voidCreditNote,
} from "../controllers/creditNotes.ts";
import {
  createRecurringInvoice,
  deleteRecurringInvoice,
  getRecurringInvoiceById,
  getRecurringInvoices,
  processDueRecurringInvoices,
  updateRecurringInvoice,
} from "../controllers/recurring.ts";
import {
  addManualPayment,
  bulkSendReminders,
  deleteManualPayment,
  getCustomerStatement,
  sendPaymentReminder,
} from "../controllers/payments.ts";
import {
  customersToCsv,
  invoicesToCsv,
  productsToCsv,
} from "../controllers/exportCsv.ts";
import { getDashboardKpis } from "../controllers/dashboard.ts";
import {
  getProfitLossReport,
  getStockValuationReport,
} from "../controllers/reports.ts";
import {
  applyStockAdjustment,
  getProductStock,
  getStockMovements,
} from "../controllers/stock.ts";
import { buildInvoiceHTML, generatePDF } from "../utils/pdf.ts";
import { isEmailConfigured, sendEmail } from "../utils/email.ts";
import { generateUBLInvoiceXML } from "../utils/ubl.ts"; // legacy direct import
import { generateInvoiceXML, listXMLProfiles } from "../utils/xmlProfiles.ts";
import { availableInvoiceLocales } from "../i18n/translations.ts";
import { generateFonepayQr } from "../utils/fonepay.ts";

import { resetDatabaseFromDemo } from "../database/init.ts";
import { getNextInvoiceNumber } from "../database/init.ts";
import { closeDatabase, getDatabase, initDatabase } from "../database/init.ts";
import { getEnv, isDemoMode } from "../utils/env.ts";
import {
  normalizeStoredLogoReference,
  saveDataUrlLogo,
  saveUploadedLogoFile,
} from "../utils/logoStorage.ts";
import {
  getAuthUser,
  requireAdmin,
  requireAdminAuth,
  requirePermission,
} from "../middleware/auth.ts";
import {
  createUser as createUserCtrl,
  deleteUser as deleteUserCtrl,
  disableUserTwoFactor,
  getUserById as getUserByIdCtrl,
  getUserTwoFactorState,
  listUsers,
  setUserTwoFactorState,
  updateUser as updateUserCtrl,
} from "../controllers/users.ts";
import { RESOURCE_ACTIONS, RESOURCES } from "../types/index.ts";
import {
  createPendingTwoFactorSetup,
  decryptFonepaySecret,
  decryptTwoFactorSecret,
  encryptFonepaySecret,
  encryptTwoFactorSecret,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyPendingTwoFactorSetup,
  verifyTotpToken,
} from "../utils/twoFactor.ts";

const adminRoutes = new Hono();

// Normalize tax-related settings coming from the client to robust canonical forms
function normalizeTaxSettingsPayload(data: Record<string, unknown>) {
  // defaultTaxRate: parse to finite non-negative number, store as canonical string
  if (data && Object.prototype.hasOwnProperty.call(data, "defaultTaxRate")) {
    const raw = String(
      (data as Record<string, unknown>)["defaultTaxRate"] ?? "",
    ).trim();
    const norm = raw.replace(",", ".");
    const n = Number(norm);
    if (!isFinite(n) || isNaN(n) || n < 0) {
      // Remove invalid value to avoid persisting junk
      delete (data as Record<string, unknown>)["defaultTaxRate"];
    } else {
      // Keep a trimmed canonical numeric string (avoid trailing spaces)
      (data as Record<string, unknown>)["defaultTaxRate"] = String(n);
    }
  }

  // defaultPricesIncludeTax: normalize to "true" | "false"
  if (
    data &&
    Object.prototype.hasOwnProperty.call(data, "defaultPricesIncludeTax")
  ) {
    const v = String(
      (data as Record<string, unknown>)["defaultPricesIncludeTax"] ?? "",
    )
      .toLowerCase()
      .trim();
    const truthy = new Set(["1", "true", "yes", "y", "on"]);
    (data as Record<string, unknown>)["defaultPricesIncludeTax"] = truthy.has(v)
      ? "true"
      : "false";
  }

  // defaultRoundingMode: normalize to "line" | "total" (default line)
  if (
    data &&
    Object.prototype.hasOwnProperty.call(data, "defaultRoundingMode")
  ) {
    const v = String(
      (data as Record<string, unknown>)["defaultRoundingMode"] ?? "",
    )
      .toLowerCase()
      .trim();
    (data as Record<string, unknown>)["defaultRoundingMode"] = v === "total"
      ? "total"
      : "line";
  }
}

const SUPPORTED_LOCALES = new Set(availableInvoiceLocales());

function deriveLocaleFromCountryCode(countryCode?: string): string | undefined {
  if (!countryCode) return undefined;
  const code = String(countryCode).trim().toUpperCase();
  if (!code) return undefined;

  // Keep mapping constrained to currently supported invoice locales
  if (code === "DE" || code === "AT" || code === "CH") return "de";
  if (code === "NL" || code === "BE") return "nl";
  if (code === "PT" || code === "BR") return "pt-br";
  if (code === "NP") return "ne";
  if (
    [
      "AU",
      "CA",
      "GB",
      "IE",
      "NZ",
      "US",
      "AG",
      "BS",
      "BB",
      "BZ",
      "DM",
      "GD",
      "GY",
      "JM",
      "KN",
      "LC",
      "VC",
      "TT",
    ].includes(code)
  ) return "en";

  return undefined;
}

function resolveInvoiceRenderLocale(
  invoiceLocale: string | undefined,
  customerCountryCode: string | undefined,
  settingsLocale: string | undefined,
): string | undefined {
  const fromInvoice = invoiceLocale?.trim().toLowerCase();
  if (fromInvoice && SUPPORTED_LOCALES.has(fromInvoice)) return fromInvoice;

  const fromCountry = deriveLocaleFromCountryCode(customerCountryCode);
  if (fromCountry && SUPPORTED_LOCALES.has(fromCountry)) return fromCountry;

  const fromSettings = settingsLocale?.trim().toLowerCase();
  if (fromSettings && SUPPORTED_LOCALES.has(fromSettings)) return fromSettings;

  return "en";
}

function normalizeLocaleSettingPayload(data: Record<string, unknown>) {
  if (!data) return;

  if (Object.prototype.hasOwnProperty.call(data, "currency")) {
    const currency = String(data.currency ?? "").trim().toUpperCase();
    if (currency) data.currency = currency;
    else delete data.currency;
  }

  if (Object.prototype.hasOwnProperty.call(data, "companyCountryCode")) {
    const countryCode = String(data.companyCountryCode ?? "").trim()
      .toUpperCase();
    if (/^[A-Z]{2}$/.test(countryCode)) data.companyCountryCode = countryCode;
    else if (!countryCode) delete data.companyCountryCode;
    else data.companyCountryCode = countryCode.slice(0, 2);
  }

  // Accept common aliases and normalize to canonical keys
  if (
    !Object.prototype.hasOwnProperty.call(data, "dateFormat") &&
    Object.prototype.hasOwnProperty.call(data, "date_format")
  ) {
    (data as Record<string, unknown>).dateFormat = (
      data as Record<string, unknown>
    ).date_format;
    delete (data as Record<string, unknown>).date_format;
  }
  if (
    !Object.prototype.hasOwnProperty.call(data, "numberFormat") &&
    Object.prototype.hasOwnProperty.call(data, "number_format")
  ) {
    (data as Record<string, unknown>).numberFormat = (
      data as Record<string, unknown>
    ).number_format;
    delete (data as Record<string, unknown>).number_format;
  }

  // Accept common aliases and normalize to canonical key
  if (
    !Object.prototype.hasOwnProperty.call(data, "postalCityFormat") &&
    Object.prototype.hasOwnProperty.call(data, "postal_city_format")
  ) {
    (data as Record<string, unknown>).postalCityFormat = (
      data as Record<string, unknown>
    ).postal_city_format;
    delete (data as Record<string, unknown>).postal_city_format;
  }
  if (
    !Object.prototype.hasOwnProperty.call(data, "postalCityFormat") &&
    Object.prototype.hasOwnProperty.call(data, "postalcityformat")
  ) {
    (data as Record<string, unknown>).postalCityFormat = (
      data as Record<string, unknown>
    ).postalcityformat;
    delete (data as Record<string, unknown>).postalcityformat;
  }

  if (Object.prototype.hasOwnProperty.call(data, "locale")) {
    const raw = String((data as Record<string, unknown>).locale ?? "").trim();
    if (!raw) {
      delete (data as Record<string, unknown>).locale;
    } else {
      const lower = raw.toLowerCase();
      if (SUPPORTED_LOCALES.has(lower)) {
        (data as Record<string, unknown>).locale = lower;
      } else {
        const base = lower.split("-")[0];
        if (SUPPORTED_LOCALES.has(base)) {
          (data as Record<string, unknown>).locale = base;
        } else {
          (data as Record<string, unknown>).locale = "en";
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "postalCityFormat")) {
    const rawFormat = String(data.postalCityFormat ?? "")
      .trim()
      .toLowerCase();
    if (rawFormat === "city-postal" || rawFormat === "postal-city") {
      (data as Record<string, unknown>).postalCityFormat = rawFormat;
    } else {
      (data as Record<string, unknown>).postalCityFormat = "auto";
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "numberFormat")) {
    const rawNumberFormat = String(data.numberFormat ?? "")
      .trim()
      .toLowerCase();
    (data as Record<string, unknown>).numberFormat =
      rawNumberFormat === "period" ? "period" : "comma";
  }

  if (Object.prototype.hasOwnProperty.call(data, "dateFormat")) {
    const rawDateFormat = String(data.dateFormat ?? "").trim();
    (data as Record<string, unknown>).dateFormat =
      rawDateFormat === "DD.MM.YYYY" ? "DD.MM.YYYY" : "YYYY-MM-DD";
  }
}

async function normalizeFonepaySettingsPayload(
  data: Record<string, unknown>,
): Promise<void> {
  // The encrypted value is server-managed and must never be accepted from a client.
  delete data.fonepayPasswordEncrypted;

  if (Object.prototype.hasOwnProperty.call(data, "fonepayUsername")) {
    const username = String(data.fonepayUsername ?? "").trim();
    if (username) data.fonepayUsername = username;
    else delete data.fonepayUsername;
  }

  if (Object.prototype.hasOwnProperty.call(data, "fonepayPassword")) {
    const password = String(data.fonepayPassword ?? "");
    delete data.fonepayPassword;
    if (password) {
      data.fonepayPasswordEncrypted = await encryptFonepaySecret(password);
    }
  }
}

function sanitizeFonepaySettingsMap(map: Record<string, string>): void {
  (map as Record<string, unknown>).fonepayConfigured = Boolean(
    map.fonepayUsername && map.fonepayPasswordEncrypted,
  );
  delete map.fonepayPasswordEncrypted;
  delete (map as Record<string, unknown>).fonepayPassword;
}

function sanitizeFonepaySettingsResults(
  settings: Array<{ key: string; value: string }>,
) {
  return settings.filter(
    (setting) =>
      setting.key !== "fonepayPasswordEncrypted" &&
      setting.key !== "fonepayPassword",
  );
}

function normalizeInvoiceProtectionSettingsPayload(
  data: Record<string, unknown>,
) {
  if (
    !Object.prototype.hasOwnProperty.call(data, "allowProtectedInvoiceChanges")
  ) {
    return;
  }
  const raw = String(data.allowProtectedInvoiceChanges ?? "")
    .toLowerCase()
    .trim();
  const truthy = new Set(["1", "true", "yes", "y", "on"]);
  (data as Record<string, unknown>).allowProtectedInvoiceChanges = truthy.has(
      raw,
    )
    ? "true"
    : "false";
}

// Demo mode flag (mutations allowed; periodic resets handle reverting state)
const DEMO_MODE = isDemoMode();

adminRoutes.use("/invoices/*", requireAdminAuth);

adminRoutes.use("/customers/*", requireAdminAuth);

adminRoutes.use("/products/*", requireAdminAuth);

adminRoutes.use("/templates/*", requireAdminAuth);

adminRoutes.use("/tax-definitions/*", requireAdminAuth);

adminRoutes.use("/product-categories/*", requireAdminAuth);

adminRoutes.use("/product-units/*", requireAdminAuth);

adminRoutes.use("/settings", requireAdminAuth);

adminRoutes.use("/settings/*", requireAdminAuth);

// Protect admin alias routes as well
adminRoutes.use("/admin/*", requireAdminAuth);

// Protect export routes
adminRoutes.use("/export/*", requireAdminAuth);

// Protect report routes
adminRoutes.use("/reports/*", requireAdminAuth);
// Business-extra route groups
adminRoutes.use("/suppliers/*", requireAdminAuth);
adminRoutes.use("/expenses/*", requireAdminAuth);
adminRoutes.use("/purchase-orders/*", requireAdminAuth);
adminRoutes.use("/quotes/*", requireAdminAuth);
adminRoutes.use("/credit-notes/*", requireAdminAuth);
adminRoutes.use("/recurring/*", requireAdminAuth);
adminRoutes.use("/dashboard/*", requireAdminAuth);

// Demo helper: trigger an immediate reset (only effective when DEMO_MODE=true)
adminRoutes.post("/admin/demo/reset", async (c) => {
  if (!DEMO_MODE) return c.json({ error: "Demo mode is not enabled" }, 400);
  try {
    await resetDatabaseFromDemo();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Invoice routes
adminRoutes.get(
  "/invoices/next-number",
  requirePermission("invoices", "create"),
  (c) => {
    try {
      const customerId = c.req.query("customerId") || undefined;
      const next = getNextInvoiceNumber(customerId);
      return c.json({ next });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.post(
  "/invoices",
  requirePermission("invoices", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const invoice = createInvoice(data);
      return c.json(invoice);
    } catch (e) {
      const msg = String(e);
      if (/already exists/i.test(msg)) {
        return c.json({ error: msg }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.get("/invoices", requirePermission("invoices", "read"), (c) => {
  const invoices = getInvoices();

  // Look up payment methods for paid and complete invoices — complete invoices
  // were previously paid and their payment method should remain visible.
  const paidIds = invoices
    .filter((inv) => inv.status === "paid" || inv.status === "complete")
    .map((inv) => inv.id);
  const paymentMethods = getLatestPaidPaymentMethods(paidIds);

  const list = invoices.map((inv) => {
    let customerName: string | undefined = undefined;
    try {
      const customer = getCustomerById(inv.customerId);
      customerName = customer?.name;
    } catch (_e) {
      /* ignore */
    }
    const issue_date = inv.issueDate
      ? new Date(inv.issueDate).toISOString().slice(0, 10)
      : undefined;
    return {
      ...inv,
      customer: customerName ? { name: customerName } : undefined,
      issue_date,
      paidWith: paymentMethods.get(inv.id),
    } as unknown;
  });
  return c.json(list);
});

adminRoutes.get("/invoices/:id", requirePermission("invoices", "read"), (c) => {
  const id = c.req.param("id");
  const invoice = getInvoiceById(id);
  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404);
  }
  // Add snake_case date strings for UI compatibility (same as list endpoint)
  const issue_date = invoice.issueDate
    ? new Date(invoice.issueDate).toISOString().slice(0, 10)
    : undefined;
  const due_date = invoice.dueDate
    ? new Date(invoice.dueDate).toISOString().slice(0, 10)
    : undefined;
  return c.json({ ...invoice, issue_date, due_date });
});

adminRoutes.post(
  "/invoices/:id/verify-payment",
  requirePermission("invoices", "update"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const result = await verifyFonepayPayment(id);
      return c.json(result, result.invoice ? 200 : 404);
    } catch (e) {
      const msg = String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      if (/gateway|Fonepay/i.test(msg)) return c.json({ error: msg }, 502);
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.put(
  "/invoices/:id",
  requirePermission("invoices", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const invoice = await updateInvoice(id, data);
      return c.json(invoice);
    } catch (e) {
      const msg = String(e);
      if (/already exists/i.test(msg)) {
        return c.json({ error: msg }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.delete(
  "/invoices/:id",
  requirePermission("invoices", "delete"),
  async (c) => {
    const id = c.req.param("id");
    try {
      await deleteInvoice(id);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Fiscal-year audit trail: every invoice with items, status history and payments
adminRoutes.get(
  "/reports/audit",
  requirePermission("invoices", "read"),
  (c) => {
    try {
      const audit = getInvoiceAudit();
      return c.json(audit);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

// Profit & Loss report (optional ?start=YYYY-MM-DD&end=YYYY-MM-DD)
adminRoutes.get(
  "/reports/profit-loss",
  requirePermission("invoices", "read"),
  (c) => {
    try {
      const start = c.req.query("start") || undefined;
      const end = c.req.query("end") || undefined;
      return c.json(getProfitLossReport(start, end));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

// Stock valuation report
adminRoutes.get(
  "/reports/stock-valuation",
  requirePermission("invoices", "read"),
  (c) => {
    try {
      return c.json(getStockValuationReport());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

// Download a full database backup
adminRoutes.get("/backup/download", requireAdminAuth, async (c) => {
  const dbPath = getEnv("DATABASE_PATH", "./invio.db")!;
  try {
    const bytes = await Deno.readFile(dbPath);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="invio-backup-${ts}.db"`,
      },
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Restore a database backup (uploads a .db file, swaps it in, re-inits)
adminRoutes.post("/backup/restore", requireAdminAuth, async (c) => {
  const dbPath = getEnv("DATABASE_PATH", "./invio.db")!;
  try {
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return c.json({ error: "Empty upload" }, 400);
    }
    const bytes = new Uint8Array(body);
    const magic = new TextDecoder().decode(bytes.slice(0, 16));
    if (!magic.startsWith("SQLite format 3")) {
      return c.json({ error: "Uploaded file is not a SQLite database" }, 400);
    }

    const tempPath = `${dbPath}.restore-${Date.now()}.tmp`;
    await Deno.writeFile(tempPath, bytes);

    let checkOk = false;
    let checkDb:
      | { query: (sql: string, params?: unknown[]) => unknown[][] }
      | null = null;
    try {
      const { DB } = await import("sqlite");
      checkDb = new DB(tempPath, { readonly: true });
      const tables = checkDb.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('invoices','settings')",
      ) as unknown[][];
      const names = new Set(tables.map((r) => String(r[0])));
      checkOk = names.has("invoices") && names.has("settings");
    } catch {
      checkOk = false;
    } finally {
      checkDb?.close();
    }
    if (!checkOk) {
      try {
        await Deno.remove(tempPath);
      } catch {
        /* ignore */
      }
      return c.json(
        { error: "Uploaded file is not a valid Invio database" },
        400,
      );
    }

    // Keep a safety copy of the current database before replacing it.
    try {
      const safetyPath = `${
        dbPath.replace(/\.db$/, "")
      }_prerestore_${Date.now()}.db`;
      await Deno.copyFile(dbPath, safetyPath);
    } catch (safetyErr) {
      return c.json(
        {
          error: `Failed to create pre-restore safety copy: ${
            String(safetyErr)
          }`,
        },
        500,
      );
    }

    try {
      closeDatabase();
    } catch (e) {
      return c.json(
        { error: `Failed to close current database: ${String(e)}` },
        500,
      );
    }

    // Swap the file; always re-initialize so the process never stays dead.
    try {
      try {
        await Deno.rename(tempPath, dbPath);
      } catch {
        await Deno.copyFile(tempPath, dbPath);
      }
    } catch (e) {
      try {
        await initDatabase();
      } catch {
        /* original file may be intact; report the swap failure */
      }
      return c.json(
        { error: `Failed to replace database: ${String(e)}` },
        500,
      );
    }
    try {
      await initDatabase();
    } catch (e) {
      return c.json(
        { error: `Database replaced but re-init failed: ${String(e)}` },
        500,
      );
    }
    return c.json({ success: true, message: "Database restored successfully" });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Database size/info helper (used by the Settings > Backup & Restore panel)
adminRoutes.get("/backup/info", requireAdminAuth, (c) => {
  try {
    const dbPath = getEnv("DATABASE_PATH", "./invio.db")!;
    const stat = Deno.statSync(dbPath);
    const db = getDatabase();
    const rows = db.query(
      "SELECT (SELECT COUNT(*) FROM invoices) + (SELECT COUNT(*) FROM customers) + (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM quotes) + (SELECT COUNT(*) FROM credit_notes)",
    ) as unknown[][];
    return c.json({
      path: dbPath,
      sizeBytes: stat.size,
      sizeHuman: `${(stat.size / 1024 / 1024).toFixed(2)} MB`,
      recordCount: Number(rows[0][0]) || 0,
      updatedAt: stat.mtime ? stat.mtime.toISOString() : null,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

adminRoutes.post(
  "/invoices/:id/publish",
  requirePermission("invoices", "publish"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const result = await publishInvoice(id);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.post(
  "/invoices/:id/unpublish",
  requirePermission("invoices", "publish"),
  async (c) => {
    const id = c.req.param("id");
    const result = await unpublishInvoice(id);
    return c.json(result);
  },
);

adminRoutes.post(
  "/invoices/:id/duplicate",
  requirePermission("invoices", "create"),
  async (c) => {
    const id = c.req.param("id");
    const copy = await duplicateInvoice(id);
    if (!copy) return c.json({ error: "Invoice not found" }, 404);
    return c.json(copy);
  },
);

adminRoutes.post(
  "/invoices/:id/void",
  requirePermission("invoices", "void"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const result = await voidInvoice(id);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Template routes
adminRoutes.get(
  "/templates",
  requirePermission("templates", "read"),
  async (c) => {
    let templates = await getTemplates();
    // Overlay the default from settings if present; also compute 'updatable' flag when a manifest source exists
    try {
      const settings = await getSettings();
      const map = settings.reduce(
        (acc: Record<string, string>, s) => {
          acc[s.key] = s.value as string;
          return acc;
        },
        {} as Record<string, string>,
      );
      const current = map.templateId;
      if (current) {
        templates = templates.map((t) => ({
          ...t,
          isDefault: t.id === current,
          updatable: !!map[`templateSource:${t.id}`],
        }));
      } else {
        templates = templates.map((t) => ({
          ...t,
          updatable: !!map[`templateSource:${t.id}`],
        }));
      }
    } catch {
      /* ignore */
    }
    return c.json(templates);
  },
);

// Tax definition routes
adminRoutes.get(
  "/tax-definitions",
  requirePermission("tax_definitions", "read"),
  (c) => {
    try {
      const list = getTaxDefinitions();
      return c.json(list);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

adminRoutes.get(
  "/tax-definitions/:id",
  requirePermission("tax_definitions", "read"),
  (c) => {
    try {
      const id = c.req.param("id");
      const tax = getTaxDefinitionById(id);
      if (!tax) return c.json({ error: "Not found" }, 404);
      return c.json(tax);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

adminRoutes.post(
  "/tax-definitions",
  requirePermission("tax_definitions", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const created = createTaxDefinition(data);
      return c.json(created, 201);
    } catch (e) {
      const msg = String(e);
      if (/unique constraint failed: tax_definitions\.code/i.test(msg)) {
        return c.json({ error: "Tax code already exists" }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.put(
  "/tax-definitions/:id",
  requirePermission("tax_definitions", "update"),
  async (c) => {
    const data = await c.req.json();
    try {
      const id = c.req.param("id");
      const updated = updateTaxDefinition(id, data);
      return c.json(updated);
    } catch (e) {
      const msg = String(e);
      if (msg === "NOT_FOUND") return c.json({ error: "Not found" }, 404);
      if (/unique constraint failed: tax_definitions\.code/i.test(msg)) {
        return c.json({ error: "Tax code already exists" }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.delete(
  "/tax-definitions/:id",
  requirePermission("tax_definitions", "delete"),
  (c) => {
    try {
      const id = c.req.param("id");
      const result = deleteTaxDefinition(id);
      return c.json(result);
    } catch (e) {
      const msg = String(e);
      if (msg === "NOT_FOUND") return c.json({ error: "Not found" }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.post(
  "/templates",
  requirePermission("templates", "create"),
  async (c) => {
    const data = await c.req.json();
    const template = await createTemplate(data);
    return c.json(template);
  },
);

// Install a template from a remote manifest URL (YAML or JSON)
adminRoutes.post(
  "/templates/install-from-manifest",
  requirePermission("templates", "install"),
  async (c) => {
    try {
      const { url } = await c.req.json();
      if (!url || typeof url !== "string") {
        return c.json({ error: "Missing 'url'" }, 400);
      }
      const t = await installTemplateFromManifest(url);
      try {
        // Remember the source manifest used for this template id to enable future updates
        setSetting(`templateSource:${t.id}`, url);
      } catch (_e) {
        /* non-fatal */
      }
      return c.json(t);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Install a local template from an uploaded .zip file
adminRoutes.post(
  "/templates/upload",
  requirePermission("templates", "install"),
  async (c) => {
    try {
      const contentType = c.req.header("content-type") || "";

      let zipData: Uint8Array;

      if (contentType.includes("multipart/form-data")) {
        // Handle multipart form upload
        const formData = await c.req.formData();
        const file = formData.get("file");
        if (!file || !(file instanceof File)) {
          return c.json({ error: "No file uploaded" }, 400);
        }
        if (!file.name.endsWith(".zip")) {
          return c.json({ error: "File must be a .zip archive" }, 400);
        }
        if (file.size > 5 * 1024 * 1024) {
          return c.json({ error: "File too large (max 5MB)" }, 400);
        }
        const arrayBuffer = await file.arrayBuffer();
        zipData = new Uint8Array(arrayBuffer);
      } else if (
        contentType.includes("application/zip") ||
        contentType.includes("application/octet-stream")
      ) {
        // Handle raw binary upload
        const arrayBuffer = await c.req.arrayBuffer();
        if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
          return c.json({ error: "File too large (max 5MB)" }, 400);
        }
        zipData = new Uint8Array(arrayBuffer);
      } else {
        return c.json(
          {
            error:
              "Invalid content type. Expected multipart/form-data or application/zip",
          },
          400,
        );
      }

      const t = await installLocalTemplateFromZip(zipData);
      return c.json(t);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Update a template by id using its stored source manifest URL
adminRoutes.post(
  "/templates/:id/update",
  requirePermission("templates", "update"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const src = await getSetting(`templateSource:${id}`);
      if (!src || typeof src !== "string") {
        return c.json(
          { error: "No stored manifest URL for this template" },
          404,
        );
      }
      const updated = await installTemplateFromManifest(src);
      if (!updated || updated.id !== id) {
        return c.json({ error: "Manifest ID does not match template id" }, 400);
      }
      return c.json({ ok: true, template: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Delete a template (disallow removing built-in app templates)
adminRoutes.delete(
  "/templates/:id",
  requirePermission("templates", "delete"),
  async (c) => {
    const id = c.req.param("id");
    // Built-in templates are protected
    const builtin = new Set(["professional-modern", "minimalist-clean"]);
    if (builtin.has(id)) {
      return c.json({ error: "Cannot delete built-in templates" }, 400);
    }

    // If this template is currently selected in settings, reset to minimalist-clean
    try {
      const current = await getSetting("templateId");
      if (current === id) {
        await setSetting("templateId", "minimalist-clean");
      }
    } catch (_e) {
      // non-fatal
    }

    try {
      await deleteTemplate(id);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);

// Get template by ID
adminRoutes.get(
  "/templates/:id",
  requirePermission("templates", "read"),
  (c) => {
    const id = c.req.param("id");
    const template = getTemplateById(id);
    if (!template) {
      return c.json({ error: "Template not found" }, 404);
    }
    return c.json(template);
  },
);

// Preview template with sample data
adminRoutes.post(
  "/templates/:id/preview",
  requirePermission("templates", "read"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();

    const template = getTemplateById(id);
    if (!template) {
      return c.json({ error: "Template not found" }, 404);
    }

    // Add sample data if not provided
    const sampleData = {
      companyName: "Sample Company Inc",
      companyAddress: "123 Business St, City, State 12345",
      companyEmail: "contact@sample.com",
      companyPhone: "+1-555-123-4567",
      companyTaxId: "TAX123456",
      invoiceNumber: "INV-2025-001",
      issueDate: "2025-08-26",
      dueDate: "2025-09-25",
      currency: "USD",
      status: "draft",
      customerName: "John Doe",
      customerEmail: "john@example.com",
      customerAddress: "456 Client Ave, City, State 54321",
      customerPostalCity: "54321 City",
      customerCountryCode: "US",
      highlightColor: data.highlightColor || "#2563eb",
      highlightColorLight: data.highlightColorLight || "#dbeafe",
      subtotal: 2500.0,
      discountAmount: 250.0,
      discountPercentage: 10,
      taxRate: 8.5,
      taxAmount: 191.25,
      total: 2441.25,
      hasDiscount: true,
      hasTax: true,

      items: [
        {
          description: "Website Development",
          quantity: 1,
          unitPrice: 2500.0,
          lineTotal: 2500.0,
          notes: "Custom responsive website with modern design",
        },
      ],
      notes: "Thank you for your business! Payment is due within 30 days.",
      paymentTerms: "Net 30 days",
      paymentMethods: "Bank Transfer, Credit Card",
      bankAccount: "Account: 123-456-789, Routing: 987-654-321",
      ...data,
    };

    try {
      const renderedHtml = renderTemplate(template.html, sampleData);
      return new Response(renderedHtml, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return c.json(
        {
          error: "Failed to render template",
          details: String(error),
        },
        500,
      );
    }
  },
);

// Load template from file
adminRoutes.post(
  "/templates/load-from-file",
  requirePermission("templates", "create"),
  async (c) => {
    try {
      const { filePath, name, isDefault, highlightColor } = await c.req.json();

      const html = await loadTemplateFromFile(filePath);
      const template = await createTemplate({
        name,
        html,
        isDefault: isDefault || false,
      });

      return c.json({
        ...template,
        highlightColor: highlightColor || "#2563eb",
        message: "Template loaded successfully from file",
      });
    } catch (error) {
      return c.json(
        {
          error: "Failed to load template from file",
          details: String(error),
        },
        500,
      );
    }
  },
);

// Settings routes
adminRoutes.get("/settings", async (c) => {
  const settings = await getSettings();
  const map = settings.reduce(
    (acc: Record<string, string>, s) => {
      acc[s.key] = s.value as string;
      return acc;
    },
    {} as Record<string, string>,
  );
  // Provide normalized aliases expected by the frontend
  if (map.companyEmail && !map.email) map.email = map.companyEmail;
  if (map.companyPhone && !map.phone) map.phone = map.companyPhone;
  if (map.companyTaxId && !map.taxId) map.taxId = map.companyTaxId;
  if (map.companyCountryCode && !map.countryCode) {
    map.countryCode = map.companyCountryCode;
  }
  // Unify logo fields: prefer single 'logo'; hide legacy 'logoUrl'
  if (map.logoUrl && !map.logo) map.logo = map.logoUrl;
  if (map.logoUrl) delete map.logoUrl;
  if (typeof map.logo === "string") {
    map.logo = normalizeStoredLogoReference(map.logo);
  }
  if (!map.locale) map.locale = "en";
  if (!map.dateFormat && map.date_format) map.dateFormat = map.date_format;
  if (!map.numberFormat && map.number_format) {
    map.numberFormat = map.number_format;
  }
  if (!map.postalCityFormat && map.postal_city_format) {
    map.postalCityFormat = map.postal_city_format;
  }
  if (!map.postalCityFormat && map.postalcityformat) {
    map.postalCityFormat = map.postalcityformat;
  }
  if (!map.dateFormat) map.dateFormat = "YYYY-MM-DD";
  if (!map.numberFormat) map.numberFormat = "comma";
  if (!map.postalCityFormat) map.postalCityFormat = "auto";
  if (!map.allowProtectedInvoiceChanges) {
    map.allowProtectedInvoiceChanges = "false";
  }
  // Never expose Fonepay credentials or encrypted values through settings.
  sanitizeFonepaySettingsMap(map);

  // Expose demo mode to frontend UI
  (map as Record<string, unknown>).demoMode = DEMO_MODE ? "true" : "false";
  return c.json(map);
});

adminRoutes.put(
  "/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    // Normalize legacy logoUrl to logo
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize countryCode alias to companyCountryCode
    if (typeof data.countryCode === "string" && !data.companyCountryCode) {
      data.companyCountryCode = data.countryCode;
      delete data.countryCode;
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    await normalizeFonepaySettingsPayload(data);
    const settings = await updateSettings(data);
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    // If default template changed, reflect in templates table
    if (typeof data.templateId === "string" && data.templateId) {
      try {
        setDefaultTemplate(String(data.templateId));
      } catch {
        /* ignore */
      }
    }
    return c.json(sanitizeFonepaySettingsResults(settings));
  },
);

// Partial update (PATCH) to merge provided keys only
adminRoutes.patch(
  "/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    // Normalize legacy logoUrl to logo
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize countryCode alias to companyCountryCode
    if (typeof data.countryCode === "string" && !data.companyCountryCode) {
      data.companyCountryCode = data.countryCode;
      delete data.countryCode;
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    await normalizeFonepaySettingsPayload(data);
    const settings = await updateSettings(data);
    if (typeof data.templateId === "string" && data.templateId) {
      try {
        setDefaultTemplate(String(data.templateId));
      } catch {
        /* ignore */
      }
    }
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    return c.json(sanitizeFonepaySettingsResults(settings));
  },
);

adminRoutes.post(
  "/settings/logo-upload",
  requirePermission("settings", "update"),
  async (c) => {
    try {
      const form = await c.req.formData();
      const entry = form.get("file");
      if (!(entry instanceof File)) {
        return c.json({ error: "Missing file" }, 400);
      }
      const logo = await saveUploadedLogoFile(entry);
      return c.json({ logo });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.post(
  "/settings/fonepay-qr-upload",
  requirePermission("settings", "update"),
  async (c) => {
    try {
      const form = await c.req.formData();
      const entry = form.get("file");
      if (!(entry instanceof File)) {
        return c.json({ error: "Missing file" }, 400);
      }
      const qrPath = await saveUploadedLogoFile(entry);
      await setSetting("fonepayStaticQr", qrPath);
      return c.json({ fonepayStaticQr: qrPath });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.put(
  "/invoices/:id/fonepay-qr-image",
  requirePermission("invoices", "update"),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const image = typeof body?.image === "string" ? body.image.trim() : "";
    const qrMessage = typeof body?.qrMessage === "string"
      ? body.qrMessage.trim()
      : "";
    if (
      !qrMessage ||
      !/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      image.length > 1_000_000
    ) {
      return c.json({ error: "A valid Fonepay QR image is required" }, 400);
    }
    const invoice = getInvoiceById(id);
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);
    if (
      invoice.paymentMethod !== "Fonepay" || invoice.fonepayQrType !== "dynamic"
    ) {
      return c.json({
        error: "Invoice is not configured for a dynamic Fonepay QR",
      }, 400);
    }
    if (invoice.fonepayQrData) {
      return c.json({ error: "Fonepay QR is already stored" }, 409);
    }
    const db = (await import("../database/init.ts")).getDatabase();
    const payloadRows = db.query(
      "SELECT qr_message, amount, bill_id FROM fonepay_qr_payloads WHERE invoice_id = ?",
      [id],
    ) as unknown[][];
    const payload = payloadRows[0];
    if (
      !payload || String(payload[0]) !== qrMessage ||
      Math.round(Number(payload[1]) * 100) !==
        Math.round(Number(invoice.total) * 100) ||
      String(payload[2]) !==
        String(invoice.fonepayBillId || invoice.invoiceNumber)
    ) {
      return c.json({ error: "QR payload does not match this invoice" }, 409);
    }
    db.query(
      "UPDATE invoices SET fonepay_qr_data = ?, fonepay_qr_amount = ?, updated_at = ? WHERE id = ? AND fonepay_qr_data IS NULL",
      [image, invoice.total, new Date(), id],
    );
    return c.json({ ok: true });
  },
);

adminRoutes.post(
  "/invoices/:id/fonepay-qr",
  requirePermission("invoices", "update"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const invoice = getInvoiceById(id);
      if (!invoice) return c.json({ error: "Invoice not found" }, 404);
      if (
        invoice.paymentMethod !== "Fonepay" ||
        invoice.fonepayQrType !== "dynamic"
      ) {
        return c.json({
          error: "Invoice is not configured for a dynamic Fonepay QR",
        }, 400);
      }
      const billId = String(
        invoice.fonepayBillId || invoice.invoiceNumber || "",
      ).trim();
      const amount = Number(invoice.total);
      if (!billId || !Number.isFinite(amount) || amount <= 0) {
        return c.json({
          error: "Invoice has no valid Fonepay reference or amount",
        }, 400);
      }
      const db = (await import("../database/init.ts")).getDatabase();
      const existingPayload = db.query(
        "SELECT qr_message, amount, bill_id FROM fonepay_qr_payloads WHERE invoice_id = ?",
        [id],
      ) as unknown[][];
      const stored = existingPayload[0];
      if (
        stored &&
        Math.round(Number(stored[1]) * 100) === Math.round(amount * 100) &&
        String(stored[2]) === billId &&
        String(stored[0]).trim()
      ) {
        return c.json({ qrMessage: String(stored[0]) });
      }

      const generated = await generateFonepayQr(amount, billId);
      db.query(
        `INSERT INTO fonepay_qr_payloads
         (invoice_id, qr_message, amount, bill_id, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(invoice_id) DO UPDATE SET
           qr_message = excluded.qr_message,
           amount = excluded.amount,
           bill_id = excluded.bill_id,
           created_at = excluded.created_at
         WHERE fonepay_qr_payloads.amount != excluded.amount
            OR fonepay_qr_payloads.bill_id != excluded.bill_id`,
        [id, generated.qrMessage, amount, billId, new Date().toISOString()],
      );
      const persisted = db.query(
        "SELECT qr_message FROM fonepay_qr_payloads WHERE invoice_id = ?",
        [id],
      ) as unknown[][];
      return c.json({
        qrMessage: String(persisted[0]?.[0] || generated.qrMessage),
      });
    } catch (e) {
      const msg = String(e);
      return c.json(
        { error: msg },
        /Fonepay|gateway|credentials|terminal/i.test(msg) ? 502 : 400,
      );
    }
  },
);

adminRoutes.post(
  "/fonepay/qr",
  requireAdminAuth,
  requirePermission("invoices", "read"),
  async (c) => {
    try {
      const body = await c.req.json();
      const amount = Number(body?.amount);
      const billId = typeof body?.billId === "string" ? body.billId.trim() : "";
      if (!Number.isFinite(amount) || amount <= 0 || !billId) {
        return c.json(
          { error: "A positive amount and bill ID are required" },
          400,
        );
      }
      return c.json(await generateFonepayQr(amount, billId));
    } catch (e) {
      const msg = String(e);
      if (/Fonepay|gateway|credentials|terminal/i.test(msg)) {
        return c.json({ error: msg }, 502);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

adminRoutes.post(
  "/fonepay/session",
  requireAdminAuth,
  requirePermission("invoices", "create"),
  async (c) => {
    const username = String(getSetting("fonepayUsername") || "").trim();
    const encryptedPassword = String(
      getSetting("fonepayPasswordEncrypted") || "",
    ).trim();
    if (!username || !encryptedPassword) {
      return c.json({ error: "Fonepay credentials are not configured" }, 409);
    }

    const password = await decryptFonepaySecret(encryptedPassword);
    if (!password) {
      return c.json({ error: "Stored Fonepay credentials are invalid" }, 500);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        "https://fonepay.nepdigitalaccess.workers.dev/api/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            password,
            secretKey: "",
            otpCode: "",
            recaptcha: "",
          }),
          signal: controller.signal,
        },
      );
      const textBody = await response.text();
      let result = null;
      try {
        result = textBody ? JSON.parse(textBody) : null;
      } catch {
        // Upstream gateways may return HTML or plain text for 403/502 responses.
      }
      if (!response.ok || !result?.isSuccess || !result?.accessToken) {
        console.error(
          "Fonepay upstream login rejected or returned invalid response",
          {
            status: response.status,
            message: typeof result?.message === "string"
              ? result.message
              : undefined,
            contentType: response.headers.get("content-type") || undefined,
          },
        );
        const message = response.status === 403
          ? "Fonepay gateway is blocking the Invio server"
          : response.status >= 500
          ? "Fonepay gateway is temporarily unavailable"
          : "Fonepay login failed";
        return c.json({ error: message }, 502);
      }
      // Return only the fields the dashboard needs. In particular, do not proxy
      // arbitrary fields from the upstream login response to the browser.
      return c.json({
        isSuccess: true,
        accessToken: String(result.accessToken),
        merchantId: result.merchantId ?? "",
        terminalId: result.terminalId ?? "",
        name: result.name ?? username,
        userName: username,
      });
    } catch (error) {
      console.error("Fonepay session request failed", error);
      return c.json({ error: "Fonepay session request failed" }, 502);
    } finally {
      clearTimeout(timeout);
    }
  },
);

// Optional admin-prefixed aliases for clarity/documentation parity
adminRoutes.get("/admin/settings", async (c) => {
  const settings = await getSettings();
  const map = settings.reduce(
    (acc: Record<string, string>, s) => {
      acc[s.key] = s.value as string;
      return acc;
    },
    {} as Record<string, string>,
  );
  if (map.companyEmail && !map.email) map.email = map.companyEmail;
  if (map.companyPhone && !map.phone) map.phone = map.companyPhone;
  if (map.companyTaxId && !map.taxId) map.taxId = map.companyTaxId;
  if (map.companyCountryCode && !map.countryCode) {
    map.countryCode = map.companyCountryCode;
  }
  if (map.logoUrl && !map.logo) map.logo = map.logoUrl;
  if (map.logoUrl) delete map.logoUrl;
  if (typeof map.logo === "string") {
    map.logo = normalizeStoredLogoReference(map.logo);
  }
  if (!map.locale) map.locale = "en";
  if (!map.dateFormat && map.date_format) map.dateFormat = map.date_format;
  if (!map.numberFormat && map.number_format) {
    map.numberFormat = map.number_format;
  }
  if (!map.postalCityFormat && map.postal_city_format) {
    map.postalCityFormat = map.postal_city_format;
  }
  if (!map.postalCityFormat && map.postalcityformat) {
    map.postalCityFormat = map.postalcityformat;
  }
  if (!map.dateFormat) map.dateFormat = "YYYY-MM-DD";
  if (!map.numberFormat) map.numberFormat = "comma";
  if (!map.postalCityFormat) map.postalCityFormat = "auto";
  if (!map.allowProtectedInvoiceChanges) {
    map.allowProtectedInvoiceChanges = "false";
  }
  // Never expose Fonepay credentials or encrypted values through settings.
  sanitizeFonepaySettingsMap(map);
  // Expose demo mode to frontend UI for admin-prefixed route as well
  (map as Record<string, unknown>).demoMode = DEMO_MODE ? "true" : "false";
  return c.json(map);
});

adminRoutes.put(
  "/admin/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize countryCode alias to companyCountryCode
    if (typeof data.countryCode === "string" && !data.companyCountryCode) {
      data.companyCountryCode = data.countryCode;
      delete data.countryCode;
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    await normalizeFonepaySettingsPayload(data);
    const settings = await updateSettings(data);
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    return c.json(sanitizeFonepaySettingsResults(settings));
  },
);

adminRoutes.patch(
  "/admin/settings",
  requirePermission("settings", "update"),
  async (c) => {
    const data = await c.req.json();
    if (typeof data.logoUrl === "string" && !data.logo) {
      data.logo = data.logoUrl;
      delete data.logoUrl;
    }
    if (typeof data.logo === "string" && data.logo.startsWith("data:image/")) {
      data.logo = await saveDataUrlLogo(data.logo);
    } else if (typeof data.logo === "string") {
      data.logo = normalizeStoredLogoReference(data.logo);
    }
    // Normalize countryCode alias to companyCountryCode
    if (typeof data.countryCode === "string" && !data.companyCountryCode) {
      data.companyCountryCode = data.countryCode;
      delete data.countryCode;
    }
    // Normalize tax-related settings
    normalizeTaxSettingsPayload(data);
    normalizeLocaleSettingPayload(data);
    normalizeInvoiceProtectionSettingsPayload(data);
    await normalizeFonepaySettingsPayload(data);
    const settings = await updateSettings(data);
    try {
      if ("logoUrl" in data) deleteSetting("logoUrl");
    } catch (_e) {
      /* ignore legacy cleanup errors */
    }
    return c.json(sanitizeFonepaySettingsResults(settings));
  },
);

// Customer routes
adminRoutes.get(
  "/customers",
  requirePermission("customers", "read"),
  async (c) => {
    const customers = await getCustomers();
    return c.json(customers);
  },
);

adminRoutes.get(
  "/customers/:id",
  requirePermission("customers", "read"),
  async (c) => {
    const id = c.req.param("id");
    const customer = await getCustomerById(id);
    if (!customer) {
      return c.json({ error: "Customer not found" }, 404);
    }
    return c.json(customer);
  },
);

adminRoutes.post(
  "/customers",
  requirePermission("customers", "create"),
  async (c) => {
    const data = await c.req.json();
    const customer = createCustomer(data);
    return c.json(customer);
  },
);

adminRoutes.put(
  "/customers/:id",
  requirePermission("customers", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    const customer = await updateCustomer(id, data);
    return c.json(customer);
  },
);

adminRoutes.delete(
  "/customers/:id",
  requirePermission("customers", "delete"),
  async (c) => {
    const id = c.req.param("id");
    await deleteCustomer(id);
    return c.json({ success: true });
  },
);

// Product routes
adminRoutes.get("/products", requirePermission("products", "read"), (c) => {
  const url = new URL(c.req.url);
  const includeInactive =
    url.searchParams.get("includeInactive")?.toLowerCase() === "true";
  const products = getProducts(includeInactive);
  return c.json(products);
});

adminRoutes.get(
  "/products/lookup",
  requirePermission("products", "read"),
  (c) => {
    const code = c.req.query("code") || "";
    const product = getProductByCode(code);
    if (!product) return c.json({ error: "Product not found" }, 404);
    return c.json(product);
  },
);

adminRoutes.get("/products/:id", requirePermission("products", "read"), (c) => {
  const id = c.req.param("id");
  const product = getProductById(id);
  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }
  return c.json(product);
});

adminRoutes.post(
  "/products",
  requirePermission("products", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const product = createProduct(data);
      return c.json(product, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.put(
  "/products/:id",
  requirePermission("products", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const product = updateProduct(id, data);
      if (!product) {
        return c.json({ error: "Product not found" }, 404);
      }
      return c.json(product);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.delete(
  "/products/:id",
  requirePermission("products", "delete"),
  (c) => {
    const id = c.req.param("id");
    try {
      deleteProduct(id);
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("not found")) {
        return c.json({ error: "Product not found" }, 404);
      }
      return c.json({ error: msg }, 400);
    }
  },
);

// Check if product is used in invoices
adminRoutes.get(
  "/products/:id/usage",
  requirePermission("products", "read"),
  (c) => {
    const id = c.req.param("id");
    const product = getProductById(id);
    if (!product) {
      return c.json({ error: "Product not found" }, 404);
    }
    const usedInInvoices = isProductUsedInInvoices(id);
    return c.json({ usedInInvoices });
  },
);

// Reactivate a soft-deleted product
adminRoutes.post(
  "/products/:id/reactivate",
  requirePermission("products", "update"),
  (c) => {
    const id = c.req.param("id");
    try {
      const product = reactivateProduct(id);
      if (!product) {
        return c.json({ error: "Product not found" }, 404);
      }
      return c.json(product);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// Product Categories
adminRoutes.get(
  "/product-categories",
  requirePermission("products", "read"),
  (c) => {
    const categories = getCategories();
    return c.json(categories);
  },
);

adminRoutes.get(
  "/product-categories/:id",
  requirePermission("products", "read"),
  (c) => {
    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }
    return c.json(category);
  },
);

adminRoutes.post(
  "/product-categories",
  requirePermission("products", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const category = createCategory(data);
      return c.json(category, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.put(
  "/product-categories/:id",
  requirePermission("products", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const category = updateCategory(id, data);
      if (!category) {
        return c.json({ error: "Category not found" }, 404);
      }
      return c.json(category);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.delete(
  "/product-categories/:id",
  requirePermission("products", "delete"),
  (c) => {
    const id = c.req.param("id");
    try {
      const deleted = deleteCategory(id);
      if (!deleted) {
        return c.json({ error: "Category not found" }, 404);
      }
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.get(
  "/product-categories/:id/usage",
  requirePermission("products", "read"),
  (c) => {
    const id = c.req.param("id");
    const usage = isCategoryUsed(id);
    return c.json(usage);
  },
);

// Product Units
adminRoutes.get(
  "/product-units",
  requirePermission("products", "read"),
  (c) => {
    const units = getUnits();
    return c.json(units);
  },
);

adminRoutes.get(
  "/product-units/:id",
  requirePermission("products", "read"),
  (c) => {
    if (!unit) {
      return c.json({ error: "Unit not found" }, 404);
    }
    return c.json(unit);
  },
);

adminRoutes.post(
  "/product-units",
  requirePermission("products", "create"),
  async (c) => {
    const data = await c.req.json();
    try {
      const unit = createUnit(data);
      return c.json(unit, 201);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.put(
  "/product-units/:id",
  requirePermission("products", "update"),
  async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    try {
      const unit = updateUnit(id, data);
      if (!unit) {
        return c.json({ error: "Unit not found" }, 404);
      }
      return c.json(unit);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.delete(
  "/product-units/:id",
  requirePermission("products", "delete"),
  (c) => {
    const id = c.req.param("id");
    try {
      const deleted = deleteUnit(id);
      if (!deleted) {
        return c.json({ error: "Unit not found" }, 404);
      }
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

adminRoutes.get(
  "/product-units/:id/usage",
  requirePermission("products", "read"),
  (c) => {
    const id = c.req.param("id");
    const usage = isUnitUsed(id);
    return c.json(usage);
  },
);

// Authenticated HTML/PDF generation for invoices by ID (no share token required)
adminRoutes.get(
  "/invoices/:id/html",
  requirePermission("invoices", "read"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) {
      return c.json({ message: "Invoice not found" }, 404);
    }

    // Settings map
    const settings = await getSettings();
    const settingsMap = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );
    if (!settingsMap.postalCityFormat && settingsMap.postal_city_format) {
      settingsMap.postalCityFormat = settingsMap.postal_city_format;
    }
    if (!settingsMap.postalCityFormat && settingsMap.postalcityformat) {
      settingsMap.postalCityFormat = settingsMap.postalcityformat;
    }
    if (!settingsMap.logo && settingsMap.logoUrl) {
      settingsMap.logo = settingsMap.logoUrl;
    }

    const businessSettings = {
      companyName: settingsMap.companyName || "Your Company",
      companyAddress: settingsMap.companyAddress || "",
      companyCity: settingsMap.companyCity || "",
      companyPostalCode: settingsMap.companyPostalCode || "",
      companyCountryCode: settingsMap.companyCountryCode || "",
      postalCityFormat: settingsMap.postalCityFormat || "auto",
      companyEmail: settingsMap.companyEmail || "",
      companyPhone: settingsMap.companyPhone || "",
      companyTaxId: settingsMap.companyTaxId || "",
      currency: settingsMap.currency || "USD",
      taxLabel: settingsMap.taxLabel || undefined,
      logo: settingsMap.logo,
      // brandLayout removed; always treating as logo-left in rendering
      paymentMethods: settingsMap.paymentMethods || "Bank Transfer",
      bankAccount: settingsMap.bankAccount || "",
      paymentTerms: settingsMap.paymentTerms || "Due in 30 days",
      defaultNotes: settingsMap.defaultNotes || "",
      locale: settingsMap.locale || undefined,
    };

    // Use template/highlight from settings only (no query overrides)
    const highlight = settingsMap.highlight ?? undefined;
    let selectedTemplateId: string | undefined = settingsMap.templateId
      ?.toLowerCase();
    if (
      selectedTemplateId === "professional" ||
      selectedTemplateId === "professional-modern"
    ) {
      selectedTemplateId = "professional-modern";
    } else if (
      selectedTemplateId === "minimalist" ||
      selectedTemplateId === "minimalist-clean"
    ) {
      selectedTemplateId = "minimalist-clean";
    }

    const customer = getCustomerById(invoice.customerId);
    const renderLocale = resolveInvoiceRenderLocale(
      invoice.locale,
      customer?.countryCode,
      settingsMap.locale,
    );

    const html = buildInvoiceHTML(
      invoice,
      businessSettings,
      selectedTemplateId,
      highlight,
      settingsMap.dateFormat,
      settingsMap.numberFormat,
      renderLocale,
    );
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
);

adminRoutes.get(
  "/invoices/:id/pdf",
  requirePermission("invoices", "export"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) {
      return c.json({ message: "Invoice not found" }, 404);
    }

    // Settings map
    const settings = await getSettings();
    const settingsMap = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );
    if (!settingsMap.postalCityFormat && settingsMap.postal_city_format) {
      settingsMap.postalCityFormat = settingsMap.postal_city_format;
    }
    if (!settingsMap.postalCityFormat && settingsMap.postalcityformat) {
      settingsMap.postalCityFormat = settingsMap.postalcityformat;
    }
    if (!settingsMap.logo && settingsMap.logoUrl) {
      settingsMap.logo = settingsMap.logoUrl;
    }

    const businessSettings = {
      companyName: settingsMap.companyName || "Your Company",
      companyAddress: settingsMap.companyAddress || "",
      companyCity: settingsMap.companyCity || "",
      companyPostalCode: settingsMap.companyPostalCode || "",
      companyCountryCode: settingsMap.companyCountryCode || "",
      postalCityFormat: settingsMap.postalCityFormat || "auto",
      companyEmail: settingsMap.companyEmail || "",
      companyPhone: settingsMap.companyPhone || "",
      companyTaxId: settingsMap.companyTaxId || "",
      currency: settingsMap.currency || "USD",
      taxLabel: settingsMap.taxLabel || undefined,
      logo: settingsMap.logo,
      // brandLayout removed; always treating as logo-left in rendering
      paymentMethods: settingsMap.paymentMethods || "Bank Transfer",
      bankAccount: settingsMap.bankAccount || "",
      paymentTerms: settingsMap.paymentTerms || "Due in 30 days",
      defaultNotes: settingsMap.defaultNotes || "",
      locale: settingsMap.locale || undefined,
    };

    // Use template/highlight from settings only (no query overrides)
    const highlight = settingsMap.highlight ?? undefined;
    let selectedTemplateId: string | undefined = settingsMap.templateId
      ?.toLowerCase();
    if (
      selectedTemplateId === "professional" ||
      selectedTemplateId === "professional-modern"
    ) {
      selectedTemplateId = "professional-modern";
    } else if (
      selectedTemplateId === "minimalist" ||
      selectedTemplateId === "minimalist-clean"
    ) {
      selectedTemplateId = "minimalist-clean";
    }

    try {
      const embedXml =
        String(settingsMap.embedXmlInPdf || "false").toLowerCase() === "true";
      const xmlProfileId = settingsMap.xmlProfileId || "ubl21";
      const customer = getCustomerById(invoice.customerId);
      const renderLocale = resolveInvoiceRenderLocale(
        invoice.locale,
        customer?.countryCode,
        settingsMap.locale,
      );

      const pdfBuffer = await generatePDF(
        invoice,
        businessSettings,
        selectedTemplateId,
        highlight,
        {
          embedXml,
          embedXmlProfileId: xmlProfileId,
          dateFormat: settingsMap.dateFormat,
          numberFormat: settingsMap.numberFormat,
          locale: renderLocale,
        },
      );
      // Detect embedded attachments for diagnostics
      let hasAttachment = false;
      let attachmentNames: string[] = [];
      try {
        // Dynamically import to avoid import cycles
        const { PDFDocument } = await import("pdf-lib");
        const doc = await PDFDocument.load(pdfBuffer);
        const maybe = (
          doc as unknown as {
            getAttachments?: () => Record<string, Uint8Array>;
          }
        ).getAttachments?.();
        if (maybe && typeof maybe === "object") {
          attachmentNames = Object.keys(maybe);
          hasAttachment = attachmentNames.length > 0;
        }
      } catch (_e) {
        /* ignore */
      }
      return new Response(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="invoice-${
            invoice.invoiceNumber || id
          }.pdf"`,
          ...(hasAttachment
            ? {
              "X-Embedded-XML": "true",
              "X-Embedded-XML-Names": attachmentNames.join(","),
            }
            : { "X-Embedded-XML": "false" }),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("/invoices/:id/pdf failed:", msg);
      return c.json({ error: "Failed to generate PDF", details: msg }, 500);
    }
  },
);

// Send invoice via email (SMTP2GO)
adminRoutes.post(
  "/invoices/:id/send-email",
  requirePermission("invoices", "export"),
  async (c) => {
    if (!isEmailConfigured()) {
      return c.json(
        {
          error:
            "Email is not configured. Set SMTP2GO_API_KEY and EMAIL_FROM_ADDRESS.",
        },
        503,
      );
    }

    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);

    let to: string[] = [];
    let subject = "";
    let message = "";
    try {
      const body = await c.req.json();
      to = Array.isArray(body.to)
        ? body.to.filter((e: unknown) =>
          typeof e === "string" && e.includes("@")
        )
        : [];
      subject = typeof body.subject === "string" ? body.subject.trim() : "";
      message = typeof body.message === "string" ? body.message.trim() : "";
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    if (to.length === 0) {
      return c.json(
        { error: "At least one valid recipient email is required" },
        400,
      );
    }
    if (!subject) {
      return c.json({ error: "Subject is required" }, 400);
    }

    // Build settings map (same as /pdf route)
    const settings = await getSettings();
    const settingsMap = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );
    if (!settingsMap.postalCityFormat && settingsMap.postal_city_format) {
      settingsMap.postalCityFormat = settingsMap.postal_city_format;
    }
    if (!settingsMap.logo && settingsMap.logoUrl) {
      settingsMap.logo = settingsMap.logoUrl;
    }

    const businessSettings = {
      companyName: settingsMap.companyName || "Your Company",
      companyAddress: settingsMap.companyAddress || "",
      companyCity: settingsMap.companyCity || "",
      companyPostalCode: settingsMap.companyPostalCode || "",
      companyCountryCode: settingsMap.companyCountryCode || "",
      postalCityFormat: settingsMap.postalCityFormat || "auto",
      companyEmail: settingsMap.companyEmail || "",
      companyPhone: settingsMap.companyPhone || "",
      companyTaxId: settingsMap.companyTaxId || "",
      currency: settingsMap.currency || "USD",
      taxLabel: settingsMap.taxLabel || undefined,
      logo: settingsMap.logo,
      paymentMethods: settingsMap.paymentMethods || "Bank Transfer",
      bankAccount: settingsMap.bankAccount || "",
      paymentTerms: settingsMap.paymentTerms || "Due in 30 days",
      defaultNotes: settingsMap.defaultNotes || "",
      locale: settingsMap.locale || undefined,
    };

    const highlight = settingsMap.highlight ?? undefined;
    let selectedTemplateId: string | undefined = settingsMap.templateId
      ?.toLowerCase();
    if (
      selectedTemplateId === "professional" ||
      selectedTemplateId === "professional-modern"
    ) {
      selectedTemplateId = "professional-modern";
    } else if (
      selectedTemplateId === "minimalist" ||
      selectedTemplateId === "minimalist-clean"
    ) {
      selectedTemplateId = "minimalist-clean";
    }

    // Generate PDF attachment
    let pdfBuffer: Uint8Array;
    try {
      const customer = getCustomerById(invoice.customerId);
      const renderLocale = resolveInvoiceRenderLocale(
        invoice.locale,
        customer?.countryCode,
        settingsMap.locale,
      );
      pdfBuffer = await generatePDF(
        invoice,
        businessSettings,
        selectedTemplateId,
        highlight,
        {
          embedXml: false,
          dateFormat: settingsMap.dateFormat,
          numberFormat: settingsMap.numberFormat,
          locale: renderLocale,
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Email: PDF generation failed:", msg);
      return c.json({
        error: "Failed to generate PDF attachment",
        details: msg,
      }, 500);
    }

    // Build email body
    const companyName = businessSettings.companyName;
    const invoiceNumber = invoice.invoiceNumber || invoice.id;
    const total = `${Number(invoice.total || 0).toFixed(2)} ${
      invoice.currency || ""
    }`.trim();
    const issueDate = invoice.issueDate
      ? new Date(invoice.issueDate).toISOString().slice(0, 10)
      : "";
    const dueDate = invoice.dueDate
      ? new Date(invoice.dueDate).toISOString().slice(0, 10)
      : null;
    const origin = c.req.header("origin") ||
      c.req.header("referer")?.replace(/\/$/, "") || "";
    const shareLink = invoice.shareToken && origin
      ? `${origin}/public/invoices/${invoice.shareToken}`
      : null;

    const messageHtml = message
      ? `<p style="white-space:pre-wrap;">${
        message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
          />/g,
          "&gt;",
        )
      }</p>`
      : "";
    const shareLinkHtml = shareLink
      ? `<p><a href="${shareLink}" style="color:#2563eb;">View invoice online</a></p>`
      : "";
    const dueDateHtml = dueDate
      ? `<tr><td style="padding:4px 8px;color:#6b7280;">Due date</td><td style="padding:4px 8px;">${dueDate}</td></tr>`
      : "";

    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="margin-top:0;">${companyName}</h2>
  ${messageHtml}
  <table style="border-collapse:collapse;margin:16px 0;width:auto;">
    <tr><td style="padding:4px 8px;color:#6b7280;">Invoice</td><td style="padding:4px 8px;font-weight:600;">#${invoiceNumber}</td></tr>
    <tr><td style="padding:4px 8px;color:#6b7280;">Issue date</td><td style="padding:4px 8px;">${issueDate}</td></tr>
    ${dueDateHtml}
    <tr><td style="padding:4px 8px;color:#6b7280;">Total</td><td style="padding:4px 8px;font-weight:600;">${total}</td></tr>
  </table>
  ${shareLinkHtml}
  <p style="color:#6b7280;font-size:13px;">The invoice PDF is attached to this email.</p>
</body>
</html>`;

    const textBody = [
      companyName,
      "",
      message || "",
      `Invoice: #${invoiceNumber}`,
      `Issue date: ${issueDate}`,
      dueDate ? `Due date: ${dueDate}` : "",
      `Total: ${total}`,
      shareLink ? `\nView online: ${shareLink}` : "",
    ].filter((l) => l !== undefined).join("\n").trim();

    try {
      await sendEmail({
        to,
        subject,
        htmlBody,
        textBody,
        attachment: {
          filename: `invoice-${invoiceNumber}.pdf`,
          content: pdfBuffer,
          mimeType: "application/pdf",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Email send failed:", msg);
      return c.json({ error: "Failed to send email", details: msg }, 502);
    }

    return c.json({ sent: true, recipients: to.length });
  },
);

// UBL (PEPPOL BIS Billing 3.0) XML for an invoice by ID
adminRoutes.get(
  "/invoices/:id/ubl.xml",
  requirePermission("invoices", "export"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) {
      return c.json({ message: "Invoice not found" }, 404);
    }

    const settings = await getSettings();
    const map = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );

    const businessSettings = {
      companyName: map.companyName || "Your Company",
      companyAddress: map.companyAddress || "",
      companyCity: map.companyCity || "",
      companyPostalCode: map.companyPostalCode || "",
      companyEmail: map.companyEmail || "",
      companyPhone: map.companyPhone || "",
      companyTaxId: map.companyTaxId || "",
      currency: map.currency || "USD",
      logo: map.logo,
      paymentMethods: map.paymentMethods || "Bank Transfer",
      bankAccount: map.bankAccount || "",
      paymentTerms: map.paymentTerms || "Due in 30 days",
      defaultNotes: map.defaultNotes || "",
      companyCountryCode: map.companyCountryCode || "",
    };

    // Optional PEPPOL endpoint IDs if configured in settings
    const xml = generateUBLInvoiceXML(invoice, businessSettings, {
      sellerEndpointId: map.peppolSellerEndpointId,
      sellerEndpointSchemeId: map.peppolSellerEndpointSchemeId,
      buyerEndpointId: map.peppolBuyerEndpointId,
      buyerEndpointSchemeId: map.peppolBuyerEndpointSchemeId,
      sellerCountryCode: map.companyCountryCode,
      buyerCountryCode: invoice.customer.countryCode,
    });

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoice-${
          invoice.invoiceNumber || id
        }.xml"`,
      },
    });
  },
);

// Generic XML export selecting an internal profile (?profile=ubl21 or stub-generic)
adminRoutes.get(
  "/invoices/:id/xml",
  requirePermission("invoices", "export"),
  async (c) => {
    const id = c.req.param("id");
    const invoice = getInvoiceById(id);
    if (!invoice) return c.json({ message: "Invoice not found" }, 404);

    const settings = await getSettings();
    const map = settings.reduce(
      (acc: Record<string, string>, s) => {
        acc[s.key] = s.value as string;
        return acc;
      },
      {} as Record<string, string>,
    );

    const businessSettings = {
      companyName: map.companyName || "Your Company",
      companyAddress: map.companyAddress || "",
      companyCity: map.companyCity || "",
      companyPostalCode: map.companyPostalCode || "",
      companyEmail: map.companyEmail || "",
      companyPhone: map.companyPhone || "",
      companyTaxId: map.companyTaxId || "",
      currency: map.currency || "USD",
      logo: map.logo,
      paymentMethods: map.paymentMethods || "Bank Transfer",
      bankAccount: map.bankAccount || "",
      paymentTerms: map.paymentTerms || "Due in 30 days",
      defaultNotes: map.defaultNotes || "",
      companyCountryCode: map.companyCountryCode || "",
    };

    const url = new URL(c.req.url);
    const profileParam = url.searchParams.get("profile") || map.xmlProfileId ||
      undefined;
    const { xml, profile } = generateInvoiceXML(
      profileParam,
      invoice,
      businessSettings,
      {
        sellerEndpointId: map.peppolSellerEndpointId,
        sellerEndpointSchemeId: map.peppolSellerEndpointSchemeId,
        buyerEndpointId: map.peppolBuyerEndpointId,
        buyerEndpointSchemeId: map.peppolBuyerEndpointSchemeId,
        sellerCountryCode: map.companyCountryCode,
        buyerCountryCode: invoice.customer.countryCode,
      },
    );

    return new Response(xml, {
      headers: {
        "Content-Type": `${profile.mediaType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="invoice-${
          invoice.invoiceNumber || id
        }.${profile.fileExtension}"`,
      },
    });
  },
);

// List built-in XML profiles
adminRoutes.get("/xml-profiles", requirePermission("invoices", "read"), (c) => {
  const profiles = listXMLProfiles().map((p) => ({
    id: p.id,
    name: p.name,
    mediaType: p.mediaType,
    fileExtension: p.fileExtension,
    experimental: !!p.experimental,
    builtIn: true,
  }));
  return c.json(profiles);
});

// =============================================
// User management routes
// =============================================
adminRoutes.use("/users/*", requireAdminAuth);

// GET /users/me — current authenticated user (any authenticated user)
adminRoutes.get("/users/me", (c) => {
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  // Return user info with permissions and available RESOURCE_ACTIONS map
  return c.json({
    ...user,
    availableResources: RESOURCE_ACTIONS,
  });
});

adminRoutes.post("/users/me/2fa/setup", (c) => {
  if (DEMO_MODE) {
    return c.json({ error: "2FA is not available in demo mode" }, 403);
  }
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  const setup = createPendingTwoFactorSetup(user.id, user.username);
  return c.json({
    otpAuthUrl: setup.otpAuthUrl,
    expiresIn: setup.expiresIn,
  });
});

adminRoutes.post("/users/me/2fa/verify", async (c) => {
  if (DEMO_MODE) {
    return c.json({ error: "2FA is not available in demo mode" }, 403);
  }
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  let token: string | undefined;
  try {
    const body = await c.req.json();
    if (body && typeof body.token === "string") token = body.token;
  } catch {
    // ignore parse errors
  }
  if (!token) return c.json({ error: "Missing 2FA token" }, 400);

  const result = verifyPendingTwoFactorSetup(user.id, user.username, token);
  if (!result.ok) return c.json({ error: result.reason }, 400);

  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);
  const encryptedSecret = await encryptTwoFactorSecret(result.secretBase32);
  setUserTwoFactorState(user.id, encryptedSecret, recoveryCodeHashes);

  return c.json({
    twoFactorEnabled: true,
    recoveryCodes,
  });
});

adminRoutes.delete("/users/me/2fa", async (c) => {
  if (DEMO_MODE) {
    return c.json({ error: "2FA is not available in demo mode" }, 403);
  }
  const user = getAuthUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);

  let token: string | undefined;
  try {
    const body = await c.req.json();
    if (body && typeof body.token === "string") token = body.token;
  } catch {
    // ignore parse errors
  }
  if (!token) return c.json({ error: "Missing 2FA token" }, 400);

  const state = getUserTwoFactorState(user.id);
  if (!state?.enabled || !state.encryptedSecret) {
    return c.json({ error: "2FA is not enabled" }, 400);
  }

  const secret = await decryptTwoFactorSecret(state.encryptedSecret);
  if (!secret || !verifyTotpToken(secret, user.username, token)) {
    return c.json({ error: "Invalid 2FA token" }, 401);
  }

  disableUserTwoFactor(user.id);
  return c.json({ twoFactorEnabled: false });
});

// GET /users/permissions-schema — returns the valid resources and actions
adminRoutes.get("/users/permissions-schema", (c) => {
  const user = getAuthUser(c);
  const canViewSchema = !!user &&
    (user.isAdmin ||
      user.permissions.some(
        (p) =>
          p.resource === "users" &&
          (p.action === "read" ||
            p.action === "create" ||
            p.action === "update"),
      ));
  if (!canViewSchema) {
    return c.json(
      { error: "Missing permission: users:read|create|update" },
      403,
    );
  }

  return c.json({
    resources: RESOURCES,
    resourceActions: RESOURCE_ACTIONS,
  });
});

// GET /users — list all users
adminRoutes.get("/users", requirePermission("users", "read"), (c) => {
  const users = listUsers();
  return c.json(users);
});

// POST /users — create a new user
adminRoutes.post("/users", requirePermission("users", "create"), async (c) => {
  try {
    const data = await c.req.json();
    const user = await createUserCtrl(data);
    return c.json(user, 201);
  } catch (e) {
    const msg = String(e);
    if (/already exists/i.test(msg)) return c.json({ error: msg }, 409);
    return c.json({ error: msg }, 400);
  }
});

// GET /users/:id — get user details
adminRoutes.get("/users/:id", requirePermission("users", "read"), (c) => {
  const id = c.req.param("id");
  const user = getUserByIdCtrl(id);
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

// PUT /users/:id — update user
adminRoutes.put(
  "/users/:id",
  requirePermission("users", "update"),
  async (c) => {
    const id = c.req.param("id");
    try {
      const data = await c.req.json();
      const currentUser = getAuthUser(c);

      // Prevent admin from demoting themselves
      if (currentUser.id === id && data.isAdmin === false) {
        return c.json({ error: "Cannot remove your own admin status" }, 400);
      }
      // Prevent admin from deactivating themselves
      if (currentUser.id === id && data.isActive === false) {
        return c.json({ error: "Cannot deactivate your own account" }, 400);
      }

      const user = await updateUserCtrl(id, data);
      return c.json(user);
    } catch (e) {
      const msg = String(e);
      if (/already exists/i.test(msg)) return c.json({ error: msg }, 409);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// DELETE /users/:id — delete user
adminRoutes.delete("/users/:id", requirePermission("users", "delete"), (c) => {
  const id = c.req.param("id");
  try {
    deleteUserCtrl(id);
    return c.json({ success: true });
  } catch (e) {
    const msg = String(e);
    if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
    if (/last admin/i.test(msg)) return c.json({ error: msg }, 400);
    return c.json({ error: msg }, 400);
  }
});

// =========================================================
// Suppliers
// =========================================================
adminRoutes.get("/suppliers", requirePermission("suppliers", "read"), (c) => {
  try {
    return c.json(getSuppliers());
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});
adminRoutes.get(
  "/suppliers/:id",
  requirePermission("suppliers", "read"),
  (c) => {
    const supplier = getSupplierById(c.req.param("id"));
    if (!supplier) return c.json({ error: "Supplier not found" }, 404);
    return c.json(supplier);
  },
);
adminRoutes.post(
  "/suppliers",
  requirePermission("suppliers", "create"),
  async (c) => {
    try {
      return c.json(createSupplier(await c.req.json()));
    } catch (e) {
      const msg = String(e);
      if (/required/i.test(msg)) return c.json({ error: msg }, 400);
      return c.json({ error: msg }, 400);
    }
  },
);
adminRoutes.put(
  "/suppliers/:id",
  requirePermission("suppliers", "update"),
  async (c) => {
    try {
      const supplier = updateSupplier(c.req.param("id"), await c.req.json());
      if (!supplier) return c.json({ error: "Supplier not found" }, 404);
      return c.json(supplier);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.delete(
  "/suppliers/:id",
  requirePermission("suppliers", "delete"),
  (c) => {
    try {
      const id = c.req.param("id");
      if (isSupplierUsed(id)) {
        return c.json(
          {
            error:
              "Cannot delete this supplier because they are linked to expenses or purchase orders. Delete or reassign those records first.",
          },
          400,
        );
      }
      deleteSupplier(id);
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// =========================================================
// Expenses
// =========================================================
adminRoutes.get("/expenses", requirePermission("expenses", "read"), (c) => {
  try {
    return c.json(getExpenses());
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});
adminRoutes.get(
  "/expenses/categories",
  requirePermission("expenses", "read"),
  (c) => {
    try {
      return c.json(getExpenseCategories());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.get("/expenses/:id", requirePermission("expenses", "read"), (c) => {
  const expense = getExpenseById(c.req.param("id"));
  if (!expense) return c.json({ error: "Expense not found" }, 404);
  return c.json(expense);
});
adminRoutes.post(
  "/expenses",
  requirePermission("expenses", "create"),
  async (c) => {
    try {
      return c.json(createExpense(await c.req.json()));
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.put(
  "/expenses/:id",
  requirePermission("expenses", "update"),
  async (c) => {
    try {
      const expense = updateExpense(c.req.param("id"), await c.req.json());
      if (!expense) return c.json({ error: "Expense not found" }, 404);
      return c.json(expense);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.delete(
  "/expenses/:id",
  requirePermission("expenses", "delete"),
  (c) => {
    try {
      deleteExpense(c.req.param("id"));
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// =========================================================
// Purchase orders
// =========================================================
adminRoutes.get(
  "/purchase-orders",
  requirePermission("purchase_orders", "read"),
  (c) => {
    try {
      return c.json(getPurchaseOrders());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.get(
  "/purchase-orders/next-number",
  requirePermission("purchase_orders", "read"),
  (c) => {
    return c.json({ next: nextPurchaseOrderNumber() });
  },
);
adminRoutes.get(
  "/purchase-orders/:id",
  requirePermission("purchase_orders", "read"),
  (c) => {
    const po = getPurchaseOrderById(c.req.param("id"));
    if (!po) return c.json({ error: "Purchase order not found" }, 404);
    return c.json(po);
  },
);
adminRoutes.post(
  "/purchase-orders",
  requirePermission("purchase_orders", "create"),
  async (c) => {
    try {
      return c.json(createPurchaseOrder(await c.req.json()));
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/purchase-orders/:id/receive",
  requirePermission("purchase_orders", "update"),
  (c) => {
    try {
      const po = receivePurchaseOrder(c.req.param("id"));
      if (!po) return c.json({ error: "Purchase order not found" }, 404);
      return c.json(po);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/purchase-orders/:id/void",
  requirePermission("purchase_orders", "update"),
  (c) => {
    try {
      const po = voidPurchaseOrder(c.req.param("id"));
      if (!po) return c.json({ error: "Purchase order not found" }, 404);
      return c.json(po);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.delete(
  "/purchase-orders/:id",
  requirePermission("purchase_orders", "delete"),
  (c) => {
    try {
      deletePurchaseOrder(c.req.param("id"));
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// =========================================================
// Quotes / estimates
// =========================================================
adminRoutes.get("/quotes", requirePermission("quotes", "read"), (c) => {
  try {
    return c.json(getQuotes());
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});
adminRoutes.get(
  "/quotes/next-number",
  requirePermission("quotes", "read"),
  (c) => {
    return c.json({ next: nextQuoteNumber() });
  },
);
adminRoutes.get("/quotes/:id", requirePermission("quotes", "read"), (c) => {
  const quote = getQuoteById(c.req.param("id"));
  if (!quote) return c.json({ error: "Quote not found" }, 404);
  return c.json(quote);
});
adminRoutes.post(
  "/quotes",
  requirePermission("quotes", "create"),
  async (c) => {
    try {
      return c.json(createQuote(await c.req.json()));
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.put(
  "/quotes/:id",
  requirePermission("quotes", "update"),
  async (c) => {
    try {
      const quote = updateQuote(c.req.param("id"), await c.req.json());
      if (!quote) return c.json({ error: "Quote not found" }, 404);
      return c.json(quote);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/quotes/:id/status",
  requirePermission("quotes", "update"),
  async (c) => {
    try {
      const body = await c.req.json();
      const quote = setQuoteStatus(c.req.param("id"), body.status);
      if (!quote) return c.json({ error: "Quote not found" }, 404);
      return c.json(quote);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/quotes/:id/duplicate",
  requirePermission("quotes", "create"),
  (c) => {
    try {
      const quote = duplicateQuote(c.req.param("id"));
      return c.json(quote);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/quotes/:id/convert",
  requirePermission("quotes", "create"),
  async (c) => {
    try {
      const result = await convertQuoteToInvoice(c.req.param("id"));
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.delete(
  "/quotes/:id",
  requirePermission("quotes", "delete"),
  (c) => {
    try {
      deleteQuote(c.req.param("id"));
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// =========================================================
// Credit notes
// =========================================================
adminRoutes.get(
  "/credit-notes",
  requirePermission("credit_notes", "read"),
  (c) => {
    try {
      return c.json(getCreditNotes());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.get(
  "/credit-notes/next-number",
  requirePermission("credit_notes", "read"),
  (c) => {
    return c.json({ next: nextCreditNumber() });
  },
);
adminRoutes.get(
  "/credit-notes/:id",
  requirePermission("credit_notes", "read"),
  (c) => {
    const cn = getCreditNoteById(c.req.param("id"));
    if (!cn) return c.json({ error: "Credit note not found" }, 404);
    return c.json(cn);
  },
);
adminRoutes.post(
  "/credit-notes",
  requirePermission("credit_notes", "create"),
  async (c) => {
    try {
      return c.json(createCreditNote(await c.req.json()));
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/credit-notes/:id/void",
  requirePermission("credit_notes", "update"),
  (c) => {
    try {
      const cn = voidCreditNote(c.req.param("id"));
      if (!cn) return c.json({ error: "Credit note not found" }, 404);
      return c.json(cn);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.delete(
  "/credit-notes/:id",
  requirePermission("credit_notes", "delete"),
  (c) => {
    try {
      deleteCreditNote(c.req.param("id"));
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// =========================================================
// Recurring invoices
// =========================================================
adminRoutes.get(
  "/recurring",
  requirePermission("recurring_invoices", "read"),
  (c) => {
    try {
      return c.json(getRecurringInvoices());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.get(
  "/recurring/:id",
  requirePermission("recurring_invoices", "read"),
  (c) => {
    const rec = getRecurringInvoiceById(c.req.param("id"));
    if (!rec) return c.json({ error: "Recurring invoice not found" }, 404);
    return c.json(rec);
  },
);
adminRoutes.post(
  "/recurring",
  requirePermission("recurring_invoices", "create"),
  async (c) => {
    try {
      return c.json(createRecurringInvoice(await c.req.json()));
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/recurring/process",
  requirePermission("recurring_invoices", "create"),
  async (c) => {
    try {
      const created = await processDueRecurringInvoices();
      return c.json({ created });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.put(
  "/recurring/:id",
  requirePermission("recurring_invoices", "update"),
  async (c) => {
    try {
      const rec = updateRecurringInvoice(c.req.param("id"), await c.req.json());
      if (!rec) return c.json({ error: "Recurring invoice not found" }, 404);
      return c.json(rec);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.delete(
  "/recurring/:id",
  requirePermission("recurring_invoices", "delete"),
  (c) => {
    try {
      deleteRecurringInvoice(c.req.param("id"));
      return c.json({ success: true });
    } catch (e) {
      const msg = String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  },
);

// =========================================================
// Payments / reminders / statement
// =========================================================
adminRoutes.post(
  "/invoices/:id/payments",
  requirePermission("invoices", "update"),
  async (c) => {
    try {
      const invoice = await addManualPayment(
        c.req.param("id"),
        await c.req.json(),
      );
      return c.json(invoice);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.delete(
  "/invoices/:id/payments/:paymentId",
  requirePermission("invoices", "update"),
  (c) => {
    try {
      deleteManualPayment(c.req.param("paymentId"), c.req.param("id"));
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.get(
  "/customers/:id/statement",
  requirePermission("customers", "read"),
  (c) => {
    const statement = getCustomerStatement(c.req.param("id"));
    if (!statement) return c.json({ error: "Customer not found" }, 404);
    return c.json(statement);
  },
);
adminRoutes.post(
  "/invoices/:id/remind",
  requirePermission("invoices", "update"),
  async (c) => {
    try {
      const result = await sendPaymentReminder(
        c.req.param("id"),
        trustedBaseUrl(c),
      );
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);
adminRoutes.post(
  "/invoices/bulk-remind",
  requirePermission("invoices", "update"),
  async (c) => {
    try {
      const body = await c.req.json();
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (ids.length === 0) {
        return c.json({ error: "No invoices selected" }, 400);
      }
      const result = await bulkSendReminders(ids, trustedBaseUrl(c));
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

// =========================================================
// CSV exports (also available under /export/* auth)
// =========================================================
adminRoutes.get(
  "/export/invoices.csv",
  requirePermission("invoices", "export"),
  (c) => {
    const ids = (c.req.query("ids") || "").split(",").map((s) => s.trim())
      .filter(Boolean);
    const csv = invoicesToCsv(ids.length > 0 ? ids : undefined);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="invoices.csv"',
      },
    });
  },
);
adminRoutes.get(
  "/export/customers.csv",
  requirePermission("customers", "read"),
  (c) => {
    return new Response(customersToCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="customers.csv"',
      },
    });
  },
);
adminRoutes.get(
  "/export/products.csv",
  requirePermission("products", "read"),
  (c) => {
    return new Response(productsToCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="products.csv"',
      },
    });
  },
);

// =========================================================
// Dashboard KPIs / stock
// =========================================================
adminRoutes.get(
  "/dashboard/kpis",
  requirePermission("invoices", "read"),
  (c) => {
    try {
      return c.json(getDashboardKpis());
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.get(
  "/products/:id/stock",
  requirePermission("products", "read"),
  (c) => {
    try {
      const stock = getProductStock(c.req.param("id"));
      const movements = getStockMovements(c.req.param("id"));
      return c.json({ stock, movements });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  },
);
adminRoutes.post(
  "/products/:id/stock",
  requirePermission("products", "update"),
  async (c) => {
    try {
      const body = await c.req.json();
      const delta = Number(body.delta) || 0;
      const note = body.note ? String(body.note) : undefined;
      applyStockAdjustment(c.req.param("id"), delta, note);
      return c.json({
        success: true,
        stock: getProductStock(c.req.param("id")),
      });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  },
);

/**
 * Prefer an explicitly configured APP_URL (trusted) for building public links
 * in emails; only fall back to the request Origin header (which clients can
 * spoof) when no APP_URL is set.
 */
function trustedBaseUrl(c: unknown): string {
  const envBase = (getEnv("APP_URL") || "").trim().replace(/\/+$/, "");
  if (envBase) return envBase;
  const ctx = c as {
    req: { header: (name: string) => string | undefined; url: string };
  };
  const origin = ctx.req.header("origin") || ctx.req.url;
  try {
    return new URL(origin).origin || "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}

export { adminRoutes };
