<script lang="ts">
  import { getContext } from "svelte";
  import { Plus, Pencil, Trash2 } from "lucide-svelte";
  import { invalidateAll } from "$app/navigation";

  let { taxDefinitions = [] } = $props();
  let t = getContext("i18n") as (key: string, params?: any) => string;

  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let formData = $state({
    code: "",
    name: "",
    percent: "",
    countryCode: "",
  });
  let isSubmitting = $state(false);

  function handleAdd() {
    editingId = null;
    formData = { code: "", name: "", percent: "", countryCode: "" };
    showForm = true;
  }

  function handleEdit(tax: any) {
    editingId = tax.id;
    formData = {
      code: tax.code,
      name: tax.name,
      percent: String(tax.percent),
      countryCode: tax.countryCode || "",
    };
    showForm = true;
  }

  function handleCancel() {
    showForm = false;
    editingId = null;
    formData = { code: "", name: "", percent: "", countryCode: "" };
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    isSubmitting = true;
    try {
      const url = editingId ? `/api/v1/tax-definitions/${editingId}` : "/api/v1/tax-definitions";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          percent: parseFloat(formData.percent),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to save tax definition");
      }
      handleCancel();
      invalidateAll();
    } catch (err) {
      alert(err);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleDelete(tax: any) {
    if (!confirm(t("Delete tax definition confirm", { code: tax.code }))) return;
    try {
      const res = await fetch(`/api/v1/tax-definitions/${tax.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to delete tax definition");
      }
      invalidateAll();
    } catch (err) {
      alert(err);
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-semibold">{t("Tax Definitions")}</h3>
    <button type="button" onclick={handleAdd} class="btn btn-sm btn-primary">
      <Plus size={16} class="mr-1" />
      {t("Add tax")}
    </button>
  </div>

  {#if showForm}
    <form onsubmit={handleSubmit} class="card bg-base-200 space-y-3 p-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="form-control">
          <div class="label">
            <span class="label-text">{t("Tax code")} *</span>
          </div>
          <input type="text" class="input input-bordered w-full" bind:value={formData.code} placeholder={t("Tax code placeholder")} required />
        </label>
        <label class="form-control">
          <div class="label">
            <span class="label-text">{t("Display name")} *</span>
          </div>
          <input type="text" class="input input-bordered w-full" bind:value={formData.name} placeholder={t("Display name placeholder")} required />
        </label>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="form-control">
          <div class="label">
            <span class="label-text">{t("Tax Rate (%)")} *</span>
          </div>
          <input type="number" class="input input-bordered w-full" bind:value={formData.percent} step="0.01" min="0" required />
        </label>
        <label class="form-control">
          <div class="label">
            <span class="label-text">{t("Country code")}</span>
          </div>
          <input type="text" class="input input-bordered w-full" bind:value={formData.countryCode} placeholder={t("Country code placeholder")} maxlength="2" />
        </label>
      </div>

      <div class="flex gap-2">
        <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
          {editingId ? t("Update") : t("Create")}
        </button>
        <button type="button" onclick={handleCancel} class="btn btn-ghost" disabled={isSubmitting}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  {/if}

  <div class="space-y-2">
    {#if taxDefinitions.length === 0}
      <div class="text-base-content/60 py-6 text-center">
        {t("No tax definitions yet.")}
      </div>
    {:else}
      {#each taxDefinitions as tax (tax.id)}
        <div class="border-base-300 rounded-box bg-base-100 flex items-center justify-between border p-3">
          <div class="flex-1">
            <div class="font-medium">
              {tax.code} &mdash; {tax.name}
            </div>
            <div class="text-base-content/60 text-sm">
              {tax.percent}%
              {#if tax.countryCode}
                &bull; {tax.countryCode}
              {/if}
            </div>
          </div>
          <div class="flex gap-2">
            <button type="button" onclick={() => handleEdit(tax)} class="btn btn-sm btn-ghost" title={t("Edit")}>
              <Pencil size={16} />
            </button>
            <button type="button" onclick={() => handleDelete(tax)} class="btn btn-sm btn-ghost text-error" title={t("Delete")}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
