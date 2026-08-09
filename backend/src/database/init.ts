import { DB } from "sqlite";
import { getAdminCredentials, getEnv, isDemoMode } from "../utils/env.ts";
import { hashPassword } from "../utils/password.ts";
import { generateUUID } from "../utils/uuid.ts";
import { RESOURCE_ACTIONS } from "../types/index.ts";
import type { Action, Resource } from "../types/index.ts";

let db: DB | undefined;

//
//  Path helpers
//

function resolvePath(p: string): string {
  return p.startsWith("/") ? p : p;
}

function simpleDirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function ensureDir(dir: string): void {
  if (dir && dir !== "." && dir !== "/") {
    try {
      Deno.mkdirSync(dir, { recursive: true });
    } catch {
      /* ok */
    }
  }
}

//
//  Version & backup helpers
//

function readAppVersion(): string {
  try {
    return Deno.readTextFileSync("./VERSION").trim();
  } catch {
    return "unknown";
  }
}

function getStoredSchemaVersion(database: DB): string | null {
  try {
    const rows = database.query(
      "SELECT value FROM settings WHERE key = '_schema_version' LIMIT 1",
    );
    return rows.length > 0 ? String((rows[0] as unknown[])[0]) : null;
  } catch {
    return null; // settings table doesn't exist yet
  }
}

function storeSchemaVersion(database: DB): void {
  try {
    database.query(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('_schema_version', ?)",
      [readAppVersion()],
    );
  } catch {
    /* ignore */
  }
}

function createDatabaseBackup(
  dbPath: string,
  fromVersion?: string | null,
): void {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const suffix = fromVersion ? `_v${fromVersion}` : "";
  const backupPath = dbPath.replace(/\.db$/, "") + `_backup${suffix}_${ts}.db`;
  try {
    Deno.copyFileSync(dbPath, backupPath);
    console.log(` Database backup created: ${backupPath}`);
  } catch (e) {
    console.warn("Failed to create database backup:", e);
  }
}

/** Back up the database if the stored schema version differs from the app version. */
function backupIfVersionChanged(database: DB, dbPath: string): void {
  try {
    const stored = getStoredSchemaVersion(database);
    if (stored !== readAppVersion()) {
      createDatabaseBackup(dbPath, stored);
    }
  } catch {
    try {
      createDatabaseBackup(dbPath);
    } catch {
      /* ignore */
    }
  }
}

//
//  Migration helpers
//

/** Parse a .sql file into executable statements (strip comments, split on `;`). */
function parseSqlStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => {
      if (line.trimStart().startsWith("--")) return "";
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Run each statement, silently ignoring "already exists" / "duplicate column" errors. */
function executeMigrations(database: DB, statements: string[]): void {
  for (const stmt of statements) {
    try {
      database.execute(stmt);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/already exists|duplicate column name/i.test(msg)) {
        console.error("Migration error:", msg);
        console.error("Statement:", stmt);
      }
    }
  }
}

/** Safely add a column if it doesn't already exist. */
function addColumnIfMissing(
  database: DB,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = (
    database.query(`PRAGMA table_info(${table})`) as unknown[][]
  ).map((r) => String(r[1]));
  if (cols.includes(column)) return;
  try {
    database.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(` Added ${table}.${column} column`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/duplicate column|already exists/i.test(msg)) {
      console.warn(`Could not add ${table}.${column}:`, msg);
    }
  }
}

//
//  Schema upgrades
//

function ensureCustomerColumns(database: DB): void {
  addColumnIfMissing(database, "customers", "contact_name", "TEXT");
  addColumnIfMissing(database, "customers", "country_code", "TEXT");
  addColumnIfMissing(database, "customers", "city", "TEXT");
  addColumnIfMissing(database, "customers", "postal_code", "TEXT");
  addColumnIfMissing(database, "customers", "customer_number", "INTEGER");
}

