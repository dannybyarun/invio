/**
 * Suppliers Controller
 * CRUD operations for vendor/supplier management.
 */
import { getDatabase } from "../database/init.ts";
import { CreateSupplierRequest, Supplier } from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";

const COLUMNS =
  "id, name, contact_name, email, phone, address, tax_id, notes, created_at, updated_at";

const mapRowToSupplier = (row: unknown[]): Supplier => ({
  id: row[0] as string,
  name: row[1] as string,
  contactName: (row[2] ?? undefined) as string | undefined,
  email: (row[3] ?? undefined) as string | undefined,
  phone: (row[4] ?? undefined) as string | undefined,
  address: (row[5] ?? undefined) as string | undefined,
  taxId: (row[6] ?? undefined) as string | undefined,
  notes: (row[7] ?? undefined) as string | undefined,
  createdAt: new Date(row[8] as string),
  updatedAt: new Date(row[9] as string),
});

const toNullable = (v?: string): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

export const getSuppliers = (): Supplier[] => {
  const db = getDatabase();
  const results = db.query(
    `SELECT ${COLUMNS} FROM suppliers ORDER BY name ASC`,
  ) as unknown[][];
  return results.map(mapRowToSupplier);
};

export const getSupplierById = (id: string): Supplier | null => {
  const db = getDatabase();
  const results = db.query(
    `SELECT ${COLUMNS} FROM suppliers WHERE id = ?`,
    [id],
  ) as unknown[][];
  if (results.length === 0) return null;
  return mapRowToSupplier(results[0]);
};

export const createSupplier = (data: CreateSupplierRequest): Supplier => {
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString();
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Supplier name is required");

  db.query(
    `INSERT INTO suppliers (id, name, contact_name, email, phone, address, tax_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      toNullable(data.contactName),
      toNullable(data.email),
      toNullable(data.phone),
      toNullable(data.address),
      toNullable(data.taxId),
      toNullable(data.notes),
      now,
      now,
    ],
  );
  return getSupplierById(id)!;
};

export const updateSupplier = (
  id: string,
  data: Partial<CreateSupplierRequest>,
): Supplier | null => {
  const existing = getSupplierById(id);
  if (!existing) return null;

  const db = getDatabase();
  const name = String(data.name ?? existing.name).trim();
  if (!name) throw new Error("Supplier name is required");

  db.query(
    `UPDATE suppliers SET
       name = ?, contact_name = ?, email = ?, phone = ?, address = ?, tax_id = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      name,
      toNullable(data.contactName ?? existing.contactName),
      toNullable(data.email ?? existing.email),
      toNullable(data.phone ?? existing.phone),
      toNullable(data.address ?? existing.address),
      toNullable(data.taxId ?? existing.taxId),
      toNullable(data.notes ?? existing.notes),
      new Date().toISOString(),
      id,
    ],
  );
  return getSupplierById(id);
};

export const deleteSupplier = (id: string): void => {
  const db = getDatabase();
  const existing = getSupplierById(id);
  if (!existing) throw new Error("Supplier not found");
  db.query("DELETE FROM suppliers WHERE id = ?", [id]);
};

export const isSupplierUsed = (id: string): boolean => {
  const db = getDatabase();
  const poRows = db.query(
    "SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = ?",
    [id],
  ) as unknown[][];
  const expenseRows = db.query(
    "SELECT COUNT(*) FROM expenses WHERE supplier_id = ?",
    [id],
  ) as unknown[][];
  return Number(poRows[0]?.[0] ?? 0) > 0 ||
    Number(expenseRows[0]?.[0] ?? 0) > 0;
};
