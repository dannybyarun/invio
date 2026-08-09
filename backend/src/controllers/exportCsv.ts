/**
 * CSV Export Controller
 * Generates UTF-8 (BOM-prefixed) CSV for invoices, customers, and products.
 */
import { getInvoices } from "./invoices.ts";
import { getCustomers } from "./customers.ts";
import { getProducts } from "./products.ts";

const esc = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rowsToCsv = (header: string[], rows: (unknown[] | null)[]): string => {
  const lines = [header.map(esc).join(",")];
  for (const row of rows) {
    if (row) lines.push(row.map(esc).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
};

const fmtDate = (d?: Date | string): string => {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toISOString().slice(0, 10);
};

export function invoicesToCsv(ids?: string[]): string {
  const invoices = ids && ids.length > 0
    ? getInvoices().filter((i) => ids.includes(i.id))
    : getInvoices();
  const rows = invoices.map((i) => [
    i.invoiceNumber,
    fmtDate(i.issueDate),
    fmtDate(i.dueDate),
    i.customerId,
    i.status,
    i.currency,
    i.subtotal,
    i.discountAmount,
    i.taxRate,
    i.taxAmount,
    i.total,
    i.amountPaid ?? "",
    i.amountDue ?? "",
    i.paymentMethod ?? "",
    i.notes ?? "",
  ]);
  return rowsToCsv(
    [
      "Invoice Number",
      "Issue Date",
      "Due Date",
      "Customer ID",
      "Status",
      "Currency",
      "Subtotal",
      "Discount",
      "Tax %",
      "Tax Amount",
      "Total",
      "Paid",
      "Due",
      "Payment Method",
      "Notes",
    ],
    rows,
  );
}

export function customersToCsv(): string {
  const customers = getCustomers();
  const rows = customers.map((c) => [
    c.customerNumber ?? "",
    c.name,
    c.contactName ?? "",
    c.email ?? "",
    c.phone ?? "",
    c.address ?? "",
    c.city ?? "",
    c.postalCode ?? "",
    c.countryCode ?? "",
    c.taxId ?? "",
  ]);
  return rowsToCsv(
    [
      "Customer #",
      "Name",
      "Contact Name",
      "Email",
      "Phone",
      "Address",
      "City",
      "Postal Code",
      "Country",
      "Tax ID",
    ],
    rows,
  );
}

export function productsToCsv(): string {
  const products = getProducts(true);
  const rows = products.map((p) => [
    p.name,
    p.sku ?? "",
    p.barcode ?? "",
    p.unitPrice,
    p.costPrice ?? "",
    p.quantityOnHand ?? "",
    p.reorderLevel ?? "",
    p.unit ?? "",
    p.category ?? "",
    p.isActive ? "Active" : "Inactive",
  ]);
  return rowsToCsv(
    [
      "Name",
      "SKU",
      "Barcode",
      "Selling Price",
      "Cost Price",
      "Stock On Hand",
      "Reorder Level",
      "Unit",
      "Category",
      "Status",
    ],
    rows,
  );
}
