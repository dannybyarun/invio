<script lang="ts">
  import { getContext } from "svelte";
  import { Trash2 } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import { hasPermission } from "$lib/types";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canUpdate = $derived(hasPermission(user, "suppliers", "update"));
  let canDelete = $derived(hasPermission(user, "suppliers", "delete"));
  let s = $derived(data.supplier);
</script>

{#if form?.error || data.error}
  <div class="alert alert-error mb-4"><span>{form?.error || data.error}</span></div>
{/if}
{#if form?.saved}
  <div class="alert alert-success mb-4"><span>{t("Saved")}</span></div>
{/if}

{#if s}
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">{s.name}</h1>
    <a href="/suppliers" class="btn btn-sm btn-ghost">← {t("Suppliers")}</a>
  </div>

  <form method="POST" action="?/update" use:enhance class="card bg-base-100 border-base-300 max-w-2xl space-y-4 border p-6">
    <label class="form-control">
      <span class="label-text mb-1">{t("Name")} <span class="text-error">*</span></span>
      <input name="name" class="input input-bordered" value={s.name} required />
    </label>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label class="form-control"><span class="label-text mb-1">{t("Contact Name")}</span><input name="contactName" class="input input-bordered" value={s.contactName || ""} /></label>
      <label class="form-control"><span class="label-text mb-1">{t("Email")}</span><input name="email" type="email" class="input input-bordered" value={s.email || ""} /></label>
      <label class="form-control"><span class="label-text mb-1">{t("Phone")}</span><input name="phone" class="input input-bordered" value={s.phone || ""} /></label>
      <label class="form-control"><span class="label-text mb-1">{t("Tax ID")}</span><input name="taxId" class="input input-bordered" value={s.taxId || ""} /></label>
    </div>
    <label class="form-control"><span class="label-text mb-1">{t("Address")}</span><input name="address" class="input input-bordered" value={s.address || ""} /></label>
    <label class="form-control"><span class="label-text mb-1">{t("Notes")}</span><textarea name="notes" class="textarea textarea-bordered h-24">{s.notes || ""}</textarea></label>
    <div class="flex justify-end gap-2">
      {#if canUpdate}
        <button type="submit" class="btn btn-primary btn-sm">{t("Save")}</button>
      {/if}
    </div>
  </form>
  {#if canDelete}
    <form method="POST" action="?/delete" use:enhance class="mt-3 flex justify-end">
      <button type="submit" class="btn btn-sm btn-error" onclick={() => confirm(t("Delete this supplier?"))}>
        <Trash2 size={16} />
        {t("Delete")}
      </button>
    </form>
  {/if}
{/if}
