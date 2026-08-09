/**
 * Recurring Invoices Controller
 * Store a repeatable invoice template; generate real invoices on schedule.
 */
import { getDatabase } from "../database/init.ts";
import {
  CreateRecurringInvoiceRequest,
  RecurringInvoice,
} from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";
import { createInvoice } from "./invoices.ts";

function mapRowToRecurring(row: unknown[]): RecurringInvoice {
  return {
    id: row[0] as string,
    name: row[1] as string,
    customerId: row[2] as string,
    frequency: row[3] as RecurringInvoice["frequency"],
    intervalCount: Number(row[4]) || 1,
    nextRunDate: String(row[5]),
    lastRunDate: row[6] ? String(row[6]) : undefined,
    endDate: row[7] ? String(row[7]) : undefined,
    defaultStatus: row[8] === "sent" ? "sent" : "draft",
    isActive: Boolean(row[9]),
    templateJson: String(row[10]),
    createdAt: new Date(row[11] as string),
    updatedAt: new Date(row[12] as string),
  };
}

export const getRecurringInvoices = (): RecurringInvoice[] => {
  const db = getDatabase();
  const rows = db.query(
    `SELECT r.id, r.name, r.customer_id, r.frequency, r.interval_count, r.next_run_date,
            r.last_run_date, r.end_date, r.default_status, r.is_active, r.template_json,
            r.created_at, r.updated_at, c.name
     FROM recurring_invoices r LEFT JOIN customers c ON c.id = r.customer_id
     ORDER BY r.created_at DESC`,
  ) as unknown[][];
  return rows.map((row) => {
    const rec = mapRowToRecurring(row.slice(0, 13));
    rec.customerName = row[13] ? String(row[13]) : "Unknown";
    return rec;
  });
};

export const getRecurringInvoiceById = (
  id: string,
): RecurringInvoice | null => {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, name, customer_id, frequency, interval_count, next_run_date, last_run_date, end_date, default_status, is_active, template_json, created_at, updated_at FROM recurring_invoices WHERE id = ?",
    [id],
  ) as unknown[][];
  if (rows.length === 0) return null;
  return mapRowToRecurring(rows[0]);
};

/** Local YYYY-MM-DD (avoids UTC shift that toISOString would introduce). */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(
      d.getDate(),
    ).padStart(2, "0")
  }`;
}

function addInterval(
  dateStr: string,
  frequency: RecurringInvoice["frequency"],
  count: number,
): string {
  const [y, m, day] = dateStr.split("-").map(Number);
  if (!y || !m || !day) return dateStr;
  const d = new Date(y, m - 1, day);
  if (frequency === "daily") d.setDate(d.getDate() + count);
  else if (frequency === "weekly") d.setDate(d.getDate() + 7 * count);
  else if (frequency === "monthly") d.setMonth(d.getMonth() + count);
  else if (frequency === "yearly") d.setFullYear(d.getFullYear() + count);
  return localDateStr(d);
}

export const createRecurringInvoice = (
  data: CreateRecurringInvoiceRequest,
): RecurringInvoice => {
  const db = getDatabase();
  if (!data.customerId) throw new Error("Customer is required");
  if (!data.items || data.items.length === 0) {
    throw new Error("Recurring invoice needs at least one item");
  }

  const id = generateUUID();
  const now = new Date().toISOString();
  const frequency = data.frequency || "monthly";
  const intervalCount = Number(data.intervalCount) || 1;
  const today = localDateStr(new Date());
  const nextRunDate = data.nextRunDate
    ? String(data.nextRunDate)
    : addInterval(today, frequency, intervalCount);

  const template = {
    customerId: data.customerId,
    currency: data.currency || "USD",
    discountPercentage: Number(data.discountPercentage) || 0,
    discountAmount: Number(data.discountAmount) || 0,
    taxRate: Number(data.taxRate) || 0,
    paymentTerms: data.paymentTerms,
    notes: data.notes,
    items: data.items,
  };

  db.query(
    `INSERT INTO recurring_invoices (id, name, customer_id, frequency, interval_count, next_run_date, end_date, default_status, is_active, template_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(data.name || "Recurring invoice").trim(),
      data.customerId,
      frequency,
      intervalCount,
      nextRunDate,
      data.endDate ? String(data.endDate) : null,
      data.defaultStatus === "sent" ? "sent" : "draft",
      data.isActive === false ? 0 : 1,
      JSON.stringify(template),
      now,
      now,
    ],
  );
  return getRecurringInvoiceById(id)!;
};

