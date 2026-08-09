/**
 * Expenses Controller
 * CRUD operations for business expense recording.
 */
import { getDatabase } from "../database/init.ts";
import { CreateExpenseRequest, Expense } from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";

const COLUMNS =
  "id, expense_date, supplier_id, category, description, amount, tax_amount, payment_method, reference, notes, created_at, updated_at";

const mapRowToExpense = (row: unknown[]): Expense => ({
  id: row[0] as string,
  expenseDate: String(row[1]),
  supplierId: (row[2] ?? undefined) as string | undefined,
  category: (row[3] ?? undefined) as string | undefined,
  description: (row[4] ?? undefined) as string | undefined,
  amount: Number(row[5]) || 0,
  taxAmount: Number(row[6]) || 0,
  paymentMethod: (row[7] ?? undefined) as string | undefined,
  reference: (row[8] ?? undefined) as string | undefined,
  notes: (row[9] ?? undefined) as string | undefined,
  createdAt: new Date(row[10] as string),
  updatedAt: new Date(row[11] as string),
});

const toNullable = (v?: string): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

export const getExpenses = (): Expense[] => {
  const db = getDatabase();
  const results = db.query(
    `SELECT ${COLUMNS} FROM expenses ORDER BY expense_date DESC, created_at DESC`,
  ) as unknown[][];
  return results.map(mapRowToExpense);
};

export const getExpenseById = (id: string): Expense | null => {
  const db = getDatabase();
  const results = db.query(
    `SELECT ${COLUMNS} FROM expenses WHERE id = ?`,
    [id],
  ) as unknown[][];
  if (results.length === 0) return null;
  return mapRowToExpense(results[0]);
};

export const createExpense = (data: CreateExpenseRequest): Expense => {
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString();
  const date = String(
    data.expenseDate || new Date().toISOString().slice(0, 10),
  );

  db.query(
    `INSERT INTO expenses (id, expense_date, supplier_id, category, description, amount, tax_amount, payment_method, reference, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      date,
      toNullable(data.supplierId),
      toNullable(data.category),
      toNullable(data.description),
      Number(data.amount) || 0,
      Number(data.taxAmount) || 0,
      toNullable(data.paymentMethod),
      toNullable(data.reference),
      toNullable(data.notes),
      now,
      now,
    ],
  );
  return getExpenseById(id)!;
};

export const updateExpense = (
  id: string,
  data: Partial<CreateExpenseRequest>,
): Expense | null => {
  const existing = getExpenseById(id);
  if (!existing) return null;

  const db = getDatabase();
  db.query(
    `UPDATE expenses SET
       expense_date = ?, supplier_id = ?, category = ?, description = ?, amount = ?,
       tax_amount = ?, payment_method = ?, reference = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      String(data.expenseDate ?? existing.expenseDate),
      toNullable(data.supplierId ?? existing.supplierId),
      toNullable(data.category ?? existing.category),
      toNullable(data.description ?? existing.description),
      Number(data.amount ?? existing.amount) || 0,
      Number(data.taxAmount ?? existing.taxAmount) || 0,
      toNullable(data.paymentMethod ?? existing.paymentMethod),
      toNullable(data.reference ?? existing.reference),
      toNullable(data.notes ?? existing.notes),
      new Date().toISOString(),
      id,
    ],
  );
  return getExpenseById(id);
};

export const deleteExpense = (id: string): void => {
  const existing = getExpenseById(id);
  if (!existing) throw new Error("Expense not found");
  const db = getDatabase();
  db.query("DELETE FROM expenses WHERE id = ?", [id]);
};

export const getExpenseCategories = (): string[] => {
  const db = getDatabase();
  const rows = db.query(
    "SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL AND category != '' ORDER BY category",
  ) as unknown[][];
  return rows.map((r) => String(r[0]));
};
