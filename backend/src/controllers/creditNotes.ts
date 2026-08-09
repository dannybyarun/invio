/**
 * Credit Notes / Refunds Controller
 * Credit notes reduce an invoice's outstanding balance and return stock.
 */
import { calculateInvoiceTotals, getDatabase } from "../database/init.ts";
import {
  CreateCreditNoteRequest,
  CreditNote,
  CreditNoteItem,
} from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";
import { reconcileCreditNoteStock } from "./stock.ts";
import { getCustomerById } from "./customers.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function nextCreditNumber(): string {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const rows = db.query(
    "SELECT credit_number FROM credit_notes WHERE credit_number LIKE ?",
    [`CN-${year}-%`],
  ) as unknown[][];
  let max = 0;
  const re = new RegExp(`^CN-${year}-(\\d+)$`);
  for (const row of rows) {
    const m = String(row[0] ?? "").match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return `CN-${year}-${String(max + 1).padStart(3, "0")}`;
}

function mapRowToCreditNote(row: unknown[]): CreditNote {
  return {
    id: row[0] as string,
    creditNumber: row[1] as string,
    invoiceId: (row[2] ?? undefined) as string | undefined,
    customerId: row[3] as string,
    issueDate: String(row[4]),
    reason: (row[5] ?? undefined) as string | undefined,
    subtotal: Number(row[6]) || 0,
    taxRate: Number(row[7]) || 0,
    taxAmount: Number(row[8]) || 0,
    total: Number(row[9]) || 0,
    status: row[10] as CreditNote["status"],
    createdAt: new Date(row[11] as string),
    updatedAt: new Date(row[12] as string),
  };
}

export const getCreditNotes = (): CreditNote[] => {
  const db = getDatabase();
  const rows = db.query(
    `SELECT cn.id, cn.credit_number, cn.invoice_id, cn.customer_id, cn.issue_date, cn.reason,
            cn.subtotal, cn.tax_rate, cn.tax_amount, cn.total, cn.status, cn.created_at, cn.updated_at,
            c.name, i.invoice_number
     FROM credit_notes cn
     LEFT JOIN customers c ON c.id = cn.customer_id
     LEFT JOIN invoices i ON i.id = cn.invoice_id
     ORDER BY cn.created_at DESC`,
  ) as unknown[][];
  return rows.map((row) => {
    const cn = mapRowToCreditNote(row.slice(0, 13));
    cn.customer = {
      id: cn.customerId,
      name: String(row[13] ?? "Unknown"),
    } as CreditNote["customer"];
    cn.invoiceNumber = row[14] ? String(row[14]) : undefined;
    return cn;
  });
};

export const getCreditNoteById = (id: string): CreditNote | null => {
  const db = getDatabase();
  const rows = db.query(
    `SELECT cn.id, cn.credit_number, cn.invoice_id, cn.customer_id, cn.issue_date, cn.reason,
            cn.subtotal, cn.tax_rate, cn.tax_amount, cn.total, cn.status, cn.created_at, cn.updated_at,
            c.name, i.invoice_number
     FROM credit_notes cn
     LEFT JOIN customers c ON c.id = cn.customer_id
     LEFT JOIN invoices i ON i.id = cn.invoice_id
     WHERE cn.id = ?`,
    [id],
  ) as unknown[][];
  if (rows.length === 0) return null;
  const cn = mapRowToCreditNote(rows[0].slice(0, 13));
  cn.customer = getCustomerById(cn.customerId) ?? undefined;
  cn.invoiceNumber = rows[0][14] ? String(rows[0][14]) : undefined;

  const itemRows = db.query(
    `SELECT id, credit_note_id, product_id, description, quantity, unit_price, line_total, sort_order
     FROM credit_note_items WHERE credit_note_id = ? ORDER BY sort_order`,
    [id],
  ) as unknown[][];
  cn.items = itemRows.map((r): CreditNoteItem => ({
    id: String(r[0]),
    creditNoteId: String(r[1]),
    productId: r[2] ? String(r[2]) : undefined,
    description: String(r[3]),
    quantity: Number(r[4]),
    unitPrice: Number(r[5]),
    lineTotal: Number(r[6]),
    sortOrder: Number(r[7]) || 0,
  }));
  return cn;
};

export const createCreditNote = (
  data: CreateCreditNoteRequest,
): CreditNote => {
  const db = getDatabase();
  const customer = getCustomerById(data.customerId);
  if (!customer) throw new Error("Customer not found");

  // If created from an invoice, verify it belongs to the customer and is issued.
  if (data.invoiceId) {
    const inv = db.query(
      "SELECT status FROM invoices WHERE id = ? AND customer_id = ?",
      [data.invoiceId, data.customerId],
    ) as unknown[][];
    if (inv.length === 0) {
      throw new Error("Invoice not found for this customer");
    }
    const invStatus = String(inv[0][0]);
    if (invStatus === "draft") {
      throw new Error("Cannot issue a credit note for a draft invoice");
    }
    if (invStatus === "voided") {
      throw new Error("Cannot issue a credit note for a voided invoice");
    }
  }

  const items = (data.items || []).map((it) => ({
    ...it,
    description: String(it.description || "").trim() || "Item",
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unitPrice) || 0,
  }));
  if (items.length === 0) {
    throw new Error("Credit note needs at least one item");
  }

  const taxRate = Number(data.taxRate) || 0;
  const totals = calculateInvoiceTotals(items, 0, 0, taxRate, false);

  const id = generateUUID();
  const now = new Date().toISOString();

  db.execute("BEGIN");
  try {
    db.query(
      `INSERT INTO credit_notes (id, credit_number, invoice_id, customer_id, issue_date, reason, subtotal, tax_rate, tax_amount, total, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      [
        id,
        nextCreditNumber(),
        data.invoiceId ? String(data.invoiceId) : null,
        data.customerId,
        String(data.issueDate || now.slice(0, 10)),
        data.reason ? String(data.reason).trim() : null,
        totals.subtotal,
        taxRate,
        totals.taxAmount,
        totals.total,
        now,
        now,
      ],
    );
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      db.query(
        `INSERT INTO credit_note_items (id, credit_note_id, product_id, description, quantity, unit_price, line_total, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          id,
          it.productId ? String(it.productId) : null,
          it.description,
          it.quantity,
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

  // Stock back in for product-linked items.
  reconcileCreditNoteStock(id);
  return getCreditNoteById(id)!;
};

export const voidCreditNote = (id: string): CreditNote | null => {
  const existing = getCreditNoteById(id);
  if (!existing) return null;
  if (existing.status === "voided") return existing;

  const db = getDatabase();
  db.query(
    "UPDATE credit_notes SET status = 'voided', updated_at = ? WHERE id = ?",
    [new Date().toISOString(), id],
  );
  reconcileCreditNoteStock(id);
  return getCreditNoteById(id);
};

export const deleteCreditNote = (id: string): boolean => {
  const existing = getCreditNoteById(id);
  if (!existing) throw new Error("Credit note not found");
  if (existing.status === "voided") {
    throw new Error("Voided credit notes cannot be deleted");
  }
  const db = getDatabase();
  db.query("DELETE FROM credit_notes WHERE id = ?", [id]);
  return true;
};
