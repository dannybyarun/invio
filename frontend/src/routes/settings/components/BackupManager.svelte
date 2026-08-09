<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { CircleAlert, Database, Download, RotateCcw, Upload } from "lucide-svelte";

  let t = getContext("i18n") as (key: string) => string;

  let info = $state<any>(null);
  let busy = $state(false);
  let error = $state("");
  let success = $state("");
  let fileInput: HTMLInputElement;

  async function loadInfo() {
    try {
      const res = await fetch("/api/v1/backup/info");
      if (res.ok) info = await res.json();
    } catch {
      /* ignore */
    }
  }

  function downloadBackup() {
    window.location.href = "/api/v1/backup/download";
  }

  async function restoreBackup() {
    const file = fileInput?.files?.[0];
    if (!file) {
      error = t("Choose a backup file first");
      return;
    }
    error = "";
    success = "";
    busy = true;
    try {
      const res = await fetch("/api/v1/backup/restore", {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("Restore failed"));
      success = t("Database restored successfully");
      await loadInfo();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      if (fileInput) fileInput.value = "";
    }
  }

  onMount(() => loadInfo());
</script>

<div class="bg-base-100 rounded-box border-base-200 max-w-4xl space-y-6 border p-6">
  <div class="space-y-2">
    <h2 class="text-xl font-semibold">{t("Backup & Restore")}</h2>
    <p class="text-sm opacity-80">
      {t("Download a full copy of your database, or restore from a previous backup file.")}
    </p>
  </div>

  {#if error}<div class="alert alert-error"><CircleAlert size={17} /><span>{error}</span></div>{/if}
  {#if success}<div class="alert alert-success"><span>{success}</span></div>{/if}

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <div class="border-base-300 rounded-box border p-5">
      <div class="mb-2 flex items-center gap-2 text-lg font-semibold">
        <Database size={18} class="text-primary" />
        {t("Current database")}
      </div>
      <div class="space-y-1 text-sm opacity-80">
        <div>{t("Size")}: {info?.sizeHuman || "—"}</div>
        <div>{t("Records")}: {info?.recordCount ?? "—"}</div>
        <div>{t("Last modified")}: {info?.updatedAt ? info.updatedAt.slice(0, 19).replace("T", " ") : "—"}</div>
      </div>
      <button type="button" class="btn btn-primary mt-4" onclick={downloadBackup}>
        <Download size={16} />
        {t("Download backup")}
      </button>
    </div>

    <div class="border-base-300 rounded-box border p-5">
      <div class="mb-2 flex items-center gap-2 text-lg font-semibold">
        <RotateCcw size={18} class="text-warning" />
        {t("Restore backup")}
      </div>
      <p class="mb-3 text-sm opacity-70">
        {t("Restoring replaces all current data with the uploaded backup. A safety copy of the current database is kept on the server.")}
      </p>
      <input bind:this={fileInput} type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" class="file-input file-input-bordered file-input-sm w-full" />
      <button type="button" class="btn btn-warning mt-4" disabled={busy} onclick={restoreBackup}>
        {#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
        <Upload size={16} />
        {t("Restore from file")}
      </button>
    </div>
  </div>
</div>
