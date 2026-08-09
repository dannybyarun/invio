<script lang="ts">
  import { getContext } from "svelte";
  import { Save, Trash2 } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";
  import PermissionsGrid from "$lib/components/PermissionsGrid.svelte";
  import { hasPermission } from "$lib/types";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;

  let userToEdit = $derived(data.userToEdit);
  let loggedInUser = $derived(data.user);
  let canUpdate = $derived(hasPermission(loggedInUser, "users", "update"));
  let canDelete = $derived(hasPermission(loggedInUser, "users", "delete"));

  function confirmDelete(): SubmitFunction {
    return ({ cancel }) => {
      if (!confirm(t("Are you sure you want to delete this user? This action cannot be undone."))) {
        cancel();
      }
    };
  }
</script>

{#if form?.error || data.error}
  <div class="alert alert-error mb-4">
    <span>{form?.error || data.error}</span>
  </div>
{/if}

{#if data.saved}
  <div class="alert alert-success mb-4">
    <span>{t("User saved successfully.")}</span>
  </div>
{/if}

{#if userToEdit}
  <form method="post" action="?/save" use:enhance>
    <div class="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <h1 class="text-2xl font-semibold">
        {t("Edit User")}: {userToEdit.username}
      </h1>
      <div class="flex w-full items-center gap-2 sm:w-auto">
        <a href="/users" class="btn btn-ghost btn-sm flex-1 sm:flex-none">
          {t("Cancel")}
        </a>
        {#if canUpdate}
          <button type="submit" class="btn btn-primary btn-sm flex-1 sm:flex-none">
            <Save size={16} />
            {t("Save")}
          </button>
        {/if}
      </div>
    </div>

    <div class="max-w-2xl space-y-4">
      <!-- Username -->
      <div class="form-control w-full">
        <label class="label pb-1" for="username">
          <span class="label-text">
            {t("Username")} <span class="text-error">*</span>
          </span>
        </label>
        <input type="text" id="username" name="username" class="input input-sm input-bordered w-full" value={userToEdit.username} required autocomplete="off" disabled={!canUpdate} />
      </div>

      <!-- Password (optional on edit) -->
      <div class="form-control w-full">
        <label class="label pb-1" for="password">
          <span class="label-text">{t("New Password")}</span>
        </label>
        <input
          type="password"
          id="password"
          name="password"
          class="input input-sm input-bordered w-full"
          minlength="8"
          placeholder={t("Leave blank to keep current password")}
          autocomplete="new-password"
          disabled={!canUpdate}
        />
      </div>

      <!-- Email -->
      <div class="form-control w-full">
        <label class="label pb-1" for="email">
          <span class="label-text">{t("Email")}</span>
        </label>
        <input type="email" id="email" name="email" class="input input-sm input-bordered w-full" value={userToEdit.email || ""} disabled={!canUpdate} />
      </div>

      <!-- Display Name -->
      <div class="form-control w-full">
        <label class="label pb-1" for="displayName">
          <span class="label-text">{t("Display Name")}</span>
        </label>
        <input type="text" id="displayName" name="displayName" class="input input-sm input-bordered w-full" value={userToEdit.displayName || ""} disabled={!canUpdate} />
      </div>

      <!-- Admin toggle (administrators only) -->
      {#if loggedInUser?.isAdmin}
        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input type="checkbox" name="isAdmin" class="toggle toggle-primary" checked={userToEdit.isAdmin} disabled={!canUpdate} />
            <span class="label-text">{t("Administrator")}</span>
          </label>
        </div>
      {/if}

      <!-- Active toggle -->
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input type="checkbox" name="isActive" class="toggle toggle-success" checked={userToEdit.isActive} disabled={!canUpdate} />
          <span class="label-text">{t("Active")}</span>
        </label>
        <div class="label pt-1">
          <span class="label-text-alt">
            {t("Disabled users cannot log in.")}
          </span>
        </div>
      </div>

      <!-- Permissions (administrators only) -->
      {#if loggedInUser?.isAdmin}
        <div class="form-control">
          <div class="label">
            <span class="label-text font-medium">{t("Permissions")}</span>
          </div>
          <p class="mb-2 text-sm opacity-60">
            {t("Select which resources and actions this user can access. Admins bypass these checks.")}
          </p>
          <PermissionsGrid resourceActions={data.resourceActions || {}} currentPermissions={userToEdit.permissions || []} disabled={!canUpdate} />
        </div>
      {:else}
        <div class="alert alert-info text-sm">
          <span>{t("Only administrators can assign user permissions.")}</span>
        </div>
      {/if}
    </div>
  </form>

  {#if canDelete}
    <!-- Delete form -->
    <div class="divider my-8"></div>
    <form method="post" action="?/delete" use:enhance={confirmDelete()}>
      <button type="submit" class="btn btn-sm btn-error btn-outline">
        <Trash2 size={16} />
        {t("Delete User")}
      </button>
    </form>
  {/if}
{:else if data.error}
  <div class="alert alert-error">
    <span>{data.error || t("User not found")}</span>
  </div>
{/if}
