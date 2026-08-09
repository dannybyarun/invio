/**
 * Products Controller
 * CRUD operations for product management.
 * Products can be selected when creating invoices to auto-fill line items.
 */
import { getDatabase } from "../database/init.ts";
import { CreateProductRequest, Product } from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";
import {
  applyOpeningStock,
  applyStockAdjustment,
  syncQuantityOnHand,
} from "./stock.ts";

const PRODUCT_COLUMNS =
  "id, name, description, unit_price, sku, barcode, unit, category, tax_definition_id, is_active, created_at, updated_at, cost_price, quantity_on_hand, reorder_level";

const mapRowToProduct = (row: unknown[]): Product => ({
  id: row[0] as string,
  name: row[1] as string,
  description: (row[2] ?? undefined) as string | undefined,
  unitPrice: Number(row[3]) || 0,
  sku: (row[4] ?? undefined) as string | undefined,
  barcode: (row[5] ?? undefined) as string | undefined,
  unit: (row[6] ?? "piece") as string,
  category: (row[7] ?? undefined) as string | undefined,
  taxDefinitionId: (row[8] ?? undefined) as string | undefined,
  isActive: Boolean(row[9]),
  createdAt: new Date(row[10] as string),
  updatedAt: new Date(row[11] as string),
  costPrice: Number(row[12]) || 0,
  quantityOnHand: Number(row[13]) || 0,
  reorderLevel: Number(row[14]) || 0,
});

const toNullable = (v?: string): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

function assertProductCodesAvailable(
  db: ReturnType<typeof getDatabase>,
  sku: string | null,
  barcode: string | null,
  excludeId?: string,
): void {
  const values = [sku, barcode].filter((value): value is string => !!value);
  if (values.length === 0) return;

  const placeholders = values.map(() => "?").join(", ");
  const excluded = excludeId ? " AND id <> ?" : "";
  const rows = db.query(
    `SELECT sku, barcode FROM products
     WHERE (sku COLLATE NOCASE IN (${placeholders})
       OR barcode COLLATE NOCASE IN (${placeholders}))${excluded}`,
    [...values, ...values, ...(excludeId ? [excludeId] : [])],
  ) as unknown[][];

  // The same code must not identify two products, regardless of whether it
  // was stored as an SKU or barcode on the existing product.
  if (rows.length > 0) {
    throw new Error("SKU or barcode already exists on another product");
  }
}

export const getProducts = (includeInactive = false): Product[] => {
  const db = getDatabase();
  const query = includeInactive
    ? `SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY name ASC`
    : `SELECT ${PRODUCT_COLUMNS} FROM products WHERE is_active = 1 ORDER BY name ASC`;
  const results = db.query(query) as unknown[][];
  return results.map((row: unknown[]) => mapRowToProduct(row));
};

export const getProductByCode = (code: string): Product | null => {
  const normalized = String(code || "").trim();
  if (!normalized) return null;
  const db = getDatabase();
  const select = (field: "barcode" | "sku") =>
    db.query(
      `SELECT ${PRODUCT_COLUMNS}
       FROM products WHERE is_active = 1 AND ${field} = ? COLLATE NOCASE`,
      [normalized],
    ) as unknown[][];

  // Prefer an exact barcode match. Refuse duplicate identifiers instead of
  // silently selling an arbitrary product with LIMIT 1.
  const barcodes = select("barcode");
  if (barcodes.length === 1) return mapRowToProduct(barcodes[0]);
  if (barcodes.length > 1) return null;

  const skus = select("sku");
  if (skus.length !== 1) return null;
  return mapRowToProduct(skus[0]);
};

