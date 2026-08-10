const EAN_L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const EAN_G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const EAN_R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];
const CODE128_PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

function digitsOnly(value: unknown): string {
  return String(value ?? "").trim().replace(/\D/g, "");
}

export function ean13CheckDigit(first12: string): number {
  const digits = digitsOnly(first12).slice(0, 12).padStart(12, "0");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: unknown): boolean {
  const digits = digitsOnly(value);
  return digits.length === 13 &&
    Number(digits[12]) === ean13CheckDigit(digits.slice(0, 12));
}

/** Generate a retail-scannable internal EAN-13 barcode with the 200 prefix. */
export function generateInternalEan13(): string {
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  const body = `${200}${String(random[0]).padStart(10, "0")}${
    String(random[1])
  }`.replace(/\D/g, "").slice(-9);
  const first12 = `200${body}`.slice(0, 12).padStart(12, "0");
  return `${first12}${ean13CheckDigit(first12)}`;
}

function escapeSvgText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (
      char,
    ) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char] || char),
  );
}

function renderBars(
  pattern: string,
  label: string,
  width = 2,
  height = 80,
): string {
  const quiet = 10;
  const textHeight = 20;
  const svgWidth = pattern.length * width + quiet * 2;
  const rects: string[] = [];
  let x = quiet;
  for (const bit of pattern) {
    if (bit === "1") {
      rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}"/>`);
    }
    x += width;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Barcode ${
    escapeSvgText(label)
  }" viewBox="0 0 ${svgWidth} ${
    height + textHeight
  }" width="${svgWidth}" height="${
    height + textHeight
  }" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><g fill="black">${
    rects.join("")
  }</g><text x="${svgWidth / 2}" y="${
    height + 15
  }" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" letter-spacing="1">${
    escapeSvgText(label)
  }</text></svg>`;
}

/** Render an EAN-13 barcode as crisp, print-friendly SVG. */
export function ean13ToSvg(
  value: unknown,
  options: { width?: number; height?: number } = {},
): string {
  const digits = digitsOnly(value);
  if (!isValidEan13(digits)) return "";
  const parity = PARITY[Number(digits[0])];
  const bars = ["101"];
  for (let i = 1; i <= 6; i++) {
    bars.push(
      parity[i - 1] === "L"
        ? EAN_L[Number(digits[i])]
        : EAN_G[Number(digits[i])],
    );
  }
  bars.push("01010");
  for (let i = 7; i <= 12; i++) bars.push(EAN_R[Number(digits[i])]);
  bars.push("101");
  return renderBars(
    bars.join(""),
    digits,
    options.width || 2,
    options.height || 80,
  );
}

/** Render printable Code 128-B for supplied alphanumeric product identifiers. */
export function code128ToSvg(
  value: unknown,
  options: { width?: number; height?: number } = {},
): string {
  const text = String(value ?? "").trim();
  if (!text || !/^[\x20-\x7E]+$/.test(text)) return "";
  const codes = Array.from(text, (char) => char.charCodeAt(0) - 32);
  let checksum = 104;
  codes.forEach((code, index) => checksum += code * (index + 1));
  const pattern = [
    CODE128_PATTERNS[104],
    ...codes.map((code) => CODE128_PATTERNS[code]),
    CODE128_PATTERNS[checksum % 103],
    CODE128_PATTERNS[106],
  ].join("");
  return renderBars(pattern, text, options.width || 2, options.height || 80);
}

export function barcodeToSvg(
  value: unknown,
  options: { width?: number; height?: number } = {},
): string {
  return isValidEan13(value)
    ? ean13ToSvg(value, options)
    : code128ToSvg(value, options);
}
