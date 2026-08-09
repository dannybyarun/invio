export interface Customer {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string; // ISO 3166-1 alpha-2
  taxId?: string;
  reference?: string; // BuyerReference or order ref
  createdAt: Date;
  customerNumber?: number; // permanent sequential number, assigned at creation
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  unitPrice: number;
  sku?: string;
  barcode?: string;
  unit?: string; // piece, hour, day, kg, m, etc.
  category?: string; // service, goods, subscription, etc.
  taxDefinitionId?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  costPrice?: number; // purchase cost per unit (for profit tracking)
  quantityOnHand?: number; // current stock (kept in sync with stock_movements)
  reorderLevel?: number; // low-stock threshold
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  issueDate: Date;
  dueDate?: Date;
  currency: string;
  status: "draft" | "sent" | "complete" | "paid" | "overdue" | "voided";

  // Totals
  subtotal: number;
  discountAmount: number;
  discountPercentage: number;
  taxRate: number;
  taxAmount: number;
  total: number;

  // Tax behavior flags
  pricesIncludeTax?: boolean; // whether unit prices are tax-inclusive
  roundingMode?: string; // 'line' or 'total'

  // Payment and notes
  paymentTerms?: string;
  notes?: string;
  paymentMethod?: string;
  fonepayQrType?: "static" | "dynamic";
  fonepayQrData?: string;
  fonepayBillId?: string;
  fonepayQrAmount?: number;
  fonepayTransactionId?: string;
  fonepayVerifiedAt?: Date;

  // Multi-currency & derived payment state
  exchangeRate?: number; // 1 invoice currency = N base currency
  amountPaid?: number; // manual payments + verified gateway payments
  amountDue?: number; // total - amountPaid - credit notes applied
  creditApplied?: number; // sum of issued credit notes tied to this invoice
  sourceQuoteId?: string;

  // Locale overrides
  locale?: string;

  // System fields
  shareToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productId?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  lineTotal: number;
  notes?: string;
  sortOrder: number;
  taxes?: InvoiceItemTax[];
}

export interface InvoiceAttachment {
  id: string;
  invoiceId: string;
  filename: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
}

export type TemplateType = "local" | "remote" | "builtin";

export interface Template {
  id: string;
  name: string;
  html: string;
  isDefault: boolean;
  templateType: TemplateType;
  createdAt: Date;
}

export interface Setting {
  key: string;
  value: string;
}

export interface BusinessSettings {
  companyName: string;
  companyAddress?: string;
  companyCity?: string;
  companyPostalCode?: string;
  postalCityFormat?: "auto" | "city-postal" | "postal-city";
  companyEmail?: string;
  companyPhone?: string;
  companyTaxId?: string;
  companyCountryCode?: string; // ISO alpha-2
  currency: string;
  taxLabel?: string; // e.g. "GST", "VAT", "Sales tax"
  logo?: string;
  paymentMethods?: string;
  bankAccount?: string;
  paymentTerms?: string;
  defaultNotes?: string;
  locale?: string;
}

// Normalized tax types
export interface TaxDefinition {
  id: string;
  code?: string;
  name?: string;
  percent: number;
  categoryCode?: string; // UBL: S, Z, E, etc.
  countryCode?: string;
  vendorSpecificId?: string;
  defaultIncluded?: boolean;
  metadata?: string; // JSON string
}

export interface InvoiceItemTax {
  id: string;
  invoiceItemId: string;
  taxDefinitionId?: string;
  percent: number;
  taxableAmount: number;
  amount: number;
  included: boolean;
  sequence?: number;
  note?: string;
}

export interface InvoiceTax {
  id: string;
  invoiceId: string;
  taxDefinitionId?: string;
  percent: number;
  taxableAmount: number;
  taxAmount: number;
}

// =============================================
// Multi-user system types
// =============================================

export const RESOURCES = [
  "invoices",
  "quick_sell",
  "customers",
  "products",
  "templates",
  "settings",
  "tax_definitions",
  "users",
  "suppliers",
  "expenses",
  "purchase_orders",
  "quotes",
  "credit_notes",
  "recurring_invoices",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  "read",
  "use",
  "create",
  "update",
  "delete",
  "publish",
  "void",
  "export",
  "install",
] as const;

export type Action = (typeof ACTIONS)[number];

