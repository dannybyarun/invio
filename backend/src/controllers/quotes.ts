/**
 * Quotes / Estimates Controller
 * Quotes can be converted into invoices (which links them via source_quote_id).
 */
import { calculateInvoiceTotals, getDatabase } from "../database/init.ts";
import { CreateQuoteRequest, Quote, QuoteItem } from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";
import { getCustomerById } from "./customers.ts";
import { createInvoice } from "./invoices.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function nextQuoteNumber(): string {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const rows = db.query(
    "SELECT quote_number FROM quotes WHERE quote_number LIKE ?",
    [`QT-${year}-%`],
  ) as unknown[][];
  let max = 0;
  const re = new RegExp(`^QT-${year}-(\\d+)$`);
  for (const row of rows) {
    const m = String(row[0] ?? "").match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return `QT-${year}-${String(max + 1).padStart(3, "0")}`;
}

function mapRowToQuote(row: unknown[]): Quote {
  const expiryDate = row[4] ? String(row[4]) : undefined;
  return {
    id: row[0] as string,
    quoteNumber: row[1] as string,
    customerId: row[2] as string,
    issueDate: String(row[3]),
    expiryDate,
    isExpired: isQuoteExpired(expiryDate),
    currency: row[5] as string,
    status: row[6] as Quote["status"],
    subtotal: Number(row[7]) || 0,
    discountAmount: Number(row[8]) || 0,
    discountPercentage: Number(row[9]) || 0,
    taxRate: Number(row[10]) || 0,
    taxAmount: Number(row[11]) || 0,
    total: Number(row[12]) || 0,
    paymentTerms: (row[13] ?? undefined) as string | undefined,
    notes: (row[14] ?? undefined) as string | undefined,
    convertedInvoiceId: (row[15] ?? undefined) as string | undefined,
    createdAt: new Date(row[16] as string),
    updatedAt: new Date(row[17] as string),
  };
}

/** A quote has expired when its expiry date is before today and it is not yet converted. */
function isQuoteExpired(expiryDate?: string): boolean {
  if (!expiryDate) return false;
  const exp = new Date(`${expiryDate}T23:59:59`);
  if (Number.isNaN(exp.getTime())) return false;
  return exp.getTime() < Date.now();
}

const toNullable = (v?: string): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

export const getQuotes = (): Quote[] => {
  const db = getDatabase();
  const rows = db.query(
    `SELECT q.id, q.quote_number, q.customer_id, q.issue_date, q.expiry_date, q.currency, q.status,
            q.subtotal, q.discount_amount, q.discount_percentage, q.tax_rate, q.tax_amount, q.total,
            q.payment_terms, q.notes, q.converted_invoice_id, q.created_at, q.updated_at,
            c.name
     FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
     ORDER BY q.created_at DESC`,
  ) as unknown[][];
  return rows.map((row) => {
    const quote = mapRowToQuote(row.slice(0, 18));
    quote.customer = getCustomerById(quote.customerId) ?? undefined;
    return quote;
  });
};

export const getQuoteById = (id: string): Quote | null => {
  const db = getDatabase();
  const rows = db.query(
    `SELECT q.id, q.quote_number, q.customer_id, q.issue_date, q.expiry_date, q.currency, q.status,
            q.subtotal, q.discount_amount, q.discount_percentage, q.tax_rate, q.tax_amount, q.total,
            q.payment_terms, q.notes, q.converted_invoice_id, q.created_at, q.updated_at,
            c.name
     FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
     WHERE q.id = ?`,
    [id],
  ) as unknown[][];
  if (rows.length === 0) return null;
  const quote = mapRowToQuote(rows[0].slice(0, 18));
  const customer = getCustomerById(quote.customerId);
  quote.customer = customer ?? undefined;

  const itemRows = db.query(
    `SELECT id, quote_id, product_id, description, quantity, unit, unit_price, line_total, sort_order
     FROM quote_items WHERE quote_id = ? ORDER BY sort_order`,
    [id],
  ) as unknown[][];
  quote.items = itemRows.map((r): QuoteItem => ({
    id: String(r[0]),
    quoteId: String(r[1]),
    productId: r[2] ? String(r[2]) : undefined,
    description: String(r[3]),
    quantity: Number(r[4]),
    unit: r[5] ? String(r[5]) : undefined,
    unitPrice: Number(r[6]),
    lineTotal: Number(r[7]),
    sortOrder: Number(r[8]) || 0,
  }));
  return quote;
};

