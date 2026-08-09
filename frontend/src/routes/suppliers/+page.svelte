<script lang="ts">
  import { getContext } from "svelte";
  import { Plus, UserPlus } from "lucide-svelte";
  import { hasPermission } from "$lib/types";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canCreate = $derived(hasPermission(user, "suppliers", "create"));
  let suppliers = $derived(data.suppliers || []);
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Suppliers")}</h1>
  {#if canCreate}
    <a href="/suppliers/new" class="btn btn-primary btn-sm w-full sm:w-auto">
      <Plus size={16} />
      {t("New Supplier")}
    </a>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-3"><span>{data.error}</span></div>
{/if}

<div class="block space-y-3 md:hidden">
  {#each suppliers as s (s.id)}
    <a href={`/suppliers/${s.id}`} class="card bg-base-100 border-base-300 border">
      <div class="card-body p-4">
        <div class="font-semibold">{s.name}</div>
        <div class="text-sm opacity-70">{s.phone || s.email || s.address || "—"}</div>
      </div>
    </a>
  {/each}
  {#if suppliers.length === 0}
    <div class="card bg-base-100 border-base-300 border">
      <div class="card-body py-10 text-center text-sm opacity-70">
        <span class="inline-flex items-center gap-2"><UserPlus size={16} />{t("No suppliers yet")}.</span>
      </div>
    </div>
  {/if}
</div>

<div class="rounded-box bg-base-100 border-base-300 hidden overflow-x-auto border md:block">
  <table class="table-zebra table w-full text-sm">
    <thead class="bg-base-200 text-base-content">
      <tr class="font-medium">
        <th>{t("Name")}</th>
        <th>{t("Contact Name")}</th>
        <th>{t("Email")}</th>
        <th>{t("Phone")}</th>
        <th>{t("Address")}</th>
      </tr>
    </thead>
    <tbody>
      {#each suppliers as s (s.id)}
        <tr class="hover">
          <td><a class="link" href={`/suppliers/${s.id}`}>{s.name}</a></td>
          <td class="opacity-70">{s.contactName || "—"}</td>
          <td class="opacity-70">{s.email || "—"}</td>
          <td class="opacity-70">{s.phone || "—"}</td>
          <td class="max-w-[16rem] truncate opacity-70">{s.address || "—"}</td>
        </tr>
      {/each}
      {#if suppliers.length === 0}
        <tr><td colspan="5" class="py-10 text-center text-sm opacity-70">{t("No suppliers yet")}.</td></tr>
      {/if}
    </tbody>
  </table>
</div>
