import { calculateInvoiceTotals } from "./init.ts";

Deno.test("calculates tax-exclusive totals with percentage discount", () => {
  const totals = calculateInvoiceTotals(
    [
      { quantity: 2, unitPrice: 100 },
      { quantity: 1, unitPrice: 50 },
    ],
    10,
    0,
    13,
    false,
    "total",
  );
  if (totals.subtotal !== 250) {
    throw new Error(`Unexpected subtotal: ${totals.subtotal}`);
  }
  if (totals.discountAmount !== 25) {
    throw new Error(`Unexpected discount: ${totals.discountAmount}`);
  }
  if (totals.taxAmount !== 29.25) {
    throw new Error(`Unexpected tax: ${totals.taxAmount}`);
  }
  if (totals.total !== 254.25) {
    throw new Error(`Unexpected total: ${totals.total}`);
  }
});

Deno.test("keeps tax-inclusive totals stable and separates included tax", () => {
  const totals = calculateInvoiceTotals(
    [{ quantity: 1, unitPrice: 113 }],
    0,
    0,
    13,
    true,
    "total",
  );
  if (totals.total !== 113) {
    throw new Error(`Unexpected tax-inclusive total: ${totals.total}`);
  }
  if (totals.taxAmount !== 13) {
    throw new Error(`Unexpected included tax: ${totals.taxAmount}`);
  }
});

Deno.test("line rounding distributes a discount without changing the final total", () => {
  const totals = calculateInvoiceTotals(
    [
      { quantity: 1, unitPrice: 0.99 },
      { quantity: 1, unitPrice: 0.99 },
      { quantity: 1, unitPrice: 0.99 },
    ],
    0,
    0.01,
    0,
    false,
    "line",
  );
  if (totals.subtotal !== 2.97) {
    throw new Error(`Unexpected subtotal: ${totals.subtotal}`);
  }
  if (totals.discountAmount !== 0.01) {
    throw new Error(`Unexpected discount: ${totals.discountAmount}`);
  }
  if (totals.total !== 2.96) {
    throw new Error(`Unexpected rounded total: ${totals.total}`);
  }
});