export const createQuote = (data: CreateQuoteRequest): Quote => {
  const db = getDatabase();
  const customer = getCustomerById(data.customerId);
  if (!customer) throw new Error("Customer not found");

  const items = (data.items || []).map((it) => ({
    ...it,
    description: String(it.description || "").trim() || "Item",
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unitPrice) || 0,
  }));
  if (items.length === 0) throw new Error("Quote needs at least one item");

  const discountPercentage = Number(data.discountPercentage) || 0;
  const discountAmount = Number(data.discountAmount) || 0;
  const taxRate = Number(data.taxRate) || 0;
  const totals = calculateInvoiceTotals(
    items,
    discountPercentage,
    discountAmount,
    taxRate,
    false,
  );

  const id = generateUUID();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  db.execute("BEGIN");
  try {
    db.query(
      `INSERT INTO quotes (id, quote_number, customer_id, issue_date, expiry_date, currency, status,
         subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total, payment_terms, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        nextQuoteNumber(),
        data.customerId,
        String(data.issueDate || today),
        toNullable(data.expiryDate),
        String(data.currency || "USD"),
        totals.subtotal,
        totals.discountAmount,
        discountPercentage,
        taxRate,
        totals.taxAmount,
        totals.total,
        toNullable(data.paymentTerms),
        toNullable(data.notes),
        now,
        now,
      ],
    );
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      db.query(
        `INSERT INTO quote_items (id, quote_id, product_id, description, quantity, unit, unit_price, line_total, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          id,
          it.productId ? String(it.productId) : null,
          it.description,
          it.quantity,
          it.unit ? String(it.unit) : null,
          it.unitPrice,
          r2(it.quantity * it.unitPrice),
          i,
        ],
      );
    }
    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  return getQuoteById(id)!;
};

export const updateQuote = (
  id: string,
  data: Partial<CreateQuoteRequest>,
): Quote | null => {
  const existing = getQuoteById(id);
  if (!existing) return null;
  if (existing.status === "converted") {
    throw new Error("Converted quotes cannot be edited");
  }

  const db = getDatabase();
  let status = existing.status;
  if (data.customerId && data.customerId !== existing.customerId) {
    status = "draft";
  }

  const items = data.items
    ? data.items.map((it, i) => ({
      ...it,
      description: String(it.description || "").trim() || "Item",
      quantity: Number(it.quantity) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      sortOrder: i,
    }))
    : (existing.items || []).map((it) => ({ ...it, sortOrder: it.sortOrder }));

  const discountPercentage = Number(
    data.discountPercentage ?? existing.discountPercentage,
  ) || 0;
  const discountAmount = Number(
    data.discountAmount ?? existing.discountAmount,
  ) || 0;
  const taxRate = Number(data.taxRate ?? existing.taxRate) || 0;
  const totals = calculateInvoiceTotals(
    items,
    discountPercentage,
    discountAmount,
    taxRate,
    false,
  );

  db.execute("BEGIN");
  try {
    db.query(
      `UPDATE quotes SET
         customer_id = ?, issue_date = ?, expiry_date = ?, currency = ?, status = ?,
         subtotal = ?, discount_amount = ?, discount_percentage = ?, tax_rate = ?, tax_amount = ?,
         total = ?, payment_terms = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        data.customerId ?? existing.customerId,
        String(data.issueDate ?? existing.issueDate),
        toNullable(data.expiryDate ?? existing.expiryDate),
        data.currency ?? existing.currency,
        status,
        totals.subtotal,
        totals.discountAmount,
        discountPercentage,
        taxRate,
        totals.taxAmount,
        totals.total,
        toNullable(data.paymentTerms ?? existing.paymentTerms),
        toNullable(data.notes ?? existing.notes),
        new Date().toISOString(),
        id,
      ],
    );
    if (data.items) {
      db.query("DELETE FROM quote_items WHERE quote_id = ?", [id]);
      for (const it of items) {
        db.query(
          `INSERT INTO quote_items (id, quote_id, product_id, description, quantity, unit, unit_price, line_total, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            generateUUID(),
            id,
            it.productId ? String(it.productId) : null,
            it.description,
            it.quantity,
            it.unit ? String(it.unit) : null,
            it.unitPrice,
            r2(it.quantity * it.unitPrice),
            it.sortOrder,
          ],
        );
      }
    }
    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  return getQuoteById(id);
};

