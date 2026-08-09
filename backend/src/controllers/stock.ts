/**
 * Stock / Inventory Controller
 *
 * `stock_movements` is the source of truth for inventory. The
 * `products.quantity_on_hand` column is a denormalized cache kept in sync
 * by `syncQuantityOnHand`. Reconciliation functions (re)build the movements
 * for a business document from its current items + state, so they never
 * drift even when invoices are edited or voided.
 */
import { getDatabase } from "../database/init.ts";
import { generateUUID } from "../utils/uuid.ts";
import type { StockMovement, StockReason } from "../types/index.ts";

function recordMovement(
  productId: string,
  quantity: number,
  reason: StockReason,
  refType?: string,
  refId?: string,
  note?: string,
): void {
  const db = getDatabase();
  db.query(
    `INSERT INTO stock_movements (id, product_id, quantity, reason, ref_type, ref_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateUUID(),
      productId,
      quantity,
      reason,
      refType ?? null,
      refId ?? null,
      note ?? null,
      new Date().toISOString(),
    ],
  );
}

function deleteMovements(refType: string, refId: string): void {
  const db = getDatabase();
  db.query("DELETE FROM stock_movements WHERE ref_type = ? AND ref_id = ?", [
    refType,
    refId,
  ]);
}

/** Recompute the denormalized quantity_on_hand for the given products. */
export function syncQuantityOnHand(productIds: string[]): void {
  if (productIds.length === 0) return;
  const db = getDatabase();
  const unique = [...new Set(productIds)];
  for (const productId of unique) {
    const rows = db.query(
      "SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE product_id = ?",
      [productId],
    ) as unknown[][];
    const qty = Number((rows[0] as unknown[])[0]) || 0;
    db.query("UPDATE products SET quantity_on_hand = ? WHERE id = ?", [
      qty,
      productId,
    ]);
  }
}

export function getProductStock(productId: string): number {
  const db = getDatabase();
  const rows = db.query(
    "SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE product_id = ?",
    [productId],
  ) as unknown[][];
  return Number((rows[0] as unknown[])[0]) || 0;
}

/**
 * Rebuild stock movements for an invoice from its current items + status.
 * Sales decrement stock (-qty); drafts and voided invoices produce nothing
 * (so voiding restores stock automatically).
 */
export function reconcileInvoiceStock(invoiceId: string): void {
  const db = getDatabase();
  // Capture the products this invoice previously moved, then clear its ledger.
  const prior = db.query(
    "SELECT DISTINCT product_id FROM stock_movements WHERE ref_type = 'invoice' AND ref_id = ?",
    [invoiceId],
  ) as unknown[][];
  deleteMovements("invoice", invoiceId);
  const affected = prior.map((row) => String(row[0]));

  const statusRows = db.query(
    "SELECT status FROM invoices WHERE id = ?",
    [invoiceId],
  ) as unknown[][];
  if (statusRows.length === 0) {
    syncQuantityOnHand(affected);
    return;
  }
  const status = String(statusRows[0][0]);
  if (status === "draft" || status === "voided") {
    // No sale movements for drafts/voided invoices — but still resync so a
    // previous issued state is fully reversed (e.g. after voiding).
    syncQuantityOnHand(affected);
    return;
  }

  const items = db.query(
    "SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ? AND product_id IS NOT NULL",
    [invoiceId],
  ) as unknown[][];

  const touched: string[] = [];
  for (const row of items) {
    const productId = String(row[0]);
    const qty = Number(row[1]) || 0;
    if (qty <= 0) continue;
    recordMovement(
      productId,
      -qty,
      "sale",
      "invoice",
      invoiceId,
      "Sale via invoice",
    );
    touched.push(productId);
  }
  syncQuantityOnHand([...affected, ...touched]);
}

/** Rebuild stock movements for a credit note (returns stock, +qty). */
export function reconcileCreditNoteStock(creditNoteId: string): void {
  const db = getDatabase();
  const prior = db.query(
    "SELECT DISTINCT product_id FROM stock_movements WHERE ref_type = 'credit_note' AND ref_id = ?",
    [creditNoteId],
  ) as unknown[][];
  deleteMovements("credit_note", creditNoteId);
  const affected = prior.map((row) => String(row[0]));

  const statusRows = db.query(
    "SELECT status FROM credit_notes WHERE id = ?",
    [creditNoteId],
  ) as unknown[][];
  if (statusRows.length === 0 || String(statusRows[0][0]) === "voided") {
    syncQuantityOnHand(affected);
    return;
  }

  const items = db.query(
    "SELECT product_id, quantity FROM credit_note_items WHERE credit_note_id = ? AND product_id IS NOT NULL",
    [creditNoteId],
  ) as unknown[][];

  const touched: string[] = [];
  for (const row of items) {
    const productId = String(row[0]);
    const qty = Number(row[1]) || 0;
    if (qty <= 0) continue;
    recordMovement(
      productId,
      qty,
      "return",
      "credit_note",
      creditNoteId,
      "Return via credit note",
    );
    touched.push(productId);
  }
  syncQuantityOnHand([...affected, ...touched]);
}

/** Rebuild stock movements for a purchase order (stock in, +qty) when received. */
export function reconcilePurchaseOrderStock(purchaseOrderId: string): void {
  const db = getDatabase();
  const prior = db.query(
    "SELECT DISTINCT product_id FROM stock_movements WHERE ref_type = 'purchase_order' AND ref_id = ?",
    [purchaseOrderId],
  ) as unknown[][];
  deleteMovements("purchase_order", purchaseOrderId);
  const affected = prior.map((row) => String(row[0]));

  const statusRows = db.query(
    "SELECT status FROM purchase_orders WHERE id = ?",
    [purchaseOrderId],
  ) as unknown[][];
  if (statusRows.length === 0 || String(statusRows[0][0]) !== "received") {
    syncQuantityOnHand(affected);
    return;
  }

  const items = db.query(
    "SELECT product_id, quantity FROM purchase_order_items WHERE purchase_order_id = ? AND product_id IS NOT NULL",
    [purchaseOrderId],
  ) as unknown[][];

  const touched: string[] = [];
  for (const row of items) {
    const productId = String(row[0]);
    const qty = Number(row[1]) || 0;
    if (qty <= 0) continue;
    recordMovement(
      productId,
      qty,
      "purchase",
      "purchase_order",
      purchaseOrderId,
      "Stock received",
    );
    touched.push(productId);
  }
  syncQuantityOnHand([...affected, ...touched]);
}

/** Record an opening stock quantity when a product is first created. */
export function applyOpeningStock(
  productId: string,
  quantity: number,
): void {
  const qty = Number(quantity) || 0;
  if (qty === 0) return;
  recordMovement(
    productId,
    qty,
    "opening",
    "product",
    productId,
    "Opening stock",
  );
  syncQuantityOnHand([productId]);
}

/** Apply a manual stock adjustment (delta) to a product. */
export function applyStockAdjustment(
  productId: string,
  delta: number,
  note?: string,
): void {
  const qty = Number(delta) || 0;
  if (qty === 0) return;
  recordMovement(
    productId,
    qty,
    "adjustment",
    "product",
    productId,
    note || "Stock adjustment",
  );
  syncQuantityOnHand([productId]);
}

/** Remove all movements for a deleted business document. */
export function deleteStockMovementsForRef(
  refType: string,
  refId: string,
): void {
  const db = getDatabase();
  const rows = db.query(
    "SELECT DISTINCT product_id FROM stock_movements WHERE ref_type = ? AND ref_id = ?",
    [refType, refId],
  ) as unknown[][];
  deleteMovements(refType, refId);
  syncQuantityOnHand(rows.map((r) => String(r[0])));
}

export function getStockMovements(
  productId?: string,
  limit = 200,
): StockMovement[] {
  const db = getDatabase();
  const rows = productId
    ? db.query(
      `SELECT id, product_id, quantity, reason, ref_type, ref_id, note, created_at
       FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC LIMIT ?`,
      [productId, limit],
    )
    : db.query(
      `SELECT id, product_id, quantity, reason, ref_type, ref_id, note, created_at
       FROM stock_movements ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
  return (rows as unknown[][]).map((row) => ({
    id: String(row[0]),
    productId: String(row[1]),
    quantity: Number(row[2]),
    reason: String(row[3]) as StockReason,
    refType: row[4] ? String(row[4]) : undefined,
    refId: row[5] ? String(row[5]) : undefined,
    note: row[6] ? String(row[6]) : undefined,
    createdAt: new Date(String(row[7])),
  }));
}

/** Products running low on stock (on-hand <= reorder level). */
export function getLowStockProducts(limit = 10): Array<{
  id: string;
  name: string;
  sku?: string;
  quantityOnHand: number;
  reorderLevel: number;
  unit?: string;
}> {
  const db = getDatabase();
  const rows = db.query(
    `SELECT id, name, sku, quantity_on_hand, reorder_level, unit
     FROM products
     WHERE is_active = 1 AND reorder_level > 0 AND quantity_on_hand <= reorder_level
     ORDER BY quantity_on_hand ASC LIMIT ?`,
    [limit],
  ) as unknown[][];
  return rows.map((row) => ({
    id: String(row[0]),
    name: String(row[1]),
    sku: row[2] ? String(row[2]) : undefined,
    quantityOnHand: Number(row[3]) || 0,
    reorderLevel: Number(row[4]) || 0,
    unit: row[5] ? String(row[5]) : undefined,
  }));
}