/** Assign a permanent sequential customer_number (by creation order) to any customer missing one. */
function backfillCustomerNumbers(database: DB): void {
  const rows = database.query(
    "SELECT id FROM customers WHERE customer_number IS NULL ORDER BY created_at ASC, id ASC",
  ) as unknown[][];
  if (rows.length === 0) return;

  const maxRow = database.query(
    "SELECT COALESCE(MAX(customer_number), 0) FROM customers",
  ) as unknown[][];
  let next = Number((maxRow[0] as unknown[])[0]) + 1;

  for (const row of rows) {
    database.query("UPDATE customers SET customer_number = ? WHERE id = ?", [
      next,
      String(row[0]),
    ]);
    next++;
  }

  console.log(
    `  Backfilled customer_number for ${rows.length} existing customer(s).`,
  );
}

function ensureInvoiceColumns(database: DB): void {
  addColumnIfMissing(
    database,
    "invoices",
    "prices_include_tax",
    "BOOLEAN DEFAULT 0",
  );
  addColumnIfMissing(
    database,
    "invoices",
    "rounding_mode",
    "TEXT DEFAULT 'line'",
  );
  addColumnIfMissing(database, "invoices", "payment_method", "TEXT");
  addColumnIfMissing(database, "invoices", "fonepay_qr_type", "TEXT");
  addColumnIfMissing(database, "invoices", "fonepay_qr_data", "TEXT");
  addColumnIfMissing(database, "invoices", "fonepay_bill_id", "TEXT");
  addColumnIfMissing(database, "invoices", "fonepay_qr_amount", "NUMERIC");
  addColumnIfMissing(database, "invoices", "fonepay_transaction_id", "TEXT");
  addColumnIfMissing(database, "invoices", "fonepay_verified_at", "TEXT");
}

function ensureInvoiceItemColumns(database: DB): void {
  addColumnIfMissing(database, "invoice_items", "unit", "TEXT");
  addColumnIfMissing(
    database,
    "invoice_items",
    "product_id",
    "TEXT REFERENCES products(id)",
  );
}

