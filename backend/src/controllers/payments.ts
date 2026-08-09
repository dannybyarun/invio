/**
 * Payments / Statement / Reminders Controller
 * - Manual (partial) payments recorded against an invoice
 * - Per-customer statement with running balance
 * - Payment reminder emails (dunning)
 */
import { getDatabase } from "../database/init.ts";
import { getSetting } from "./settings.ts";
import { getInvoiceById } from "./invoices.ts";
import { getCustomerById } from "./customers.ts";
import {
  AddPaymentRequest,
  CustomerStatement,
  InvoicePayment,
  StatementEntry,
} from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";
import { isEmailConfigured, sendEmail } from "../utils/email.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

function recordStatusChange(
  invoiceId: string,
  status: string,
  paymentMethod?: string,
  note?: string,
): void {
  const db = getDatabase();
  db.query(
    `INSERT INTO invoice_status_history (id, invoice_id, status, changed_at, payment_method, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      generateUUID(),
      invoiceId,
      status,
      new Date().toISOString(),
      paymentMethod ?? null,
      note ?? null,
    ],
  );
}

export function getManualPayments(invoiceId: string): InvoicePayment[] {
  const db = getDatabase();
  const rows = db.query(
    `SELECT id, invoice_id, amount, method, reference, note, paid_at, created_at
     FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC`,
    [invoiceId],
  ) as unknown[][];
  return rows.map((row) => ({
    id: String(row[0]),
    invoiceId: String(row[1]),
    amount: Number(row[2]),
    method: row[3] ? String(row[3]) : undefined,
    reference: row[4] ? String(row[4]) : undefined,
    note: row[5] ? String(row[5]) : undefined,
    paidAt: new Date(String(row[6])),
    createdAt: new Date(String(row[7])),
    source: "manual" as const,
  }));
}

/** Record a manual/partial payment. Auto-marks the invoice paid when fully settled. */
export async function addManualPayment(
  invoiceId: string,
  data: AddPaymentRequest,
): Promise<ReturnType<typeof getInvoiceById>> {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "voided") {
    throw new Error("Voided invoices cannot receive payments");
  }
  if (invoice.status === "draft") {
    throw new Error("Issue the invoice before recording payments");
  }

  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  if (amount <= 0) throw new Error("Payment amount must be greater than zero");

  const paidAt = String(data.paidAt || new Date().toISOString().slice(0, 10));
  const db = getDatabase();

  // Server-side overpayment guard: amount must not exceed the outstanding
  // balance (total − already paid − credit notes applied).
  const summaryBefore = db.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = ?), 0) +
       COALESCE((SELECT SUM(amount) FROM payment_transactions WHERE invoice_id = ?), 0)`,
    [invoiceId, invoiceId],
  ) as unknown[][];
  const creditedBeforeRows = db.query(
    "SELECT COALESCE(SUM(total), 0) FROM credit_notes WHERE invoice_id = ? AND status = 'issued'",
    [invoiceId],
  ) as unknown[][];
  const paidBefore = Number(summaryBefore[0]?.[0]) || 0;
  const creditedBefore = Number(creditedBeforeRows[0]?.[0]) || 0;
  const due = r2((invoice.total || 0) - paidBefore - creditedBefore);
  if (amount > due + 0.01) {
    throw new Error("Payment amount exceeds the outstanding balance");
  }

  db.execute("BEGIN");
  try {
    db.query(
      `INSERT INTO invoice_payments (id, invoice_id, amount, method, reference, note, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateUUID(),
        invoiceId,
        amount,
        data.method ? String(data.method).trim() : null,
        data.reference ? String(data.reference).trim() : null,
        data.note ? String(data.note).trim() : null,
        paidAt,
        new Date().toISOString(),
      ],
    );

    const summary = db.query(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = ?), 0) +
         COALESCE((SELECT SUM(amount) FROM payment_transactions WHERE invoice_id = ?), 0)`,
      [invoiceId, invoiceId],
    ) as unknown[][];
    const creditedRows = db.query(
      "SELECT COALESCE(SUM(total), 0) FROM credit_notes WHERE invoice_id = ? AND status = 'issued'",
      [invoiceId],
    ) as unknown[][];
    const paid = Number(summary[0]?.[0]) || 0;
    const credited = Number(creditedRows[0]?.[0]) || 0;

    const fullyPaid = paid + credited >= (invoice.total || 0);
    if (fullyPaid && invoice.status !== "paid") {
      db.query(
        "UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ?",
        [new Date().toISOString(), invoiceId],
      );
      recordStatusChange(
        invoiceId,
        "paid",
        data.method,
        "Paid via manual payment",
      );
    } else {
      recordStatusChange(
        invoiceId,
        invoice.status,
        data.method,
        `Partial payment of ${amount} recorded`,
      );
    }
    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  return await getInvoiceById(invoiceId);
}

export function deleteManualPayment(paymentId: string): boolean {
  const db = getDatabase();
  const rows = db.query(
    "SELECT invoice_id, amount FROM invoice_payments WHERE id = ?",
    [paymentId],
  ) as unknown[][];
  if (rows.length === 0) throw new Error("Payment not found");
  const invoiceId = String(rows[0][0]);
  db.query("DELETE FROM invoice_payments WHERE id = ?", [paymentId]);
  // Re-derive status: revert 'paid' to 'complete' if no longer fully paid.
  const invoice = getInvoiceById(invoiceId);
  if (invoice && invoice.status === "paid" && (invoice.amountDue ?? 0) > 0) {
    // No longer fully paid — fall back to sent (or overdue if past due).
    const isOverdue = invoice.dueDate
      ? new Date(String(invoice.dueDate).slice(0, 10) + "T00:00:00") <
        new Date()
      : false;
    const nextStatus = isOverdue ? "overdue" : "sent";
    db.query(
      "UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?",
      [nextStatus, new Date().toISOString(), invoiceId],
    );
    recordStatusChange(invoiceId, nextStatus, undefined, "Payment removed");
  }
  return true;
}

export function getCustomerStatement(
  customerId: string,
): CustomerStatement | null {
  const customer = getCustomerById(customerId);
  if (!customer) return null;

  const db = getDatabase();
  const rows = db.query(
    `SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.status, i.total,
            COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) +
            COALESCE((SELECT SUM(t.amount) FROM payment_transactions t WHERE t.invoice_id = i.id), 0) AS paid,
            COALESCE((SELECT SUM(cn.total) FROM credit_notes cn WHERE cn.invoice_id = i.id AND cn.status = 'issued'), 0) AS credited
     FROM invoices i
     WHERE i.customer_id = ? AND i.status != 'draft'
     ORDER BY i.issue_date ASC, i.created_at ASC`,
    [customerId],
  ) as unknown[][];

  const entries: StatementEntry[] = [];
  let running = 0;
  let totalBilled = 0;
  let totalPaid = 0;
  let totalCredited = 0;

  for (const row of rows) {
    const total = Number(row[5]) || 0;
    const paid = Number(row[6]) || 0;
    const credited = Number(row[7]) || 0;
    const status = String(row[4]);
    if (status === "voided") continue;
    const balance = r2(total - paid - credited);
    running = r2(running + balance);
    totalBilled = r2(totalBilled + total);
    totalPaid = r2(totalPaid + paid);
    totalCredited = r2(totalCredited + credited);
    entries.push({
      invoiceId: String(row[0]),
      invoiceNumber: String(row[1]),
      issueDate: String(row[2]),
      dueDate: row[3] ? String(row[3]) : undefined,
      status,
      total,
      paid,
      credited,
      balance: running,
    });
  }

  return {
    customerId,
    customerName: customer.name,
    entries,
    totalBilled,
    totalPaid,
    totalCredited,
    outstanding: running,
  };
}

/** Send a payment reminder email for an invoice (dunning). */
export async function sendPaymentReminder(
  invoiceId: string,
  publicBaseUrl: string,
): Promise<{ success: boolean; emailed: boolean; reason?: string }> {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) throw new Error("Invoice not found");
  if (!invoice.customer?.email) {
    return {
      success: false,
      emailed: false,
      reason: "Customer has no email address",
    };
  }
  if (invoice.status === "paid" || invoice.status === "voided") {
    return {
      success: false,
      emailed: false,
      reason: `Invoice is ${invoice.status}`,
    };
  }
  if (!isEmailConfigured()) {
    return {
      success: false,
      emailed: false,
      reason: "Email is not configured (set SMTP_HOST / EMAIL_FROM_ADDRESS)",
    };
  }

  const companyName = getSetting("companyName") || "Your Company";
  const link = `${
    publicBaseUrl.replace(/\/+$/, "")
  }/public/invoices/${invoice.shareToken}`;
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: invoice.currency,
  }).format(invoice.amountDue ?? invoice.total);

  await sendEmail({
    to: [invoice.customer.email],
    subject:
      `Payment reminder for ${invoice.invoiceNumber} from ${companyName}`,
    htmlBody: `<p>Dear ${invoice.customer.name},</p>` +
      `<p>This is a reminder that invoice <strong>${invoice.invoiceNumber}</strong> ` +
      `for <strong>${amount}</strong> (due ${
        invoice.dueDate
          ? new Date(invoice.dueDate).toLocaleDateString()
          : "immediately"
      }) is still outstanding.</p>` +
      `<p>You can view and pay your invoice here: <a href="${link}">${link}</a></p>` +
      `<p>Thank you for your business.</p><p>${companyName}</p>`,
    textBody: `Dear ${invoice.customer.name},\n\n` +
      `This is a reminder that invoice ${invoice.invoiceNumber} for ${amount} is still outstanding.\n` +
      `View and pay: ${link}\n\nThank you,\n${companyName}`,
  });

  const db = getDatabase();
  db.query(
    `INSERT INTO invoice_status_history (id, invoice_id, status, changed_at, payment_method, note)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [
      generateUUID(),
      invoiceId,
      invoice.status,
      new Date().toISOString(),
      "Payment reminder sent",
    ],
  );
  return { success: true, emailed: true };
}

export async function bulkSendReminders(
  invoiceIds: string[],
  publicBaseUrl: string,
): Promise<{ sent: number; skipped: string[] }> {
  const skipped: string[] = [];
  let sent = 0;
  for (const id of invoiceIds) {
    try {
      const result = await sendPaymentReminder(id, publicBaseUrl);
      if (result.emailed) sent++;
      else skipped.push(id);
    } catch {
      skipped.push(id);
    }
  }
  return { sent, skipped };
}
