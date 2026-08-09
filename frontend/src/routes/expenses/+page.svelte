<script lang="ts">
  import { getContext } from "svelte";
  import { Plus, Trash2, Wallet } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { hasPermission } from "$lib/types";
  import { numberFormatLocale } from "$lib/utils/dates";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canCreate = $derived(hasPermission(user, "expenses", "create"));
  let canDelete = $derived(hasPermission(user, "expenses", "delete"));
  let expenses = $derived(data.expenses || []);
  let suppliers = $derived(data.suppliers || []);

  let currency = $derived(
    String(data.settings?.currency || "USD")
      .trim()
      .toUpperCase(),
  );
  let totalAmount = $derived(expenses.reduce((sum, e) => sum + (Number(e.amount) || 0) + (Number(e.taxAmount) || 0), 0));

  function fmtMoney(n: number) {
    try {
      return new Intl.NumberFormat(numberFormatLocale(data.localization?.locale, data.localization?.numberFormat), {
        style: "currency",
        currency,
      }).format(n || 0);
    } catch {
      return `${currency} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function supplierName(id?: string) {
    return suppliers.find((s) => s.id === id)?.name || "—";
  }
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
  <div>
    <h1 class="text-2xl font-semibold">{t("Expenses")}</h1>
    <p class="text-sm opacity-60">{t("Total")}: <span class="font-semibold">{fmtMoney(totalAmount)}</span></p>
  </div>
  {#if canCreate}
    <button class="btn btn-primary btn-sm" onclick={() => (document.getElementById("expense-dialog") as HTMLDialogElement | null)?.showModal()}>
      <Plus size={16} />
      {t("New Expense")}
    </button>
  {/if}
</div>

{#if form?.error}
  <div class="alert alert-error mb-3"><span>{form.error}</span></div>
{/if}

{#if canCreate}
  <dialog id="expense-dialog" class="modal">
    <div class="modal-box max-w-lg">
      <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute top-3 right-3">✕</button></form>
      <h3 class="mb-4 text-lg font-semibold">{t("New Expense")}</h3>
      <form method="POST" action="?/create" use:enhance class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="form-control"
          ><span class="label-text mb-1">{t("Date")}</span><input name="expenseDate" type="date" class="input input-bordered" value={new Date().toISOString().slice(0, 10)} required /></label
        >
        <label class="form-control"><span class="label-text mb-1">{t("Category")}</span><input name="category" class="input input-bordered" placeholder={t("e.g. Rent, Transport")} /></label>
        <label class="form-control"
          ><span class="label-text mb-1">{t("Supplier")}</span>
          <select name="supplierId" class="select select-bordered">
            <option value="">{t("None")}</option>
            {#each suppliers as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
        <label class="form-control"
          ><span class="label-text mb-1">{t("Payment Method")}</span><input name="paymentMethod" class="input input-bordered" placeholder={t("Cash / Bank / Fonepay")} /></label
        >
        <label class="form-control"
          ><span class="label-text mb-1">{t("Amount")} <span class="text-error">*</span></span><input name="amount" type="number" min="0" step="0.01" class="input input-bordered" required /></label
        >
        <label class="form-control"><span class="label-text mb-1">{t("Tax Amount")}</span><input name="taxAmount" type="number" min="0" step="0.01" class="input input-bordered" value="0" /></label>
        <label class="form-control sm:col-span-2"><span class="label-text mb-1">{t("Description")}</span><input name="description" class="input input-bordered" /></label>
        <label class="form-control sm:col-span-2"><span class="label-text mb-1">{t("Reference")}</span><input name="reference" class="input input-bordered" /></label>
        <div class="modal-action col-span-full">
          <button type="button" class="btn btn-ghost" onclick={() => (document.getElementById("expense-dialog") as HTMLDialogElement | null)?.close()}>{t("Cancel")}</button>
          <button type="submit" class="btn btn-primary"><Wallet size={16} /> {t("Save")}</button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  </dialog>
{/if}

<div class="rounded-box bg-base-100 border-base-300 hidden overflow-x-auto border md:block">
  <table class="table-zebra table w-full text-sm">
    <thead class="bg-base-200 text-base-content">
      <tr class="font-medium">
        <th>{t("Date")}</th>
        <th>{t("Category")}</th>
        <th>{t("Supplier")}</th>
        <th>{t("Description")}</th>
        <th>{t("Payment")}</th>
        <th class="text-right">{t("Amount")}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each expenses as e (e.id)}
        <tr class="hover">
          <td>{e.expenseDate}</td>
          <td>{e.category || "—"}</td>
          <td class="opacity-70">{supplierName(e.supplierId)}</td>
          <td class="max-w-[16rem] truncate opacity-70">{e.description || "—"}</td>
          <td class="opacity-70">{e.paymentMethod || "—"}</td>
          <td class="text-right font-medium">{fmtMoney((Number(e.amount) || 0) + (Number(e.taxAmount) || 0))}</td>
          <td>
            {#if canDelete}
              <form method="POST" action="?/delete" use:enhance>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" class="btn btn-ghost btn-sm btn-square" onclick={() => confirm(t("Delete this expense?"))}><Trash2 size={15} /></button>
              </form>
            {/if}
          </td>
        </tr>
      {/each}
      {#if expenses.length === 0}
        <tr><td colspan="7" class="py-10 text-center text-sm opacity-70">{t("No expenses yet")}.</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<div class="block space-y-3 md:hidden">
  {#each expenses as e (e.id)}
    <div class="card bg-base-100 border-base-300 border">
      <div class="card-body p-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-semibold">{e.category || e.description || t("Expense")}</div>
            <div class="text-sm opacity-70">{e.expenseDate}{e.supplierId ? ` · ${supplierName(e.supplierId)}` : ""}</div>
          </div>
          <div class="font-semibold whitespace-nowrap">{fmtMoney((Number(e.amount) || 0) + (Number(e.taxAmount) || 0))}</div>
        </div>
      </div>
    </div>
  {/each}
  {#if expenses.length === 0}
    <div class="card bg-base-100 border-base-300 border"><div class="card-body py-10 text-center text-sm opacity-70">{t("No expenses yet")}.</div></div>
  {/if}
</div>