function ensureUserColumns(database: DB): void {
  addColumnIfMissing(database, "users", "two_factor_secret", "TEXT");
  addColumnIfMissing(
    database,
    "users",
    "two_factor_enabled",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(database, "users", "two_factor_recovery_codes", "TEXT");
  addColumnIfMissing(database, "users", "oidc_subject", "TEXT");
}

function ensureFonepayQrPayloadTable(database: DB): void {
  database.execute(`
    CREATE TABLE IF NOT EXISTS fonepay_qr_payloads (
      invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
      qr_message TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      bill_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function ensurePaymentTransactionsTable(database: DB): void {
  database.execute(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_transaction_id TEXT NOT NULL,
      provider_reference TEXT,
      amount NUMERIC NOT NULL,
      verified_at TEXT NOT NULL,
      UNIQUE(provider, provider_transaction_id),
      UNIQUE(invoice_id, provider)
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice
     ON payment_transactions(invoice_id, verified_at)`,
  );
}

function ensureStatusHistoryTable(database: DB): void {
  database.execute(`
    CREATE TABLE IF NOT EXISTS invoice_status_history (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      payment_method TEXT,
      note TEXT
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_invoice_status_history_invoice_id
     ON invoice_status_history(invoice_id, changed_at)`,
  );
  backfillStatusHistory(database);
}

function backfillStatusHistory(database: DB): void {
  // Insert one history entry per invoice that has no history yet.
  // Uses the invoice's current status and updated_at as the best available timestamp.
  const rows = database.query(
    `SELECT id, status, updated_at FROM invoices
     WHERE id NOT IN (SELECT DISTINCT invoice_id FROM invoice_status_history)`,
  ) as unknown[][];

  if (rows.length === 0) return;

  for (const row of rows) {
    const invoiceId = String(row[0]);
    const status = String(row[1]);
    const changedAt = row[2] ? String(row[2]) : new Date().toISOString();
    database.query(
      `INSERT INTO invoice_status_history (id, invoice_id, status, changed_at, payment_method, note)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      [crypto.randomUUID(), invoiceId, status, changedAt],
    );
  }

  console.log(
    `  Backfilled status history for ${rows.length} existing invoice(s).`,
  );
}

function ensureTaxTables(database: DB): void {
  database.execute(`
    CREATE TABLE IF NOT EXISTS tax_definitions (
      id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT,
      percent NUMERIC NOT NULL, category_code TEXT, country_code TEXT,
      vendor_specific_id TEXT, default_included BOOLEAN DEFAULT 0, metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(`
    CREATE TABLE IF NOT EXISTS invoice_item_taxes (
      id TEXT PRIMARY KEY,
      invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
      tax_definition_id TEXT REFERENCES tax_definitions(id),
      percent NUMERIC NOT NULL, taxable_amount NUMERIC NOT NULL,
      amount NUMERIC NOT NULL, included BOOLEAN NOT NULL DEFAULT 0,
      sequence INTEGER DEFAULT 0, note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(`
    CREATE TABLE IF NOT EXISTS invoice_taxes (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      tax_definition_id TEXT REFERENCES tax_definitions(id),
      percent NUMERIC NOT NULL, taxable_amount NUMERIC NOT NULL,
      tax_amount NUMERIC NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function ensureProductTables(database: DB): void {
  database.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      unit_price NUMERIC NOT NULL DEFAULT 0, sku TEXT, barcode TEXT,
      unit TEXT DEFAULT 'piece', category TEXT,
      tax_definition_id TEXT REFERENCES tax_definitions(id),
      is_active BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  addColumnIfMissing(database, "products", "barcode", "TEXT");
  database.execute(
    "CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)",
  );
  database.execute(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0, is_builtin BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(`
    CREATE TABLE IF NOT EXISTS product_units (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0, is_builtin BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function seedProductDefaults(database: DB): void {
  const categories = [
    { code: "service", name: "Service", sort: 1 },
    { code: "goods", name: "Goods", sort: 2 },
    { code: "subscription", name: "Subscription", sort: 3 },
    { code: "other", name: "Other", sort: 4 },
  ];
  for (const c of categories) {
    try {
      database.query(
        "INSERT OR IGNORE INTO product_categories (id, code, name, sort_order, is_builtin) VALUES (?, ?, ?, ?, 1)",
        [c.code, c.code, c.name, c.sort],
      );
    } catch {
      /* ignore */
    }
  }

  const units = [
    { code: "piece", name: "Piece", sort: 1 },
    { code: "hour", name: "Hour", sort: 2 },
    { code: "day", name: "Day", sort: 3 },
    { code: "kg", name: "Kilogram", sort: 4 },
    { code: "m", name: "Meter", sort: 5 },
    { code: "lump_sum", name: "Lump Sum", sort: 6 },
  ];
  for (const u of units) {
    try {
      database.query(
        "INSERT OR IGNORE INTO product_units (id, code, name, sort_order, is_builtin) VALUES (?, ?, ?, ?, 1)",
        [u.code, u.code, u.name, u.sort],
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Recreate the invoices table to add missing invoice statuses to the CHECK constraint.
 *
 * IMPORTANT: Foreign keys must be OFF during `DROP TABLE`  otherwise SQLite
 * performs an implicit `DELETE FROM invoices` which cascades to invoice_items.
 * See: https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes
 */
function migrateInvoicesForVoided(database: DB): void {
  const checkSql = database.query(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'",
  );
  const createSql = checkSql.length > 0 ? String(checkSql[0][0]) : "";
  if (
    !createSql ||
    (createSql.includes("voided") && createSql.includes("complete"))
  ) {
    return;
  }

  console.log(
    "Migrating invoices table to support 'voided' and 'complete' statuses",
  );

  const itemCountBefore = Number(
    (database.query("SELECT COUNT(*) FROM invoice_items") as unknown[][])[0][0],
  );

  // Disable FK enforcement so DROP TABLE doesn't cascade-delete child rows
  database.execute("PRAGMA foreign_keys = OFF");
  database.execute("BEGIN TRANSACTION");
  try {
    database.execute(`
      CREATE TABLE invoices_new (
        id TEXT PRIMARY KEY,
        invoice_number TEXT UNIQUE NOT NULL,
        customer_id TEXT REFERENCES customers(id),
        issue_date DATE NOT NULL,
        due_date DATE,
        currency TEXT DEFAULT 'USD',
        status TEXT CHECK(status IN ('draft','sent','complete','paid','overdue','voided')) DEFAULT 'draft',
        subtotal NUMERIC NOT NULL DEFAULT 0,
        discount_amount NUMERIC DEFAULT 0,
        discount_percentage NUMERIC DEFAULT 0,
        tax_rate NUMERIC DEFAULT 0,
        tax_amount NUMERIC DEFAULT 0,
        total NUMERIC NOT NULL,
        payment_terms TEXT,
        notes TEXT,
        share_token TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        prices_include_tax BOOLEAN DEFAULT 0,
        rounding_mode TEXT DEFAULT 'line',
        payment_method TEXT,
        fonepay_qr_type TEXT,
        fonepay_qr_data TEXT,
        fonepay_bill_id TEXT,
        fonepay_qr_amount NUMERIC,
        fonepay_transaction_id TEXT,
        fonepay_verified_at TEXT,
        locale TEXT
      )
    `);

    const existingCols = (
      database.query("PRAGMA table_info(invoices)") as unknown[][]
    ).map((r) => String(r[1]));
    const newCols = (
      database.query("PRAGMA table_info(invoices_new)") as unknown[][]
    ).map((r) => String(r[1]));
    const colList = existingCols.filter((c) => newCols.includes(c)).join(", ");

    database.execute(
      `INSERT INTO invoices_new (${colList}) SELECT ${colList} FROM invoices`,
    );
    database.execute("DROP TABLE invoices");
    database.execute("ALTER TABLE invoices_new RENAME TO invoices");

    database.execute(
      "CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number)",
    );
    database.execute(
      "CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id)",
    );
    database.execute(
      "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)",
    );
    database.execute(
      "CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token)",
    );

    database.execute("COMMIT");
    console.log(
      " Migrated invoices table to support 'voided' and 'complete' statuses",
    );
  } catch (migErr) {
    database.execute("ROLLBACK");
    throw migErr;
  } finally {
    database.execute("PRAGMA foreign_keys = ON");
  }

  // Verify child rows survived
  const itemCountAfter = Number(
    (database.query("SELECT COUNT(*) FROM invoice_items") as unknown[][])[0][0],
  );
  if (itemCountAfter !== itemCountBefore) {
    console.error(
      `  WARNING: invoice_items row count changed during migration! ` +
        `Before: ${itemCountBefore}, After: ${itemCountAfter}. ` +
        `Check your database backup for recovery.`,
    );
  } else if (itemCountBefore > 0) {
    console.log(`   Verified: ${itemCountBefore} invoice items preserved`);
  }
}

function ensureBusinessExtras(database: DB): void {
  // ---- Inventory: cost price, stock on hand, reorder level ----
  addColumnIfMissing(database, "products", "cost_price", "NUMERIC DEFAULT 0");
  addColumnIfMissing(
    database,
    "products",
    "quantity_on_hand",
    "NUMERIC DEFAULT 0",
  );
  addColumnIfMissing(
    database,
    "products",
    "reorder_level",
    "NUMERIC DEFAULT 0",
  );

  // Stock movements ledger (source of truth for quantity_on_hand)
  database.execute(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity NUMERIC NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_stock_movements_product
     ON stock_movements(product_id, created_at)`,
  );
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_stock_movements_ref
     ON stock_movements(ref_type, ref_id)`,
  );

  // ---- Suppliers ----
  database.execute(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      tax_id TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ---- Expenses ----
  database.execute(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      expense_date TEXT NOT NULL,
      supplier_id TEXT REFERENCES suppliers(id),
      category TEXT,
      description TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      tax_amount NUMERIC DEFAULT 0,
      payment_method TEXT,
      reference TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)`,
  );

  // ---- Purchase orders ----
  database.execute(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT UNIQUE NOT NULL,
      supplier_id TEXT REFERENCES suppliers(id),
      order_date TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      subtotal NUMERIC NOT NULL DEFAULT 0,
      tax_amount NUMERIC DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      received_at TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id),
      description TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      unit_price NUMERIC NOT NULL,
      line_total NUMERIC NOT NULL
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_po_items_po
     ON purchase_order_items(purchase_order_id)`,
  );

  // ---- Quotes / estimates ----
  database.execute(`
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      quote_number TEXT UNIQUE NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      issue_date TEXT NOT NULL,
      expiry_date TEXT,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'draft',
      subtotal NUMERIC NOT NULL DEFAULT 0,
      discount_amount NUMERIC DEFAULT 0,
      discount_percentage NUMERIC DEFAULT 0,
      tax_rate NUMERIC DEFAULT 0,
      tax_amount NUMERIC DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      payment_terms TEXT,
      notes TEXT,
      converted_invoice_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(`
    CREATE TABLE IF NOT EXISTS quote_items (
      id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id),
      description TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      unit TEXT,
      unit_price NUMERIC NOT NULL,
      line_total NUMERIC NOT NULL,
      sort_order INTEGER DEFAULT 0
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id)`,
  );

  // ---- Credit notes / refunds ----
  database.execute(`
    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      credit_number TEXT UNIQUE NOT NULL,
      invoice_id TEXT REFERENCES invoices(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      issue_date TEXT NOT NULL,
      reason TEXT,
      subtotal NUMERIC NOT NULL DEFAULT 0,
      tax_rate NUMERIC DEFAULT 0,
      tax_amount NUMERIC DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'issued',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice
     ON credit_notes(invoice_id)`,
  );
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_credit_notes_customer
     ON credit_notes(customer_id)`,
  );
  database.execute(`
    CREATE TABLE IF NOT EXISTS credit_note_items (
      id TEXT PRIMARY KEY,
      credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id),
      description TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      unit_price NUMERIC NOT NULL,
      line_total NUMERIC NOT NULL,
      sort_order INTEGER DEFAULT 0
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_credit_note_items_note
     ON credit_note_items(credit_note_id)`,
  );

  // ---- Recurring invoices ----
  database.execute(`
    CREATE TABLE IF NOT EXISTS recurring_invoices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      frequency TEXT NOT NULL,
      interval_count INTEGER NOT NULL DEFAULT 1,
      next_run_date TEXT NOT NULL,
      last_run_date TEXT,
      end_date TEXT,
      default_status TEXT DEFAULT 'draft',
      is_active INTEGER NOT NULL DEFAULT 1,
      template_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_recurring_next_run
     ON recurring_invoices(next_run_date, is_active)`,
  );

  // ---- Manual / partial payments ----
  database.execute(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      method TEXT,
      reference TEXT,
      note TEXT,
      paid_at TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.execute(
    `CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
     ON invoice_payments(invoice_id, paid_at)`,
  );

  // ---- Multi-currency: per-invoice exchange rate ----
  addColumnIfMissing(
    database,
    "invoices",
    "exchange_rate",
    "NUMERIC DEFAULT 1",
  );
  addColumnIfMissing(database, "invoices", "source_quote_id", "TEXT");
}

function ensureSchemaUpgrades(database: DB): void {
  try {
    ensureCustomerColumns(database);
    backfillCustomerNumbers(database);
    ensureInvoiceColumns(database);
    ensureTaxTables(database);
    ensureProductTables(database);
    seedProductDefaults(database);
    migrateInvoicesForVoided(database);
    ensureInvoiceItemColumns(database);
    ensureUserColumns(database);
    ensureFonepayQrPayloadTable(database);
    ensurePaymentTransactionsTable(database);
    ensureStatusHistoryTable(database);
    ensureBusinessExtras(database);
  } catch (e) {
    console.warn("Schema upgrade check failed:", e);
  }
}

//
//  Built-in templates
//

const BUILTIN_TEMPLATES = [
  { id: "professional-modern", name: "Professional Modern", isDefault: false },
  { id: "minimalist-clean", name: "Minimalist Clean", isDefault: true },
  { id: "nova", name: "Nova", isDefault: false },
  { id: "slate", name: "Slate", isDefault: false },
] as const;

function loadTemplateHtml(id: string): string {
  const url = new URL(`../../static/templates/${id}.html`, import.meta.url);
  try {
    return Deno.readTextFileSync(url);
  } catch (e) {
    console.error(`Failed to read template ${url} (cwd=${Deno.cwd()}):`, e);
    return "<html><body><p>Template unavailable.</p></body></html>";
  }
}

function insertBuiltinTemplates(database: DB): void {
  for (const t of BUILTIN_TEMPLATES) {
    const html = loadTemplateHtml(t.id);
    try {
      const existing = database.query(
        "SELECT html FROM templates WHERE id = ?",
        [t.id],
      );
      if (existing.length === 0) {
        database.query(
          "INSERT INTO templates (id, name, html, is_default, created_at) VALUES (?, ?, ?, ?, ?)",
          [t.id, t.name, html, t.isDefault, new Date().toISOString()],
        );
        console.log(` Installed template: ${t.name}`);
      } else {
        const current = String((existing[0] as unknown[])[0] ?? "");
        if (current.trim() !== html.trim()) {
          database.query(
            "UPDATE templates SET name = ?, html = ?, is_default = ? WHERE id = ?",
            [t.name, html, t.isDefault, t.id],
          );
          console.log(`  Updated template from file: ${t.name}`);
        }
      }
    } catch (error) {
      console.error(`Failed to upsert template ${t.name}:`, error);
    }
  }
}

function ensureTemplateDefaults(database: DB): void {
  try {
    database.query("DELETE FROM templates WHERE id = ?", ["default-template"]);

    const rows = database.query("SELECT id FROM templates");
    const ids = rows.map((r) => String((r as unknown[])[0]));

    database.query("UPDATE templates SET is_default = 0");

    const preferred = ids.includes("minimalist-clean")
      ? "minimalist-clean"
      : ids[0];
    if (preferred) {
      database.query("UPDATE templates SET is_default = 1 WHERE id = ?", [
        preferred,
      ]);
    }
  } catch (e) {
    console.error("Failed to ensure template defaults:", e);
  }
}

//
//  Admin seeding
//

async function seedAdminUser(database: DB): Promise<void> {
  try {
    const rows = database.query("SELECT COUNT(*) FROM users");
    if (Number((rows[0] as unknown[])[0]) > 0) return;

    const { username, password } = getAdminCredentials();
    const id = generateUUID();
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    database.query(
      `INSERT INTO users (id, username, email, display_name, password_hash, is_admin, is_active, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 1, 1, ?, ?)`,
      [id, username, username, passwordHash, now, now],
    );

    for (
      const [resource, actions] of Object.entries(RESOURCE_ACTIONS) as [
        Resource,
        readonly Action[],
      ][]
    ) {
      for (const action of actions) {
        database.query(
          "INSERT INTO user_permissions (id, user_id, resource, action) VALUES (?, ?, ?, ?)",
          [generateUUID(), id, resource, action],
        );
      }
    }

    console.log(` Seeded admin user: ${username}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("Could not seed admin user:", msg);
  }
}

//
//  Public API: init / reset / accessors
//

export async function initDatabase(): Promise<void> {
  const dbPath = resolvePath(getEnv("DATABASE_PATH", "./invio.db")!);
  ensureDir(simpleDirname(dbPath));

  // Detect existing database (upgrade vs fresh install)
  let dbFileExisted = false;
  try {
    Deno.statSync(dbPath);
    dbFileExisted = true;
  } catch {
    /* new install */
  }

  db = new DB(dbPath);

  // Backup before migrations if upgrading to a new version
  if (dbFileExisted) backupIfVersionChanged(db, dbPath);

  // Run idempotent migrations from .sql file
  const sql = Deno.readTextFileSync("./src/database/migrations.sql");
  executeMigrations(db, parseSqlStatements(sql));

  // Post-migration setup
  insertBuiltinTemplates(db);
  ensureTemplateDefaults(db);
  ensureSchemaUpgrades(db);
  await seedAdminUser(db);
  storeSchemaVersion(db);

  console.log("Database initialized successfully");
}

export async function resetDatabaseFromDemo(): Promise<void> {
  if (!isDemoMode()) return;
  const demoDb = getEnv("DEMO_DB_PATH");
  const activePath = resolvePath(getEnv("DATABASE_PATH", "./invio.db")!);
  if (!demoDb) {
    throw new Error("DEMO_MODE is true but DEMO_DB_PATH is not set.");
  }
  const demoPath = resolvePath(demoDb);
  const tempPath =
    `${activePath}.demo-reset-${Date.now()}-${crypto.randomUUID()}.tmp`;

  try {
    closeDatabase();
  } catch (error) {
    throw new Error(
      `Failed to close current database before demo reset: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let resetError: unknown = undefined;
  try {
    Deno.statSync(demoPath);
    ensureDir(simpleDirname(activePath));

    Deno.copyFileSync(demoPath, tempPath);
    try {
      Deno.renameSync(tempPath, activePath);
    } catch {
      try {
        Deno.removeSync(activePath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
      Deno.renameSync(tempPath, activePath);
    }
    console.log("  Demo database reset from DEMO_DB_PATH.");
  } catch (e) {
    resetError = e;
  } finally {
    try {
      Deno.removeSync(tempPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn("Could not remove temporary demo reset file:", error);
      }
    }
    await initDatabase();
  }

  if (resetError) {
    throw new Error(
      `Failed to reset demo database: ${
        resetError instanceof Error ? resetError.message : String(resetError)
      }`,
    );
  }
}

export function getDatabase(): DB {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  db.close();
  db = undefined;
}

//
//  Invoice numbering
//

function cryptoRandom(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function generateDraftInvoiceNumber(): string {
  return `DRAFT-${cryptoRandom(6)}`;
}

/** Read invoice-numbering settings from the database. */
function getNumberingSettings(): {
  prefix: string;
  includeYear: boolean;
  pad: number;
  pattern?: string;
  enabled: boolean;
} {
  const database = getDatabase();
  const cfg = {
    prefix: "INV",
    includeYear: true,
    pad: 3,
    pattern: undefined as string | undefined,
    enabled: true,
  };
  try {
    const rows = database.query(
      "SELECT key, value FROM settings WHERE key IN ('invoicePrefix','invoiceIncludeYear','invoiceNumberPadding','invoiceNumberPattern')",
    );
    const m = new Map<string, string>();
    for (const r of rows) {
      const [k, v] = r as [string, string];
      m.set(k, v);
    }

    cfg.prefix = (m.get("invoicePrefix") || cfg.prefix).trim() || cfg.prefix;
    cfg.includeYear =
      (m.get("invoiceIncludeYear") || "true").toLowerCase() !== "false";
    const p = parseInt(m.get("invoiceNumberPadding") || String(cfg.pad), 10);
    if (!Number.isNaN(p) && p >= 2 && p <= 8) cfg.pad = p;
    cfg.pattern = (m.get("invoiceNumberPattern") || "").trim() || undefined;

    try {
      const raw = database.query(
        "SELECT value FROM settings WHERE key = 'invoiceNumberingEnabled' LIMIT 1",
      );
      if (raw.length > 0) {
        cfg.enabled = String(raw[0][0]).toLowerCase() !== "false";
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* use defaults */
  }
  return cfg;
}

/** Find the highest existing sequential suffix matching `likePrefix%`, optionally scoped to a single customer. */
function findMaxSequence(likePrefix: string, customerId?: string): number {
  const database = getDatabase();
  const rows = customerId
    ? database.query(
      "SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? AND customer_id = ?",
      [likePrefix + "%", customerId],
    )
    : database.query(
      "SELECT invoice_number FROM invoices WHERE invoice_number LIKE ?",
      [likePrefix + "%"],
    );
  const escaped = likePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(\\d+).*?$`);
  let max = 0;
  for (const row of rows) {
    const m = String((row as unknown[])[0] ?? "").match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return max;
}

/** Look up a customer's permanent sequential customer_number, if any. */
function getCustomerNumber(customerId?: string): number | null {
  if (!customerId) return null;
  try {
    const database = getDatabase();
    const rows = database.query(
      "SELECT customer_number FROM customers WHERE id = ?",
      [customerId],
    ) as unknown[][];
    if (rows.length === 0) return null;
    const v = rows[0][0];
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

/** Expand date/random tokens in an invoice-number pattern. */
function expandPatternTokens(pattern: string): string {
  const now = new Date();
  const YYYY = String(now.getFullYear());
  const YY = YYYY.slice(-2);
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  return pattern
    .replace(/\{YYYY\}/g, YYYY)
    .replace(/\{YY\}/g, YY)
    .replace(/\{MM\}/g, MM)
    .replace(/\{DD\}/g, DD)
    .replace(/\{DATE\}/g, `${YYYY}${MM}${DD}`)
    .replace(/\{RAND4\}/g, () => cryptoRandom(4));
}

export function getNextInvoiceNumber(customerId?: string): string {
  const cfg = getNumberingSettings();

  // Advanced pattern mode (when enabled and configured)
  if (cfg.pattern && cfg.enabled) {
    const expanded = expandPatternTokens(cfg.pattern);
    const hasSeq = /\{SEQ\}/.test(cfg.pattern);
    const hasClientSeq = /\{CSEQ\}/.test(cfg.pattern);
    const hasCustomerNum = /\{CNUM\}/.test(cfg.pattern);
    if (!hasSeq && !hasClientSeq && !hasCustomerNum) return expanded;

    let result = expanded;
    // {CNUM} must resolve first: {SEQ}/{CSEQ} scan existing invoice_number
    // values using everything before them as a LIKE prefix, so that prefix
    // has to be fully literal (no leftover {CNUM} placeholder) or it will
    // never match a real stored invoice number and the counter always
    // reads as empty (stuck at 1).
    if (hasCustomerNum) {
      // {CNUM}: the customer's own permanent sequential number
      const custNum = getCustomerNumber(customerId);
      result = result.replace(
        /\{CNUM\}/g,
        custNum != null ? String(custNum).padStart(3, "0") : "",
      );
    }
    if (hasSeq) {
      // {SEQ}: global counter, shared across all customers
      const prefix = result.split("{SEQ}")[0];
      const next = findMaxSequence(prefix) + 1;
      result = result.replace(/\{SEQ\}/g, String(next).padStart(3, "0"));
    }
    if (hasClientSeq) {
      // {CSEQ}: counter scoped to this customer's own invoices
      const prefix = result.split("{CSEQ}")[0];
      const next = findMaxSequence(prefix, customerId) + 1;
      result = result.replace(/\{CSEQ\}/g, String(next).padStart(3, "0"));
    }
    return result;
  }

  // Legacy mode: PREFIX-YYYY-NNN (global, no per-client variant)
  const base = cfg.includeYear
    ? `${cfg.prefix}-${new Date().getFullYear()}-`
    : `${cfg.prefix}-`;
  const next = findMaxSequence(base) + 1;
  return `${base}${String(next).padStart(cfg.pad, "0")}`;
}

//
//  Invoice total calculations
//

export interface CalculatedTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calculateInvoiceTotals(
  items: Array<{ quantity: number; unitPrice: number }>,
  discountPercentage = 0,
  discountAmount = 0,
  taxRate = 0,
  pricesIncludeTax = false,
  roundingMode: "line" | "total" = "line",
): CalculatedTotals {
  const rate = Math.max(0, Number(taxRate) || 0) / 100;

  const lineGrosses = items.map(
    (it) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
  );
  const subtotal = lineGrosses.reduce((a, b) => a + b, 0);

  let finalDiscount = Number(discountAmount) || 0;
  if (discountPercentage > 0) {
    finalDiscount = subtotal * (discountPercentage / 100);
  }
  finalDiscount = Math.min(Math.max(finalDiscount, 0), subtotal);

  let taxAmount = 0;
  let total = 0;

  if (roundingMode === "line" && subtotal > 0) {
    // Proportional per-line discount, rounded per line
    let distributed = 0;
    const lineDiscounts = lineGrosses.map((g, idx) => {
      if (idx === lineGrosses.length - 1) {
        return r2(finalDiscount - distributed);
      }
      const d = r2(finalDiscount * (g / subtotal));
      distributed += d;
      return d;
    });

    let sumTax = 0,
      sumTotal = 0;
    for (let i = 0; i < lineGrosses.length; i++) {
      const afterDiscount = Math.max(
        0,
        lineGrosses[i] - (lineDiscounts[i] || 0),
      );
      if (pricesIncludeTax) {
        const net = rate > 0 ? afterDiscount / (1 + rate) : afterDiscount;
        sumTax += r2(afterDiscount - net);
        sumTotal += r2(afterDiscount);
      } else {
        const tax = r2(afterDiscount * rate);
        sumTax += tax;
        sumTotal += r2(afterDiscount + tax);
      }
    }
    taxAmount = r2(sumTax);
    total = r2(sumTotal);
  } else {
    // Total rounding mode
    const afterDiscount = subtotal - finalDiscount;
    if (pricesIncludeTax) {
      const net = rate > 0 ? afterDiscount / (1 + rate) : afterDiscount;
      taxAmount = r2(afterDiscount - net);
      total = r2(afterDiscount);
    } else {
      taxAmount = r2(afterDiscount * rate);
      total = r2(afterDiscount + taxAmount);
    }
  }

  return {
    subtotal: r2(subtotal),
    discountAmount: r2(finalDiscount),
    taxAmount,
    total,
  };
}
