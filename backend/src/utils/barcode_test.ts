import {
  barcodeToSvg,
  code128ToSvg,
  ean13CheckDigit,
  ean13ToSvg,
  generateInternalEan13,
  isValidEan13,
} from "./barcode.ts";

Deno.test("calculates the standard EAN-13 check digit", () => {
  if (ean13CheckDigit("400638133393") !== 1) {
    throw new Error("Expected EAN-13 check digit 1");
  }
});

Deno.test("generates valid internal EAN-13 barcodes", () => {
  const values = new Set<string>();
  for (let i = 0; i < 25; i++) {
    const barcode = generateInternalEan13();
    if (!isValidEan13(barcode) || !barcode.startsWith("200")) {
      throw new Error(`Invalid generated barcode: ${barcode}`);
    }
    values.add(barcode);
  }
  if (values.size < 20) {
    throw new Error("Generated barcodes are not varied enough");
  }
});

Deno.test("renders EAN-13 and Code 128 as crisp printable SVG", () => {
  const ean = ean13ToSvg("4006381333931");
  if (
    !ean.includes("4006381333931") ||
    !ean.includes('shape-rendering="crispEdges"')
  ) {
    throw new Error("Expected a crisp EAN-13 SVG barcode");
  }
  const code128 = code128ToSvg("SKU-ABC-01");
  if (
    !code128.includes("SKU-ABC-01") ||
    !code128.includes('shape-rendering="crispEdges"')
  ) {
    throw new Error("Expected a crisp Code 128 SVG barcode");
  }
  if (barcodeToSvg("not-a-barcode") === "") {
    throw new Error("Expected Code 128 fallback");
  }
  if (ean13ToSvg("not-a-barcode") !== "") {
    throw new Error("Invalid EAN should not render as EAN");
  }
});
