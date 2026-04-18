/**
 * Tracks when the owner last downloaded a `.wolow-key` backup file for a slug.
 * Stored in localStorage (not synced) — purely a UX hint for the BackupPromptModal
 * and KeyStatusCard. Losing this hint just means we re-prompt for backup.
 */

const PREFIX = "wolow:last-backup:";

export function getLastBackup(slug: string): Date | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(`${PREFIX}${slug}`);
  if (!raw) return null;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

export function markBackedUp(slug: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${PREFIX}${slug}`, String(Date.now()));
}

export function clearBackupRecord(slug: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${PREFIX}${slug}`);
}
