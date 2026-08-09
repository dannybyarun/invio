/**
 * Purchase Orders Controller
 * Create/read/receive purchase orders. Receiving stock in updates inventory.
 */
import { calculateInvoiceTotals, getDatabase } from "../database/init.ts";
import {
  CreatePurchaseOrderRequest,
  PurchaseOrder,
  PurchaseOrderItem,
} from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";
import { reconcilePurchaseOrderStock } from "./stock.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function nextPurchaseOrderNumber(): string {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const rows = db.query(
    "SELECT po_number FROM purchase_orders WHERE po_number LIKE ?",
    [`PO-${year}-%`],
  ) as unknown[][];
  let max = 0;
  const re = new RegExp(`^PO-${year}-(\\d+)$`);
  for (const row of rows) {
    const m = String(row[0] ?? "").match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return `PO-${year}-${String(max + 1).padStart(3, "0")}`;
}

function mapRowToPO(row: unknown[]): PurchaseOrder {
  return {
    id: row[0] as string,
    poNumber: row[1] as string,
    supplierId: (row[2] ?? undefined) as string | undefined,
    orderDate: String(row[3]),
    status: row[4] as PurchaseOrder["status"],
    notes: (row[5] ?? undefined) as string | undefined,
    subtotal: Number(row[6]) || 0,
    taxAmount: Number(row[7]) || 0,
    total: Number(row[8]) || 0,
    receivedAt: row[9] ? String(row[9]) : undefined,
    createdAt: new Date(row[10] as string),
    updatedAt: new Date(row[11] as string),
  };
}

export const getPurchaseOrders = (): PurchaseOrder[] => {
  const db = getDatabase();
  const rows = db.query(
    `SELECT po.id, po.po_number, po.supplier_id, po.order_date, po.status, po.notes,
            po.subtotal, po.tax_amount, po.total, po.received_at, po.created_at, po.updated_at,
            s.name
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     ORDER BY po.order_date DESC, po.created_at DESC`,
  ) as unknown[][];
  return rows.map((row) => {
    const po = mapRowToPO(row.slice(0, 12));
    po.supplierName = row[12] ? String(row[12]) : undefined;
    return po;
  });
};

export const getPurchaseOrderById = (id: string): PurchaseOrder | null => {
  const db = getDatabase();
  const rows = db.query(
    `SELECT po.id, po.po_number, po.supplier_id, po.order_date, po.status, po.notes,
            po.subtotal, po.tax_amount, po.total, po.received_at, po.created_at, po.updated_at,
            s.name
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = ?`,
    [id],
  ) as unknown[][];
  if (rows.length === 0) return null;
  const po = mapRowToPO(rows[0].slice(0, 12));
  po.supplierName = rows[0][12] ? String(rows[0][12]) : undefined;

  const itemRows = db.query(
    `SELECT id, purchase_order_id, product_id, description, quantity, unit_price, line_total
     FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY rowid`,
    [id],
  ) as unknown[][];
  po.items = itemRows.map((r): PurchaseOrderItem => ({
    id: String(r[0]),
    purchaseOrderId: String(r[1]),
    productId: r[2] ? String(r[2]) : undefined,
    description: String(r[3]),
    quantity: Number(r[4]),
    unitPrice: Number(r[5]),
    lineTotal: Number(r[6]),
  }));
  return po;
};

export const createPurchaseOrder = (
  data: CreatePurchaseOrderRequest,
): PurchaseOrder => {
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString();
  const items = (data.items || []).map((it) => ({
    ...it,
    description: String(it.description || "").trim() || "Item",
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unitPrice) || 0,
  }));
  if (items.length === 0) {
    throw new Error("Purchase order needs at least one item");
  }

  const totals = calculateInvoiceTotals(
    items,
    0,
    0,
    Number(data.taxRate) || 0,
    false,
  );

  db.execute("BEGIN");
  try {
    db.query(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, order_date, status, notes, subtotal, tax_amount, total, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        nextPurchaseOrderNumber(),
        data.supplierId ? String(data.supplierId) : null,
        String(data.orderDate || now.slice(0, 10)),
        data.notes ? String(data.notes).trim() : null,
        totals.subtotal,
        totals.taxAmount,
        totals.total,
        now,
        now,
      ],
    );
    for (const it of items) {
      db.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, description, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          id,
          it.productId ? String(it.productId) : null,
          it.description,
          it.quantity,
          it.unitPrice,
          r2(it.quantity * it.unitPrice),
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
  return getPurchaseOrderById(id)!;
};

/** Mark a purchase order as received → stock moves in. */
export const receivePurchaseOrder = (id: string): PurchaseOrder | null => {
  const existing = getPurchaseOrderById(id);
  if (!existing) return null;
  if (existing.status === "received") return existing;
  if (existing.status === "voided") {
    throw new Error("Voided purchase orders cannot be received");
  }

  const db = getDatabase();
  db.query(
    "UPDATE purchase_orders SET status = 'received', received_at = ?, updated_at = ? WHERE id = ?",
    [new Date().toISOString(), new Date().toISOString(), id],
  );
  reconcilePurchaseOrderStock(id);
  return getPurchaseOrderById(id);
};

export const voidPurchaseOrder = (id: string): PurchaseOrder | null => {
  const existing = getPurchaseOrderById(id);
  if (!existing) return null;
  if (existing.status === "received") {
    throw new Error("Received purchase orders cannot be voided");
  }
  const db = getDatabase();
  db.query(
    "UPDATE purchase_orders SET status = 'voided', updated_at = ? WHERE id = ?",
    [new Date().toISOString(), id],
  );
  return getPurchaseOrderById(id);
};

export const deletePurchaseOrder = (id: string): boolean => {
  const existing = getPurchaseOrderById(id);
  if (!existing) throw new Error("Purchase order not found");
  if (existing.status === "received") {
    throw new Error("Received purchase orders cannot be deleted");
  }
  const db = getDatabase();
  db.query("DELETE FROM purchase_orders WHERE id = ?", [id]);
  return true;
};
