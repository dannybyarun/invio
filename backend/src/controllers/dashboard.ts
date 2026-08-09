/**
 * Dashboard KPIs Controller
 * Aggregations used by the dashboard: low stock, top products, monthly
 * revenue trend, gross profit, and cash-vs-credit split.
 */
import { getDatabase } from "../database/init.ts";
import { getLowStockProducts } from "./stock.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DashboardKpis {
  lowStock: Awaited<ReturnType<typeof getLowStockProducts>>;
  topProducts: Array<{
    productId: string;
    name: string;
    quantity: number;
    revenue: number;
    profit: number;
  }>;
  monthlyTrend: Array<{
    month: string; // YYYY-MM
    label: string;
    billed: number;
    collected: number;
  }>;
  profit: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    marginPct: number;
  };
  cashVsCredit: {
    collected: number;
    outstanding: number;
    byMethod: Array<{ method: string; amount: number }>;
  };
}

export function getDashboardKpis(months = 6): DashboardKpis {
  const db = getDatabase();

  // ---- Top products by revenue (non-draft, non-voided invoices) ----
  const topRows = db.query(
    `SELECT ii.product_id, p.name,
            SUM(ii.quantity) AS qty,
            SUM(ii.line_total) AS revenue,
            COALESCE(SUM((ii.unit_price - COALESCE(p.cost_price, 0)) * ii.quantity), 0) AS profit
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     LEFT JOIN products p ON p.id = ii.product_id
     WHERE ii.product_id IS NOT NULL AND i.status NOT IN ('draft', 'voided')
     GROUP BY ii.product_id
     ORDER BY revenue DESC
     LIMIT 10`,
  ) as unknown[][];
  const topProducts = topRows.map((row) => ({
    productId: String(row[0]),
    name: String(row[1] ?? "Unknown"),
    quantity: Number(row[2]) || 0,
    revenue: r2(Number(row[3]) || 0),
    profit: r2(Number(row[4]) || 0),
  }));

  // ---- Profit: revenue vs COGS ----
  const profitRows = db.query(
    `SELECT COALESCE(SUM(ii.line_total), 0),
            COALESCE(SUM(COALESCE(p.cost_price, 0) * ii.quantity), 0)
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     LEFT JOIN products p ON p.id = ii.product_id
     WHERE i.status NOT IN ('draft', 'voided')`,
  ) as unknown[][];
  const revenue = r2(Number(profitRows[0]?.[0]) || 0);
  const cogs = r2(Number(profitRows[0]?.[1]) || 0);
  const grossProfit = r2(revenue - cogs);
  const marginPct = revenue > 0 ? r2((grossProfit / revenue) * 100) : 0;

  // ---- Monthly trend (last N months, by issue_date) ----
  const monthlyTrend: DashboardKpis["monthlyTrend"] = [];
  const now = new Date();
  for (let m = months - 1; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const key = `${d.getFullYear()}-${
      String(d.getMonth() + 1).padStart(2, "0")
    }`;
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
    const rows = db.query(
      `SELECT
         COALESCE(SUM(i.total), 0),
         COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE strftime('%Y-%m', p.paid_at) = ?), 0)
       FROM invoices i
       WHERE strftime('%Y-%m', i.issue_date) = ? AND i.status NOT IN ('draft', 'voided')`,
      [key, key],
    ) as unknown[][];
    monthlyTrend.push({
      month: key,
      label,
      billed: r2(Number(rows[0]?.[0]) || 0),
      collected: r2(Number(rows[0]?.[1]) || 0),
    });
  }

  // ---- Cash vs credit ----
  const collectedRows = db.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM invoice_payments), 0) +
       COALESCE((SELECT SUM(amount) FROM payment_transactions), 0)`,
  ) as unknown[][];
  const outstandingRows = db.query(
    `SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status NOT IN ('draft', 'voided')`,
  ) as unknown[][];
  const collected = r2(Number(collectedRows[0]?.[0]) || 0);
  const billed = r2(Number(outstandingRows[0]?.[0]) || 0);
  const byMethodRows = db.query(
    `SELECT COALESCE(NULLIF(payment_method, ''), 'Not set'), SUM(total)
     FROM invoices
     WHERE status NOT IN ('draft', 'voided') AND total > 0
     GROUP BY payment_method
     ORDER BY SUM(total) DESC
     LIMIT 8`,
  ) as unknown[][];
  const byMethod = byMethodRows.map((row) => ({
    method: String(row[0]),
    amount: r2(Number(row[1]) || 0),
  }));

  return {
    lowStock: getLowStockProducts(10),
    topProducts,
    monthlyTrend,
    profit: { revenue, cogs, grossProfit, marginPct },
    cashVsCredit: {
      collected,
      outstanding: r2(Math.max(0, billed - collected)),
      byMethod,
    },
  };
}
