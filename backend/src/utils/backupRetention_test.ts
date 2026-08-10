import { pruneDatabaseBackups } from "./backupRetention.ts";

Deno.test("prunes old database backups while preserving the newest files", () => {
  const dir = Deno.makeTempDirSync({ prefix: "invio-backup-test-" });
  try {
    const files = [
      "invio_backup_2026-08-01T00-00-00.db",
      "invio_backup_2026-08-02T00-00-00.db",
      "invio_backup_2026-08-03T00-00-00.db",
      "invio_backup_v1.0_2026-08-04T00-00-00.db",
    ];
    for (const [index, name] of files.entries()) {
      const path = `${dir}/${name}`;
      Deno.writeTextFileSync(path, String(index));
      const time = new Date(2026, 7, index + 1);
      Deno.utimeSync(path, time, time);
    }
    Deno.writeTextFileSync(`${dir}/keep-me.txt`, "not a backup");

    const removed = pruneDatabaseBackups(`${dir}/invio.db`, 2);
    if (removed !== 2) {
      throw new Error(`Expected 2 removed backups, got ${removed}`);
    }

    const remaining = [...Deno.readDirSync(dir)]
      .filter((entry) => entry.isFile)
      .map((entry) => entry.name)
      .sort();
    if (remaining.length !== 3) {
      throw new Error(
        `Expected 2 backups plus keep-me.txt, got ${remaining.join(", ")}`,
      );
    }
    if (!remaining.includes("invio_backup_v1.0_2026-08-04T00-00-00.db")) {
      throw new Error("Newest backup was not preserved");
    }
    if (!remaining.includes("invio_backup_2026-08-03T00-00-00.db")) {
      throw new Error("Second newest backup was not preserved");
    }
  } finally {
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch {
      // Best-effort cleanup for the temporary test directory.
    }
  }
});