export const updateRecurringInvoice = (
  id: string,
  data: Partial<CreateRecurringInvoiceRequest>,
): RecurringInvoice | null => {
  const existing = getRecurringInvoiceById(id);
  if (!existing) return null;

  const db = getDatabase();
  const template = JSON.parse(existing.templateJson || "{}") as Record<
    string,
    unknown
  >;
  if (data.customerId) template.customerId = data.customerId;
  if (data.currency) template.currency = data.currency;
  if (data.discountPercentage !== undefined) {
    template.discountPercentage = Number(data.discountPercentage) || 0;
  }
  if (data.discountAmount !== undefined) {
    template.discountAmount = Number(data.discountAmount) || 0;
  }
  if (data.taxRate !== undefined) template.taxRate = Number(data.taxRate) || 0;
  if (data.paymentTerms !== undefined) {
    template.paymentTerms = data.paymentTerms;
  }
  if (data.notes !== undefined) template.notes = data.notes;
  if (data.items) template.items = data.items;
  db.query(
    `UPDATE recurring_invoices SET
       name = ?, customer_id = ?, frequency = ?, interval_count = ?, next_run_date = ?,
       end_date = ?, default_status = ?, is_active = ?, template_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      String(data.name ?? existing.name),
      data.customerId ?? existing.customerId,
      data.frequency ?? existing.frequency,
      Number(data.intervalCount) || existing.intervalCount,
      String(data.nextRunDate ?? existing.nextRunDate),
      data.endDate !== undefined
        ? data.endDate ? String(data.endDate) : null
        : existing.endDate ?? null,
      data.defaultStatus !== undefined
        ? data.defaultStatus === "sent" ? "sent" : "draft"
        : existing.defaultStatus,
      data.isActive === undefined
        ? existing.isActive ? 1 : 0
        : data.isActive
        ? 1
        : 0,
      JSON.stringify(template),
      new Date().toISOString(),
      id,
    ],
  );
  return getRecurringInvoiceById(id);
};

export const deleteRecurringInvoice = (id: string): boolean => {
  const existing = getRecurringInvoiceById(id);
  if (!existing) throw new Error("Recurring invoice not found");
  const db = getDatabase();
  db.query("DELETE FROM recurring_invoices WHERE id = ?", [id]);
  return true;
};

/**
 * Generate invoices for every due recurring template.
 * Returns the number of invoices created.
 */
export async function processDueRecurringInvoices(): Promise<number> {
  const db = getDatabase();
  const today = localDateStr(new Date());
  const rows = db.query(
    `SELECT id, name, customer_id, frequency, interval_count, next_run_date, last_run_date,
            end_date, default_status, is_active, template_json, created_at, updated_at
     FROM recurring_invoices
     WHERE is_active = 1 AND next_run_date <= ?`,
    [today],
  ) as unknown[][];

  let created = 0;
  for (const row of rows) {
    const rec = mapRowToRecurring(row);
    if (rec.endDate && rec.endDate < today) continue;

    let template: Record<string, unknown>;
    try {
      template = JSON.parse(rec.templateJson || "{}");
    } catch {
      continue;
    }
    const items = Array.isArray(template.items) ? template.items : [];
    if (items.length === 0) continue;

    try {
      await createInvoice({
        customerId: String(template.customerId || rec.customerId),
        currency: String(template.currency || "USD"),
        status: rec.defaultStatus,
        discountPercentage: Number(template.discountPercentage) || 0,
        discountAmount: Number(template.discountAmount) || 0,
        taxRate: Number(template.taxRate) || 0,
        paymentTerms: template.paymentTerms
          ? String(template.paymentTerms)
          : undefined,
        notes: template.notes ? String(template.notes) : undefined,
        items: items.map((it: Record<string, unknown>) => ({
          productId: it.productId ? String(it.productId) : undefined,
          description: String(it.description || "Item"),
          quantity: Number(it.quantity) || 1,
          unit: it.unit ? String(it.unit) : undefined,
          unitPrice: Number(it.unitPrice) || 0,
        })),
      });

      const next = addInterval(
        rec.nextRunDate,
        rec.frequency,
        rec.intervalCount,
      );
      db.query(
        `UPDATE recurring_invoices SET next_run_date = ?, last_run_date = ?, updated_at = ? WHERE id = ?`,
        [next, today, new Date().toISOString(), rec.id],
      );
      created++;
    } catch (e) {
      console.error("Recurring invoice generation failed:", e);
    }
  }
  return created;
}
