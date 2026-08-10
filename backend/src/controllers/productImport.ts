import * as XLSX from "npm:xlsx@^0.18.5";
import { createProduct } from "./products.ts";
import type { CreateProductRequest, Product } from "../types/index.ts";

export const PRODUCT_IMPORT_HEADERS = [
  "Name",
  "Description",
  "Selling Price",
  "Cost Price",
  "Stock On Hand",
  "Reorder Level",
  "SKU",
  "Barcode",
  "Unit",
  "Category",
  "Tax Definition ID",
];

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 1000;

function cellText(value: unknown): string {
  return String(value ?? "").trim();
}

function numberCell(value: unknown, field: string, rowNumber: number): number {
  const text = cellText(value).replace(/,/g, "");
  if (!text) return 0;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Row ${rowNumber}: ${field} must be a non-negative number`);
  }
  return number;
}

function rowToRequest(row: unknown[], rowNumber: number): CreateProductRequest {
  const name = cellText(row[0]);
  if (!name) throw new Error(`Row ${rowNumber}: Name is required`);
  return {
    name,
    description: cellText(row[1]) || undefined,
    unitPrice: numberCell(row[2], "Selling Price", rowNumber),
    costPrice: numberCell(row[3], "Cost Price", rowNumber),
    quantityOnHand: numberCell(row[4], "Stock On Hand", rowNumber),
    reorderLevel: numberCell(row[5], "Reorder Level", rowNumber),
    sku: cellText(row[6]) || undefined,
    barcode: cellText(row[7]) || undefined,
    unit: cellText(row[8]) || undefined,
    category: cellText(row[9]) || undefined,
    taxDefinitionId: cellText(row[10]) || undefined,
  };
}

function workbookRows(bytes: Uint8Array): unknown[][] {
  if (bytes.byteLength === 0) throw new Error("Empty workbook upload");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Workbook is too large (maximum 10 MB)");
  }
  const workbook = XLSX.read(bytes, { type: "array", cellFormula: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheet");
  const sheet = workbook.Sheets[sheetName];
  const range = sheet["!ref"];
  if (!range) throw new Error("Worksheet is empty");

  // Reject formulas before conversion. Importing calculated results can hide
  // unexpected spreadsheet logic and is unnecessary for product master data.
  for (
    const address of (() => {
      const decoded = XLSX.utils.decode_range(range);
      const addresses: string[] = [];
      for (let r = decoded.s.r; r <= decoded.e.r; r++) {
        for (let c = decoded.s.c; c <= decoded.e.c; c++) {
          addresses.push(XLSX.utils.encode_cell({ r, c }));
        }
      }
      return addresses;
    })()
  ) {
    if (sheet[address]?.f) {
      throw new Error(
        `Formula found in cell ${address}; remove formulas and upload values only`,
      );
    }
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];
  if (rows.length < 2) {
    throw new Error("Add at least one product row below the header");
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new Error(`Workbook has too many rows (maximum ${MAX_ROWS})`);
  }
  const header = rows[0].map(cellText);
  const expected = PRODUCT_IMPORT_HEADERS.map((value) => value.toLowerCase());
  if (
    header.length < expected.length ||
    expected.some((value, index) => header[index]?.toLowerCase() !== value)
  ) {
    throw new Error(
      `Invalid header. Download the product import template and keep its column order unchanged.`,
    );
  }
  return rows.slice(1).filter((row) => row.some((value) => cellText(value)));
}

export function validateProductWorkbook(bytes: Uint8Array): void {
  workbookRows(bytes);
}

export function productImportTemplate(): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet([PRODUCT_IMPORT_HEADERS]);
  worksheet["!cols"] = PRODUCT_IMPORT_HEADERS.map(() => ({ wch: 18 }));
  worksheet["!autofilter"] = { ref: `A1:K1` };
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Product import instructions"],
    ["Fill the Products sheet and keep the header row unchanged."],
    ["Format the Barcode column as Text before entering values so leading-zero EANs are preserved."],
    ["Leave Barcode blank to generate an internal EAN-13 automatically."],
    ["Selling Price, Cost Price, Stock On Hand, and Reorder Level must be non-negative numbers."],
  ]);
  instructions["!cols"] = [{ wch: 110 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  return new Uint8Array(
    XLSX.write(workbook, { type: "array", bookType: "xlsx" }),
  );
}

export type ProductImportResult = {
  created: Product[];
  errors: Array<{ row: number; message: string }>;
};

export function importProductsFromWorkbook(
  bytes: Uint8Array,
): ProductImportResult {
  const rows = workbookRows(bytes);
  const created: Product[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      created.push(createProduct(rowToRequest(row, rowNumber)));
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { created, errors };
}
