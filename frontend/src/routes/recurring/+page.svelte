<script lang="ts">
  import { getContext } from "svelte";
  import { Play, Plus } from "lucide-svelte";
  import { hasPermission } from "$lib/types";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let user = $derived(data.user);
  let canCreate = $derived(hasPermission(user, "recurring_invoices", "create"));
  let items = $derived(data.recurring || []);

  let running = $state(false);
  let result = $state("");

  async function runNow() {
    running = true;
    result = "";
    try {
      const res = await fetch("/api/v1/recurring/process", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed");
      result = `${t("Created")}: ${body.created ?? 0} ${t("invoices")}`;
      location.reload();
    } catch (e: any) {
      result = e.message || String(e);
    } finally {
      running = false;
    }
  }
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Recurring Invoices")}</h1>
  <div class="flex gap-2">
    <button class="btn btn-sm btn-outline" onclick={runNow} disabled={running}>
      <Play size={15} />
      {running ? t("Running…") : t("Run Due Now")}
    </button>
    {#if canCreate}
      <a href="/recurring/new" class="btn btn-primary btn-sm"><Plus size={16} /> {t("New Recurring")}</a>
    {/if}
  </div>
</div>

{#if data.error}
  <div class="alert alert-error mb-3"><span>{data.error}</span></div>
{/if}
{#if result}
  <div class="alert alert-info mb-3"><span>{result}</span></div>
{/if}

<div class="rounded-box bg-base-100 border-base-300 hidden overflow-x-auto border md:block">
  <table class="table-zebra table w-full text-sm">
    <thead class="bg-base-200 text-base-content">
      <tr class="font-medium">
        <th>{t("Name")}</th>
        <th>{t("Customer")}</th>
        <th>{t("Frequency")}</th>
        <th>{t("Next Run")}</th>
        <th>{t("Status")}</th>
      </tr>
    </thead>
    <tbody>
      {#each items as r (r.id)}
        <tr class="hover">
          <td>{r.name}</td>
          <td class="opacity-70">{r.customerName || "—"}</td>
          <td>{t(r.frequency[0].toUpperCase() + r.frequency.slice(1))}{r.intervalCount > 1 ? ` ×${r.intervalCount}` : ""}</td>
          <td class="opacity-70">{r.nextRunDate}</td>
          <td><span class="badge {r.isActive ? 'badge-success' : 'badge-ghost'}">{r.isActive ? t("Active") : t("Paused")}</span></td>
        </tr>
      {/each}
      {#if items.length === 0}
        <tr><td colspan="5" class="py-10 text-center text-sm opacity-70">{t("No recurring invoices yet")}.</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<div class="block space-y-3 md:hidden">
  {#each items as r (r.id)}
    <div class="card bg-base-100 border-base-300 border">
      <div class="card-body p-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-semibold">{r.name}</div>
            <div class="text-sm opacity-70">{r.customerName || "—"} · {t("next")}: {r.nextRunDate}</div>
          </div>
          <span class="badge {r.isActive ? 'badge-success' : 'badge-ghost'}">{r.isActive ? t("Active") : t("Paused")}</span>
        </div>
      </div>
    </div>
  {/each}
  {#if items.length === 0}
    <div class="card bg-base-100 border-base-300 border"><div class="card-body py-10 text-center text-sm opacity-70">{t("No recurring invoices yet")}.</div></div>
  {/if}
</div>
