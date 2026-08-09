<script lang="ts">
  import { getContext } from "svelte";
  import { UserPlus } from "lucide-svelte";
  import { enhance } from "$app/forms";
  import PermissionsGrid from "$lib/components/PermissionsGrid.svelte";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;

  let fd = $derived((form?.formData as Record<string, string>) || {});
  let canManageAdmin = $derived(Boolean(data.user?.isAdmin));
</script>

<form method="post" use:enhance>
  <div class="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
    <h1 class="text-2xl font-semibold">{t("New User")}</h1>
    <div class="flex w-full items-center gap-2 sm:w-auto">
      <a href="/users" class="btn btn-ghost btn-sm flex-1 sm:flex-none">
        {t("Cancel")}
      </a>
      <button type="submit" class="btn btn-primary btn-sm flex-1 sm:flex-none">
        <UserPlus size={16} />
        {t("Create User")}
      </button>
    </div>
  </div>

  {#if form?.error || data.error}
    <div class="alert alert-error mb-4">
      <span>{form?.error || data.error}</span>
    </div>
  {/if}

  <div class="max-w-2xl space-y-4">
    <!-- Username -->
    <div class="form-control w-full">
      <label class="label pb-1" for="username">
        <span class="label-text">
          {t("Username")} <span class="text-error">*</span>
        </span>
      </label>
      <input type="text" id="username" name="username" class="input input-sm input-bordered w-full" value={fd.username || ""} required autocomplete="off" />
    </div>

    <!-- Password -->
    <div class="form-control w-full">
      <label class="label pb-1" for="password">
        <span class="label-text">
          {t("Password")} <span class="text-error">*</span>
        </span>
      </label>
      <input type="password" id="password" name="password" class="input input-sm input-bordered w-full" required minlength="8" autocomplete="new-password" />
      <div class="label pt-1">
        <span class="label-text-alt">{t("Minimum 8 characters")}</span>
      </div>
    </div>

    <!-- Email -->
    <div class="form-control w-full">
      <label class="label pb-1" for="email">
        <span class="label-text">{t("Email")}</span>
      </label>
      <input type="email" id="email" name="email" class="input input-sm input-bordered w-full" value={fd.email || ""} />
    </div>

    <!-- Display Name -->
    <div class="form-control w-full">
      <label class="label pb-1" for="displayName">
        <span class="label-text">{t("Display Name")}</span>
      </label>
      <input type="text" id="displayName" name="displayName" class="input input-sm input-bordered w-full" value={fd.displayName || ""} />
    </div>

    <!-- Admin toggle (administrators only) -->
    {#if canManageAdmin}
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input type="checkbox" name="isAdmin" class="toggle toggle-primary" />
          <span class="label-text">{t("Administrator")}</span>
        </label>
        <div class="label pt-1">
          <span class="label-text-alt">
            {t("Administrators have full access to all features.")}
          </span>
        </div>
      </div>
    {/if}

    <!-- Permissions (administrators only) -->
    {#if canManageAdmin}
      <div class="form-control">
        <div class="label">
          <span class="label-text font-medium">{t("Permissions")}</span>
        </div>
        <p class="mb-2 text-sm opacity-60">
          {t("Select which resources and actions this user can access. Admins bypass these checks.")}
        </p>
        <PermissionsGrid resourceActions={data.resourceActions || {}} currentPermissions={[]} />
      </div>
    {:else}
      <div class="alert alert-info text-sm">
        <span>{t("Only administrators can assign user permissions.")}</span>
      </div>
    {/if}
  </div>
</form>