export const setQuoteStatus = (
  id: string,
  status: Quote["status"],
): Quote | null => {
  const existing = getQuoteById(id);
  if (!existing) return null;
  const db = getDatabase();
  db.query(
    "UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?",
    [status, new Date().toISOString(), id],
  );
  return getQuoteById(id);
};

/** Convert a quote into an invoice. Returns the created invoice. */
export const convertQuoteToInvoice = async (
  id: string,
): Promise<{ quote: Quote; invoiceId: string }> => {
  const quote = getQuoteById(id);
  if (!quote) throw new Error("Quote not found");
  if (quote.status === "converted") {
    throw new Error(
      quote.convertedInvoiceId
        ? "Quote already converted to an invoice"
        : "Quote already converted",
    );
  }
  if (!quote.items || quote.items.length === 0) {
    throw new Error("Quote has no items to convert");
  }

  const invoice = await createInvoice({
    customerId: quote.customerId,
    currency: quote.currency,
    status: "draft",
    discountAmount: quote.discountAmount,
    discountPercentage: quote.discountPercentage,
    taxRate: quote.taxRate,
    paymentTerms: quote.paymentTerms,
    notes: quote.notes,
    items: (quote.items || []).map((it) => ({
      productId: it.productId,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
    })),
  });

  const db = getDatabase();
  db.query(
    `UPDATE quotes SET status = 'converted', converted_invoice_id = ?, updated_at = ? WHERE id = ?`,
    [invoice.id, new Date().toISOString(), id],
  );
  db.query("UPDATE invoices SET source_quote_id = ? WHERE id = ?", [
    id,
    invoice.id,
  ]);

  return { quote: getQuoteById(id)!, invoiceId: invoice.id };
};

/**
 * Duplicate a quote into a new draft quote (re-quote).
 * New issue date and expiry (defaults to +30 days), fresh quote number,
 * same customer, items and totals.
 */
export const duplicateQuote = (id: string): Quote => {
  const existing = getQuoteById(id);
  if (!existing) throw new Error("Quote not found");

  const db = getDatabase();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const expiry = new Date(now.getTime() + 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const newId = generateUUID();
  db.execute("BEGIN");
  try {
    db.query(
      `INSERT INTO quotes (id, quote_number, customer_id, issue_date, expiry_date, currency, status,
         subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total, payment_terms, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        nextQuoteNumber(),
        existing.customerId,
        today,
        existing.expiryDate ? expiry : null,
        existing.currency,
        existing.subtotal,
        existing.discountAmount,
        existing.discountPercentage,
        existing.taxRate,
        existing.taxAmount,
        existing.total,
        toNullable(existing.paymentTerms),
        toNullable(existing.notes),
        now.toISOString(),
        now.toISOString(),
      ],
    );
    for (const it of existing.items || []) {
      db.query(
        `INSERT INTO quote_items (id, quote_id, product_id, description, quantity, unit, unit_price, line_total, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          newId,
          it.productId ? String(it.productId) : null,
          it.description,
          it.quantity,
          it.unit ? String(it.unit) : null,
          it.unitPrice,
          it.lineTotal,
          it.sortOrder,
        ],
      );
    }
    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  return getQuoteById(newId)!;
};

export const deleteQuote = (id: string): boolean => {
  const existing = getQuoteById(id);
  if (!existing) throw new Error("Quote not found");
  if (existing.status === "converted") {
    throw new Error("Converted quotes cannot be deleted");
  }
  const db = getDatabase();
  db.query("DELETE FROM quotes WHERE id = ?", [id]);
  return true;
};
