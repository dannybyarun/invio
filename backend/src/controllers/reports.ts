/**
 * Reports Controller
 * Profit & Loss and stock valuation reporting.
 */
import { getDatabase } from "../database/init.ts";
import { getInvoices } from "./invoices.ts";
import { getCreditNotes } from "./creditNotes.ts";
import { getExpenses } from "./expenses.ts";
import { getProducts } from "./products.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ProfitLossRow {
  label: string;
  amount: number;
}

export interface ProfitLossReport {
  startDate?: string;
  endDate?: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  expenses: number;
  creditNotes: number;
  netProfit: number;
  netMarginPercent: number;
  revenueRows: ProfitLossRow[];
  expenseRows: ProfitLossRow[];
}

const inRange = (date: string, start?: string, end?: string): boolean => {
  if (!start && !end) return true;
  const d = (date || "").slice(0, 10);
  if (!d) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
};

/**
 * Profit & Loss report.
 * Revenue = non-draft, non-voided invoice totals (accrual basis; partially
 * paid invoices count the collected amount). COGS = cost of stock sold within
 * the range (sale movements) minus returned stock (return movements). Credit
 * notes and expenses further reduce profit.
 */
export function getProfitLossReport(
  startDate?: string,
  endDate?: string,
): ProfitLossReport {
  const db = getDatabase();
  const start = startDate || undefined;
  const end = endDate || undefined;

  // ---- Revenue: invoices issued in range (accrual) ----
  let revenue = 0;
  const revenueRows: ProfitLossRow[] = [];
  const invoices = getInvoices().filter(
    (inv) =>
      (inv.status === "paid" ||
        inv.status === "complete" ||
        inv.status === "sent" ||
        inv.status === "overdue") &&
      inRange(String(inv.issueDate), start, end),
  );

  for (const inv of invoices) {
    // Accrual basis, capped at the collected amount for partially paid
    // invoices (complete invoices that are not fully settled are counted
    // as collected only, so revenue is never overstated).
    const paid = Number(inv.amountPaid) || 0;
    const amount = paid > 0
      ? Math.min(paid, Number(inv.total) || 0)
      : (Number(inv.total) || 0);
    revenue += amount;
    revenueRows.push({ label: inv.invoiceNumber, amount: r2(amount) });
  }

  // ---- COGS: cost of goods sold (sales within range, less returns) ----
  let cogs = 0;
  const movements = db.query(
    `SELECT sm.quantity, p.cost_price, sm.created_at
     FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
     WHERE sm.reason IN ('sale', 'return')`,
  ) as unknown[][];
  for (const row of movements) {
    const qty = Math.abs(Number(row[0]) || 0);
    if (qty <= 0) continue;
    const cost = Number(row[1]) || 0;
    const at = row[2] ? String(row[2]).slice(0, 10) : "";
    if (!inRange(at, start, end)) continue;
    if (String(row[0]).startsWith("-")) {
      // sale movement decrements stock -> cost of sale
      cogs += qty * cost;
    } else {
      // return movement restores stock -> reduces COGS
      cogs -= qty * cost;
    }
  }
  cogs = Math.max(0, r2(cogs));

  // ---- Credit notes reduce revenue (issued in range) ----
  const creditTotal = getCreditNotes()
    .filter((cn) => inRange(String(cn.issueDate), start, end))
    .reduce((s, cn) => s + (Number(cn.total) || 0), 0);

  // ---- Expenses ----
  let expenses = 0;
  const expenseRows: ProfitLossRow[] = [];
  for (const exp of getExpenses()) {
    if (!inRange(String(exp.expenseDate), start, end)) continue;
    const amount = Number(exp.amount) || 0;
    expenses += amount;
    expenseRows.push({
      label: exp.category && exp.category !== "Other"
        ? exp.category
        : (exp.description || "Expense").slice(0, 60),
      amount: r2(amount),
    });
  }

  const grossProfit = r2(revenue - cogs);
  const grossMarginPercent = revenue > 0
    ? r2((grossProfit / revenue) * 100)
    : 0;
  const netProfit = r2(grossProfit - expenses - creditTotal);
  const netMarginPercent = revenue > 0 ? r2((netProfit / revenue) * 100) : 0;

  return {
    startDate: start,
    endDate: end,
    revenue: r2(revenue),
    cogs: r2(cogs),
    grossProfit,
    grossMarginPercent,
    expenses: r2(expenses),
    creditNotes: r2(creditTotal),
    netProfit,
    netMarginPercent,
    revenueRows,
    expenseRows,
  };
}

export interface StockValuationItem {
  productId: string;
  name: string;
  sku?: string;
  barcode?: string;
  quantityOnHand: number;
  costPrice: number;
  value: number;
  reorderLevel: number;
  lowStock: boolean;
}

export interface StockValuationReport {
  items: StockValuationItem[];
  totalValue: number;
  totalQuantity: number;
  lowStockCount: number;
  reorderCost: number;
  lastUpdated: string;
}

/** Current inventory valuation: quantity_on_hand × cost_price per product. */
export function getStockValuationReport(): StockValuationReport {
  const products = getProducts(true);
  const items: StockValuationItem[] = products.map((p) => {
    const quantityOnHand = Number(p.quantityOnHand) || 0;
    const costPrice = Number(p.costPrice) || 0;
    const reorderLevel = Number(p.reorderLevel) || 0;
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      quantityOnHand,
      costPrice,
      value: r2(quantityOnHand * costPrice),
      reorderLevel,
      lowStock: reorderLevel > 0 && quantityOnHand <= reorderLevel,
    };
  });

  const totalValue = r2(items.reduce((s, i) => s + i.value, 0));
  const totalQuantity = r2(items.reduce((s, i) => s + i.quantityOnHand, 0));
  const lowStockCount = items.filter((i) => i.lowStock).length;
  const reorderCost = r2(
    items
      .filter((i) => i.lowStock)
      .reduce(
        (s, i) => s + (i.reorderLevel - i.quantityOnHand) * i.costPrice,
        0,
      ),
  );

  return {
    items,
    totalValue,
    totalQuantity,
    lowStockCount,
    reorderCost,
    lastUpdated: new Date().toISOString(),
  };
}
