-- Drop existing tables to recreate with new schema
DROP TABLE IF EXISTS invoice_status_history;
DROP TABLE IF EXISTS invoice_item_taxes;
DROP TABLE IF EXISTS invoice_taxes;
DROP TABLE IF EXISTS fonepay_qr_payloads;
DROP TABLE IF EXISTS payment_transactions;
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS invoice_attachments;

-- Business/Seller information (stored in settings)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Enhanced customers table
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  country_code TEXT,
  tax_id TEXT,
  customer_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced invoices table
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  issue_date DATE NOT NULL,
  due_date DATE,
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK(status IN ('draft', 'sent', 'complete', 'paid', 'overdue', 'voided')) DEFAULT 'draft',
  
  -- Totals
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  discount_percentage NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL,
  
  -- Payment and notes
  payment_terms TEXT,
  notes TEXT,
  payment_method TEXT,
  fonepay_qr_type TEXT,
  fonepay_qr_data TEXT,
  fonepay_bill_id TEXT,
  fonepay_qr_amount NUMERIC,
  fonepay_transaction_id TEXT,
  fonepay_verified_at TEXT,
  
  -- System fields
  share_token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  prices_include_tax BOOLEAN DEFAULT 0,
  rounding_mode TEXT DEFAULT 'line'
);

CREATE TABLE fonepay_qr_payloads (
  invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  qr_message TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  bill_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE payment_transactions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_transaction_id TEXT NOT NULL,
  provider_reference TEXT,
  amount NUMERIC NOT NULL,
  verified_at TEXT NOT NULL,
  UNIQUE(provider, provider_transaction_id),
  UNIQUE(invoice_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice ON payment_transactions(invoice_id, verified_at);

-- Enhanced invoice items table
CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT,
  unit_price NUMERIC NOT NULL,
  line_total NUMERIC NOT NULL,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  product_id TEXT REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS invoice_item_taxes (
  id TEXT PRIMARY KEY,
  invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
  tax_definition_id TEXT,
  percent NUMERIC NOT NULL,
  taxable_amount NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  included BOOLEAN NOT NULL DEFAULT 0,
  sequence INTEGER DEFAULT 0,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_taxes (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tax_definition_id TEXT,
  percent NUMERIC NOT NULL,
  taxable_amount NUMERIC NOT NULL,
  tax_amount NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invoice_status_history (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  payment_method TEXT,
  note TEXT
);

-- Invoice attachments (optional)
CREATE TABLE invoice_attachments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Templates table
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  html TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  template_type TEXT DEFAULT 'builtin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default business settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('companyName', 'Your Company'),
  ('companyAddress', '123 Business St, City, State 12345'),
  ('companyEmail', 'contact@yourcompany.com'),
  ('companyPhone', '+1 (555) 123-4567'),
  ('companyTaxId', 'TAX123456789'),
  ('currency', 'USD'),
  ('logo', ''),
  ('paymentMethods', 'Bank Transfer, PayPal, Credit Card'),
  ('bankAccount', 'Account: 1234567890, Routing: 987654321'),
  ('paymentTerms', 'Due in 30 days'),
  ('defaultNotes', 'Thank you for your business!'),
  ('allowProtectedInvoiceChanges', 'false');

-- Insert a simple default template
INSERT OR IGNORE INTO templates (id, name, html, is_default) VALUES 
('default-template', 'Default Invoice Template', '<h1>Invoice #{{invoiceNumber}}</h1><p>Total: {{currency}} {{total}}</p>', TRUE);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- Normalized tax schema
CREATE TABLE IF NOT EXISTS tax_definitions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT,
  percent NUMERIC NOT NULL,
  category_code TEXT,
  country_code TEXT,
  vendor_specific_id TEXT,
  default_included BOOLEAN DEFAULT 0,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Multi-user system: users & permissions
-- Products and lookup identifiers
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  sku TEXT,
  barcode TEXT,
  unit TEXT DEFAULT 'piece',
  category TEXT,
  tax_definition_id TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique ON products(sku COLLATE NOCASE) WHERE sku IS NOT NULL AND trim(sku) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(barcode COLLATE NOCASE) WHERE barcode IS NOT NULL AND trim(barcode) <> '';
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_builtin BOOLEAN DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_builtin BOOLEAN DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  two_factor_secret TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  two_factor_recovery_codes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