/** Defines which actions are meaningful for each resource */
export const RESOURCE_ACTIONS: Record<Resource, readonly Action[]> = {
  invoices: ["read", "create", "update", "delete", "publish", "void", "export"],
  quick_sell: ["use"],
  customers: ["read", "create", "update", "delete"],
  products: ["read", "create", "update", "delete"],
  templates: ["read", "create", "update", "delete", "install"],
  settings: ["read", "update"],
  tax_definitions: ["read", "create", "update", "delete"],
  users: ["read", "create", "update", "delete"],
  suppliers: ["read", "create", "update", "delete"],
  expenses: ["read", "create", "update", "delete"],
  purchase_orders: ["read", "create", "update", "delete"],
  quotes: ["read", "create", "update", "delete"],
  credit_notes: ["read", "create", "update", "delete"],
  recurring_invoices: ["read", "create", "update", "delete"],
};

export interface Permission {
  resource: Resource;
  action: Action;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  isActive: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithPermissions extends User {
  permissions: Permission[];
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  permissions?: Permission[];
}

export interface UpdateUserRequest {
  username?: string;
  email?: string;
  displayName?: string;
  password?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  permissions?: Permission[];
}

// Request/Response types for API
export interface CreateInvoiceRequest {
  customerId: string;
  invoiceNumber?: string;
  issueDate?: string | Date;
  dueDate?: string | Date;
  currency?: string;
  status?: "draft" | "sent" | "complete" | "paid" | "overdue" | "voided";

  // Totals (optional, will be calculated if not provided)
  discountAmount?: number;
  discountPercentage?: number;
  taxRate?: number;
  taxDefinitionId?: string | null;

  // Tax behavior flags
  pricesIncludeTax?: boolean;
  roundingMode?: string; // 'line' | 'total'

  // Payment and notes
  paymentTerms?: string;
  notes?: string;
  paymentMethod?: string;
  fonepayQrType?: "static" | "dynamic";
  fonepayQrData?: string;
  fonepayBillId?: string;
  fonepayQrAmount?: number;

