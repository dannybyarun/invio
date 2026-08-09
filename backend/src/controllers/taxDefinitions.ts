// @ts-nocheck: keep controller consistent with existing loose typing in routes
import { getDatabase } from "../database/init.ts";
import { TaxDefinition } from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";

function toNullableTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function toOptionalTrimmed(value: unknown): string | undefined {
  const v = toNullableTrimmed(value);
  return v ?? undefined;
}

function toOptionalUpper2(value: unknown): string | undefined {
  const v = toNullableTrimmed(value);
  if (!v) return undefined;
  return v.toUpperCase();
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  const truthy = new Set(["1", "true", "yes", "y", "on"]);
  const falsy = new Set(["0", "false", "no", "n", "off"]);
  if (truthy.has(s)) return true;
  if (falsy.has(s)) return false;
  return undefined;
}

function toRequiredPercent(value: unknown): number {
  const raw = typeof value === "number" ? String(value) : String(value ?? "");
  const n = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("Tax percent must be a number");
  if (n < 0) throw new Error("Tax percent must be >= 0");
  return n;
}

function mapRowToTaxDefinition(row: unknown[]): TaxDefinition {
  return {
    id: row[0] as string,
    code: (row[1] ?? undefined) as string | undefined,
    name: (row[2] ?? undefined) as string | undefined,
    percent: Number(row[3] as unknown),
    categoryCode: (row[4] ?? undefined) as string | undefined,
    countryCode: (row[5] ?? undefined) as string | undefined,
    vendorSpecificId: (row[6] ?? undefined) as string | undefined,
    defaultIncluded: row[7] === null || row[7] === undefined
      ? undefined
      : Boolean(row[7]),
    metadata: (row[8] ?? undefined) as string | undefined,
  };
}

export function getTaxDefinitions(): TaxDefinition[] {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, code, name, percent, category_code, country_code, vendor_specific_id, default_included, metadata FROM tax_definitions ORDER BY created_at DESC",
  ) as unknown[][];
  return rows.map(mapRowToTaxDefinition);
}

export function getTaxDefinitionById(id: string): TaxDefinition | null {
  const db = getDatabase();
  const rows = db.query(
    "SELECT id, code, name, percent, category_code, country_code, vendor_specific_id, default_included, metadata FROM tax_definitions WHERE id = ?",
    [id],
  ) as unknown[][];
  if (rows.length === 0) return null;
  return mapRowToTaxDefinition(rows[0] as unknown[]);
}

export function createTaxDefinition(
  data: Record<string, unknown>,
): TaxDefinition {
  const db = getDatabase();

  const id = generateUUID();
  const code = toNullableTrimmed(data.code);
  const name = toNullableTrimmed(data.name);
  const percent = toRequiredPercent(data.percent);

  if (!code) throw new Error("Tax code is required");
  if (!name) throw new Error("Tax name is required");

  const categoryCode = toOptionalTrimmed(data.categoryCode);
  const countryCode = toOptionalUpper2(data.countryCode);
  const vendorSpecificId = toOptionalTrimmed(data.vendorSpecificId);
  const defaultIncluded = toOptionalBoolean(data.defaultIncluded);
  const metadata = toOptionalTrimmed(data.metadata);
  const now = new Date();

  db.query(
    `INSERT INTO tax_definitions (
      id, code, name, percent, category_code, country_code, vendor_specific_id, default_included, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      code,
      name,
      percent,
      categoryCode ?? null,
      countryCode ?? null,
      vendorSpecificId ?? null,
      defaultIncluded === undefined ? null : (defaultIncluded ? 1 : 0),
      metadata ?? null,
      now,
      now,
    ],
  );

  return {
    id,
    code,
    name,
    percent,
    categoryCode,
    countryCode,
    vendorSpecificId,
    defaultIncluded,
    metadata,
  };
}

export function updateTaxDefinition(
  id: string,
  data: Record<string, unknown>,
): TaxDefinition {
  const db = getDatabase();

  const existing = getTaxDefinitionById(id);
  if (!existing) throw new Error("NOT_FOUND");

  const code = toNullableTrimmed(data.code);
  const name = toNullableTrimmed(data.name);
  const percent = toRequiredPercent(data.percent);

  if (!code) throw new Error("Tax code is required");
  if (!name) throw new Error("Tax name is required");

  const categoryCode = toOptionalTrimmed(data.categoryCode);
  const countryCode = toOptionalUpper2(data.countryCode);
  const vendorSpecificId = toOptionalTrimmed(data.vendorSpecificId);
  const defaultIncluded = toOptionalBoolean(data.defaultIncluded);
  const metadata = toOptionalTrimmed(data.metadata);
  const now = new Date();

  db.query(
    `UPDATE tax_definitions
       SET code = ?, name = ?, percent = ?, category_code = ?, country_code = ?, vendor_specific_id = ?, default_included = ?, metadata = ?, updated_at = ?
     WHERE id = ?`,
    [
      code,
      name,
      percent,
      categoryCode ?? null,
      countryCode ?? null,
      vendorSpecificId ?? null,
      defaultIncluded === undefined ? null : (defaultIncluded ? 1 : 0),
      metadata ?? null,
      now,
      id,
    ],
  );

  return {
    id,
    code,
    name,
    percent,
    categoryCode,
    countryCode,
    vendorSpecificId,
    defaultIncluded,
    metadata,
  };
}

export function deleteTaxDefinition(id: string): { id: string } {
  const db = getDatabase();
  const existing = getTaxDefinitionById(id);
  if (!existing) throw new Error("NOT_FOUND");

  // A tax definition still referenced by products or saved invoice tax rows
  // cannot be hard-deleted: those tables keep a foreign key to
  // tax_definitions(id) with no ON DELETE action, so a raw delete would fail
  // with an opaque "FOREIGN KEY constraint failed" error. Report usage up
  // front so the operator can detach the tax first.
  const count = (sql: string): number => {
    const rows = db.query(sql, [id]) as unknown[][];
    return Number(rows[0]?.[0] ?? 0);
  };
  const productCount = count(
    "SELECT COUNT(*) FROM products WHERE tax_definition_id = ?",
  );
  const invoiceCount = count(
    "SELECT COUNT(*) FROM invoice_taxes WHERE tax_definition_id = ?",
  );
  const itemCount = count(
    "SELECT COUNT(*) FROM invoice_item_taxes WHERE tax_definition_id = ?",
  );

  if (productCount > 0 || invoiceCount > 0 || itemCount > 0) {
    const usage: string[] = [];
    if (productCount > 0) usage.push(`${productCount} product(s)`);
    if (invoiceCount > 0) usage.push(`${invoiceCount} invoice(s)`);
    if (itemCount > 0) usage.push(`${itemCount} invoice line item(s)`);
    throw new Error(
      `Cannot delete tax definition "${existing.code}": it is still used by ${
        usage.join(", ")
      }. Remove it from those records first.`,
    );
  }

  db.query("DELETE FROM tax_definitions WHERE id = ?", [id]);
  return { id };
}