export const getProductById = (id: string): Product | null => {
  const db = getDatabase();
  const results = db.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`,
    [id],
  ) as unknown[][];
  if (results.length === 0) return null;
  return mapRowToProduct(results[0] as unknown[]);
};

export const createProduct = (data: CreateProductRequest): Product => {
  const db = getDatabase();
  const productId = generateUUID();
  const now = new Date();

  const description = toNullable(data.description);
  const sku = toNullable(data.sku);
  const barcode = toNullable(data.barcode);
  const unit = toNullable(data.unit) || "piece";
  const category = toNullable(data.category);
  const taxDefinitionId = toNullable(data.taxDefinitionId);
  const costPrice = Number(data.costPrice) || 0;
  const quantityOnHand = Number(data.quantityOnHand) || 0;
  const reorderLevel = Number(data.reorderLevel) || 0;

  assertProductCodesAvailable(db, sku, barcode);

  db.query(
    `INSERT INTO products (id, name, description, unit_price, sku, barcode, unit, category, tax_definition_id, is_active, created_at, updated_at, cost_price, quantity_on_hand, reorder_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [
      productId,
      data.name,
      description,
      data.unitPrice || 0,
      sku,
      barcode,
      unit,
      category,
      taxDefinitionId,
      now.toISOString(),
      now.toISOString(),
      costPrice,
      quantityOnHand,
      reorderLevel,
    ],
  );

  if (quantityOnHand > 0) applyOpeningStock(productId, quantityOnHand);

  return {
    id: productId,
    name: data.name,
    description: description ?? undefined,
    unitPrice: data.unitPrice || 0,
    sku: sku ?? undefined,
    barcode: barcode ?? undefined,
    unit: unit,
    category: category ?? undefined,
    taxDefinitionId: taxDefinitionId ?? undefined,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    costPrice,
    quantityOnHand,
    reorderLevel,
  };
};

export const updateProduct = (
  id: string,
  data: Partial<CreateProductRequest> & { isActive?: boolean },
): Product | null => {
  const db = getDatabase();
  const existing = getProductById(id);
  if (!existing) return null;

  const now = new Date();

  const name = data.name ?? existing.name;
  const description = data.description !== undefined
    ? toNullable(data.description)
    : existing.description ?? null;
  const unitPrice = data.unitPrice !== undefined
    ? data.unitPrice
    : existing.unitPrice;
  const sku = data.sku !== undefined
    ? toNullable(data.sku)
    : existing.sku ?? null;
  const barcode = data.barcode !== undefined
    ? toNullable(data.barcode)
    : existing.barcode ?? null;
  assertProductCodesAvailable(db, sku, barcode, id);
  const unit = data.unit !== undefined
    ? toNullable(data.unit) || "piece"
    : existing.unit ?? "piece";
  const category = data.category !== undefined
    ? toNullable(data.category)
    : existing.category ?? null;
  const taxDefinitionId = data.taxDefinitionId !== undefined
    ? toNullable(data.taxDefinitionId)
    : existing.taxDefinitionId ?? null;
  const isActive = data.isActive !== undefined
    ? data.isActive
    : existing.isActive;
  const costPrice = data.costPrice !== undefined
    ? Number(data.costPrice) || 0
    : existing.costPrice || 0;
  const reorderLevel = data.reorderLevel !== undefined
    ? Number(data.reorderLevel) || 0
    : existing.reorderLevel || 0;
  const newQuantity = data.quantityOnHand !== undefined
    ? Number(data.quantityOnHand) || 0
    : undefined;

  db.query(
    `UPDATE products SET
      name = ?, description = ?, unit_price = ?, sku = ?, barcode = ?, unit = ?, category = ?, tax_definition_id = ?, is_active = ?, cost_price = ?, reorder_level = ?, updated_at = ?
     WHERE id = ?`,
    [
      name,
      description,
      unitPrice,
      sku,
      barcode,
      unit,
      category,
      taxDefinitionId,
      isActive ? 1 : 0,
      costPrice,
      reorderLevel,
      now.toISOString(),
      id,
    ],
  );

  // Stock adjustments are deltas: sync the cache first (so the previous
  // on-hand value is the live one), then record the difference.
  if (
    newQuantity !== undefined && newQuantity !== (existing.quantityOnHand || 0)
  ) {
    syncQuantityOnHand([id]);
    const current = getProductById(id)?.quantityOnHand || 0;
    applyStockAdjustment(id, newQuantity - current, "Manual adjustment");
  }

  return getProductById(id);
};

export const deleteProduct = (productId: string): void => {
  const db = getDatabase();
  const existing = getProductById(productId);
  if (!existing) {
    throw new Error("Product not found");
  }

  // Soft-delete: set is_active = false
  db.query(
    `UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), productId],
  );
};

export const isProductUsedInInvoices = (productId: string): boolean => {
  const db = getDatabase();
  const results = db.query(
    "SELECT COUNT(*) FROM invoice_items WHERE product_id = ?",
    [productId],
  ) as unknown[][];
  return Number(results[0]?.[0] ?? 0) > 0;
};

export const reactivateProduct = (productId: string): Product | null => {
  const db = getDatabase();
  const existing = getProductById(productId);
  if (!existing) return null;

  db.query(
    `UPDATE products SET is_active = 1, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), productId],
  );

  return getProductById(productId);
};