  // Items
  items: {
    productId?: string;
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
    notes?: string;
    // Optional per-line taxes (advanced). If omitted, falls back to invoice-level taxRate
    taxes?: Array<{
      percent: number; // e.g., 20 for 20%
      taxDefinitionId?: string;
      code?: string; // e.g., "S" (standard), "Z" (zero), etc.
      included?: boolean; // whether line unitPrice includes this tax
      note?: string;
    }>;
  }[];
}

export interface UpdateInvoiceRequest extends Partial<CreateInvoiceRequest> {
  id: string;
  paymentMethod?: string; // optionally record payment method when status → 'paid'
}

export interface CreateCustomerRequest {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string; // ISO alpha-2
  taxId?: string;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  unitPrice: number;
  sku?: string;
  barcode?: string;
  unit?: string;
  category?: string;
  taxDefinitionId?: string;
  costPrice?: number;
  quantityOnHand?: number;
  reorderLevel?: number;
}

// =============================================
// Inventory / stock types
// =============================================

export type StockReason =
  | "sale"
  | "void"
  | "purchase"
  | "return"
  | "adjustment"
  | "opening";

export interface StockMovement {
  id: string;
  productId: string;
  quantity: number; // signed
  reason: StockReason;
  refType?: string; // invoice | credit_note | purchase_order | product
  refId?: string;
  note?: string;
  createdAt: Date;
}

// =============================================
// Suppliers / expenses / purchase orders
// =============================================

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupplierRequest {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  notes?: string;
}

export interface Expense {
  id: string;
  expenseDate: string;
  supplierId?: string;
  category?: string;
  description?: string;
  amount: number;
  taxAmount: number;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseRequest {
  expenseDate: string;
  supplierId?: string;
  category?: string;
  description?: string;
  amount: number;
  taxAmount?: number;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId?: string;
  orderDate: string;
  status: "draft" | "ordered" | "received" | "voided";
  notes?: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  receivedAt?: string;
  createdAt: Date;
  updatedAt: Date;
  items?: PurchaseOrderItem[];
  supplierName?: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CreatePurchaseOrderRequest {
  supplierId?: string;
  orderDate: string;
  notes?: string;
  taxRate?: number;
  items: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
}

// =============================================
// Quotes / estimates
// =============================================

export type QuoteStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "converted";

export interface Quote {
  id: string;
  quoteNumber: string;
  customerId: string;
  issueDate: string;
  expiryDate?: string;
  isExpired?: boolean;
  currency: string;
  status: QuoteStatus;
  subtotal: number;
  discountAmount: number;
  discountPercentage: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentTerms?: string;
  notes?: string;
  convertedInvoiceId?: string;
  createdAt: Date;
  updatedAt: Date;
  customer?: Customer;
  items?: QuoteItem[];
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  productId?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
}

export interface CreateQuoteRequest {
  customerId: string;
  issueDate?: string;
  expiryDate?: string;
  currency?: string;
  discountAmount?: number;
  discountPercentage?: number;
  taxRate?: number;
  paymentTerms?: string;
  notes?: string;
  items: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
  }>;
}

// =============================================
// Credit notes / refunds
// =============================================

export interface CreditNote {
  id: string;
  creditNumber: string;
  invoiceId?: string;
  customerId: string;
  issueDate: string;
  reason?: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  status: "issued" | "voided";
  createdAt: Date;
  updatedAt: Date;
  customer?: Customer;
  invoiceNumber?: string;
  items?: CreditNoteItem[];
}

export interface CreditNoteItem {
  id: string;
  creditNoteId: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
}

export interface CreateCreditNoteRequest {
  invoiceId?: string;
  customerId: string;
  issueDate?: string;
  reason?: string;
  taxRate?: number;
  items: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
}

// =============================================
// Recurring invoices
// =============================================

export interface RecurringInvoice {
  id: string;
  name: string;
  customerId: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  intervalCount: number;
  nextRunDate: string;
  lastRunDate?: string;
  endDate?: string;
  defaultStatus: "draft" | "sent";
  isActive: boolean;
  templateJson: string; // invoice payload template
  createdAt: Date;
  updatedAt: Date;
  customerName?: string;
}

export interface CreateRecurringInvoiceRequest {
  name: string;
  customerId: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  intervalCount?: number;
  nextRunDate?: string;
  endDate?: string;
  defaultStatus?: "draft" | "sent";
  isActive?: boolean;
  currency?: string;
  discountPercentage?: number;
  discountAmount?: number;
  taxRate?: number;
  paymentTerms?: string;
  notes?: string;
  items: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
  }>;
}

// =============================================
// Payments / statements / reminders
// =============================================

export interface InvoicePayment {
  id: string;
  invoiceId: string;
  amount: number;
  method?: string;
  reference?: string;
  note?: string;
  paidAt: Date;
  createdAt: Date;
  source: "manual" | "gateway";
  provider?: string;
}

export interface AddPaymentRequest {
  amount: number;
  method?: string;
  reference?: string;
  note?: string;
  paidAt?: string;
}

export interface StatementEntry {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  status: string;
  total: number;
  paid: number;
  credited: number;
  balance: number; // running balance
}

export interface CustomerStatement {
  customerId: string;
  customerName: string;
  entries: StatementEntry[];
  totalBilled: number;
  totalPaid: number;
  totalCredited: number;
  outstanding: number;
}

export interface StatusHistoryEntry {
  id: string;
  invoiceId: string;
  status: string;
  changedAt: Date;
  paymentMethod?: string;
  note?: string;
}

export interface PaymentTransaction {
  id: string;
  invoiceId: string;
  provider: string;
  providerTransactionId: string;
  providerReference?: string;
  amount: number;
  verifiedAt: Date;
}

export interface InvoiceWithDetails extends Invoice {
  customer: Customer;
  items: InvoiceItem[];
  attachments?: InvoiceAttachment[];
  taxes?: InvoiceTax[];
  statusHistory?: StatusHistoryEntry[];
  paymentTransactions?: PaymentTransaction[];
  payments?: Array<InvoicePayment | PaymentTransaction>;
}

// Template rendering context
import type { InvoiceLabels } from "../i18n/translations.ts";

export interface TemplateContext {
  // Company info
  companyName: string;
  companyAddress: string;
  companyCity?: string;
  companyPostalCode?: string;
  companyPostalCity?: string;
  companyEmail: string;
  companyPhone: string;
  companyTaxId?: string;
  companyCountryCode?: string;

  // Invoice info
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  status: string;

  // Customer info
  customerName: string;
  customerContactName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerCity?: string;
  customerPostalCode?: string;
  customerCountryCode?: string;
  customerPostalCity?: string;
  customerTaxId?: string;

  // Items
  items: Array<{
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: string;
    lineTotal: string;
    notes?: string;
  }>;
  hasItemUnits?: boolean;

  // Totals
  subtotal: string;
  discountAmount?: string;
  discountPercentage?: number;
  taxRate?: number; // kept for backward compatibility (single-rate mode)
  taxAmount?: string; // kept for backward compatibility
  total: string;
  // Advanced tax summary (grouped by rate/code)
  taxSummary?: Array<{
    label: string; // e.g., "VAT 20% (S)"
    percent: number;
    taxable: string; // formatted amount
    amount: string; // formatted amount
  }>;
  hasTaxSummary?: boolean;

  // Flags
  hasDiscount: boolean;
  hasTax: boolean;

  // Payment info
  paymentTerms?: string;
  paymentMethods?: string;
  bankAccount?: string;
  fonepayQrType?: "static" | "dynamic";
  fonepayQrDataUrl?: string;

  // Notes
  notes?: string;

  // Internationalization
  locale: string;
  labels: InvoiceLabels;
}
