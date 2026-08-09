<script lang="ts">
  import { getContext } from "svelte";
  import { enhance } from "$app/forms";

  let { form } = $props();
  let t = getContext("i18n") as (key: string) => string;
</script>

<div class="mx-auto max-w-2xl">
  <h1 class="mb-4 text-2xl font-semibold">{t("New Supplier")}</h1>
  {#if form?.error}
    <div class="alert alert-error mb-3"><span>{form.error}</span></div>
  {/if}
  <form method="POST" use:enhance class="card bg-base-100 border-base-300 space-y-4 border p-6">
    <label class="form-control">
      <span class="label-text mb-1">{t("Name")} <span class="text-error">*</span></span>
      <input name="name" class="input input-bordered" required />
    </label>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label class="form-control">
        <span class="label-text mb-1">{t("Contact Name")}</span>
        <input name="contactName" class="input input-bordered" />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Email")}</span>
        <input name="email" type="email" class="input input-bordered" />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Phone")}</span>
        <input name="phone" class="input input-bordered" />
      </label>
      <label class="form-control">
        <span class="label-text mb-1">{t("Tax ID")}</span>
        <input name="taxId" class="input input-bordered" />
      </label>
    </div>
    <label class="form-control">
      <span class="label-text mb-1">{t("Address")}</span>
      <input name="address" class="input input-bordered" />
    </label>
    <label class="form-control">
      <span class="label-text mb-1">{t("Notes")}</span>
      <textarea name="notes" class="textarea textarea-bordered h-24"></textarea>
    </label>
    <div class="flex justify-end gap-2">
      <a href="/suppliers" class="btn btn-ghost">{t("Cancel")}</a>
      <button type="submit" class="btn btn-primary">{t("Save")}</button>
    </div>
  </form>
</div>
