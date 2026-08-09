/**
 * Product Options Controller
 * Manages product categories and units.
 * Categories/units can only be deleted if not used by any product.
 */
import { getDatabase } from "../database/init.ts";

export interface ProductCategory {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isBuiltin: boolean;
  createdAt: Date;
}

export interface ProductUnit {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isBuiltin: boolean;
  createdAt: Date;
}

// Categories
export function getCategories(): ProductCategory[] {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, code, name, sort_order, is_builtin, created_at FROM product_categories ORDER BY sort_order ASC, name ASC",
  );
  return rows.map((row) => {
    const [id, code, name, sortOrder, isBuiltin, createdAt] = row as [
      string,
      string,
      string,
      number,
      number,
      string,
    ];
    return {
      id,
      code,
      name,
      sortOrder: sortOrder || 0,
      isBuiltin: Boolean(isBuiltin),
      createdAt: new Date(createdAt),
    };
  });
}

export function getCategoryById(id: string): ProductCategory | null {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, code, name, sort_order, is_builtin, created_at FROM product_categories WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const [rid, code, name, sortOrder, isBuiltin, createdAt] = rows[0] as [
    string,
    string,
    string,
    number,
    number,
    string,
  ];
  return {
    id: rid,
    code,
    name,
    sortOrder: sortOrder || 0,
    isBuiltin: Boolean(isBuiltin),
    createdAt: new Date(createdAt),
  };
}

export function createCategory(
  data: { code: string; name: string },
): ProductCategory {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Get max sort order
  const maxRows = db.query("SELECT MAX(sort_order) FROM product_categories");
  const maxSort = (maxRows[0] as [number | null])[0] || 0;
  db.query(
    "INSERT INTO product_categories (id, code, name, sort_order, is_builtin, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    [id, data.code, data.name, maxSort + 1, now],
  );
  return getCategoryById(id)!;
}

export function updateCategory(
  id: string,
  data: { code?: string; name?: string },
): ProductCategory | null {
  const db = getDatabase();
  const existing = getCategoryById(id);
  if (!existing) return null;
  const code = data.code ?? existing.code;
  const name = data.name ?? existing.name;
  db.query("UPDATE product_categories SET code = ?, name = ? WHERE id = ?", [
    code,
    name,
    id,
  ]);
  return getCategoryById(id);
}

export function deleteCategory(id: string): boolean {
  const db = getDatabase();
  const existing = getCategoryById(id);
  if (!existing) return false;
  if (existing.isBuiltin) {
    throw new Error("Cannot delete built-in category");
  }
  // Check if any product uses this category
  const usage = db.query("SELECT COUNT(*) FROM products WHERE category = ?", [
    existing.code,
  ]);
  const count = (usage[0] as [number])[0];
  if (count > 0) {
    throw new Error(`Category is used by ${count} product(s)`);
  }
  db.query("DELETE FROM product_categories WHERE id = ?", [id]);
  return true;
}

export function isCategoryUsed(id: string): { used: boolean; count: number } {
  const db = getDatabase();
  const existing = getCategoryById(id);
  if (!existing) return { used: false, count: 0 };
  const usage = db.query("SELECT COUNT(*) FROM products WHERE category = ?", [
    existing.code,
  ]);
  const count = (usage[0] as [number])[0];
  return { used: count > 0, count };
}

// Units
export function getUnits(): ProductUnit[] {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, code, name, sort_order, is_builtin, created_at FROM product_units ORDER BY sort_order ASC, name ASC",
  );
  return rows.map((row) => {
    const [id, code, name, sortOrder, isBuiltin, createdAt] = row as [
      string,
      string,
      string,
      number,
      number,
      string,
    ];
    return {
      id,
      code,
      name,
      sortOrder: sortOrder || 0,
      isBuiltin: Boolean(isBuiltin),
      createdAt: new Date(createdAt),
    };
  });
}

export function getUnitById(id: string): ProductUnit | null {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, code, name, sort_order, is_builtin, created_at FROM product_units WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const [rid, code, name, sortOrder, isBuiltin, createdAt] = rows[0] as [
    string,
    string,
    string,
    number,
    number,
    string,
  ];
  return {
    id: rid,
    code,
    name,
    sortOrder: sortOrder || 0,
    isBuiltin: Boolean(isBuiltin),
    createdAt: new Date(createdAt),
  };
}

export function createUnit(data: { code: string; name: string }): ProductUnit {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Get max sort order
  const maxRows = db.query("SELECT MAX(sort_order) FROM product_units");
  const maxSort = (maxRows[0] as [number | null])[0] || 0;
  db.query(
    "INSERT INTO product_units (id, code, name, sort_order, is_builtin, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    [id, data.code, data.name, maxSort + 1, now],
  );
  return getUnitById(id)!;
}

export function updateUnit(
  id: string,
  data: { code?: string; name?: string },
): ProductUnit | null {
  const db = getDatabase();
  const existing = getUnitById(id);
  if (!existing) return null;
  const code = data.code ?? existing.code;
  const name = data.name ?? existing.name;
  db.query("UPDATE product_units SET code = ?, name = ? WHERE id = ?", [
    code,
    name,
    id,
  ]);
  return getUnitById(id);
}

export function deleteUnit(id: string): boolean {
  const db = getDatabase();
  const existing = getUnitById(id);
  if (!existing) return false;
  if (existing.isBuiltin) {
    throw new Error("Cannot delete built-in unit");
  }
  // Check if any product uses this unit
  const usage = db.query("SELECT COUNT(*) FROM products WHERE unit = ?", [
    existing.code,
  ]);
  const count = (usage[0] as [number])[0];
  if (count > 0) {
    throw new Error(`Unit is used by ${count} product(s)`);
  }
  db.query("DELETE FROM product_units WHERE id = ?", [id]);
  return true;
}

export function isUnitUsed(id: string): { used: boolean; count: number } {
  const db = getDatabase();
  const existing = getUnitById(id);
  if (!existing) return { used: false, count: 0 };
  const usage = db.query("SELECT COUNT(*) FROM products WHERE unit = ?", [
    existing.code,
  ]);
  const count = (usage[0] as [number])[0];
  return { used: count > 0, count };
}
