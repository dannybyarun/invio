import {
  findMatchingFonepayTransaction,
  fonepayTransactionAmount,
  fonepayTransactionId,
} from "./fonepay.ts";

Deno.test("matches a settled Fonepay transaction by bill reference and amount", () => {
  const row = {
    billId: "INV-2026-001",
    transactionAmount: "1250.00",
    transactionStatus: "SUCCESS",
    transactionId: "FP-123",
  };
  const match = findMatchingFonepayTransaction([row], ["INV-2026-001"], 1250);
  if (match !== row) throw new Error("Expected the matching transaction");
  if (fonepayTransactionId(row) !== "FP-123") throw new Error("Wrong transaction ID");
  if (fonepayTransactionAmount(row) !== 1250) throw new Error("Wrong transaction amount");
});

Deno.test("does not match failed or wrong-amount transactions", () => {
  const rows = [
    {
      billId: "INV-2026-002",
      transactionAmount: 500,
      transactionStatus: "FAILED",
      transactionId: "FP-failed",
    },
    {
      billId: "INV-2026-002",
      transactionAmount: 499,
      transactionStatus: "SUCCESS",
      transactionId: "FP-wrong-amount",
    },
  ];
  const match = findMatchingFonepayTransaction(rows, ["INV-2026-002"], 500);
  if (match !== null) throw new Error("Failed or mismatched payments must not verify");
});
