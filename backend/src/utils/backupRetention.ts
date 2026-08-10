import { basename, dirname } from "std/path";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&");
}

function backupPattern(dbPath: string): RegExp {
  const fileName = basename(dbPath);
  const stem = fileName.toLowerCase().endsWith(".db")
    ? fileName.slice(0, -3)
    : fileName;
  return new RegExp(
    `^${
      escapeRegExp(stem)
    }_(?:backup(?:_v.*)?_\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}|prerestore_\\d+)\\.db$`,
  );
}

/** Remove old migration backups while keeping the newest `keep` files. */
export function pruneDatabaseBackups(dbPath: string, keep = 10): number {
  const safeKeep = Math.max(1, Math.floor(keep));
  const dir = dirname(dbPath);
  const pattern = backupPattern(dbPath);
  const candidates: Array<{ path: string; modified: number }> = [];

  try {
    for (const entry of Deno.readDirSync(dir)) {
      if (!entry.isFile || !pattern.test(entry.name)) continue;
      const path = `${dir}/${entry.name}`;
      try {
        const stat = Deno.statSync(path);
        candidates.push({ path, modified: stat.mtime?.getTime() || 0 });
      } catch {
        // A concurrently removed file is harmless.
      }
    }
  } catch {
    return 0;
  }

  candidates.sort((a, b) =>
    b.modified - a.modified || b.path.localeCompare(a.path)
  );
  let removed = 0;
  for (const candidate of candidates.slice(safeKeep)) {
    try {
      Deno.removeSync(candidate.path);
      removed++;
    } catch {
      // Retention is best effort; never stop application startup for cleanup.
    }
  }
  return removed;
}
