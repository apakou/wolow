"use client";

/**
 * Settings page — single place for owners to manage their E2EE key.
 *
 * Sections:
 *   1. Key status (fingerprint, last backup, server/local match check)
 *   2. Backup    (passphrase → download .wolow-key file)
 *   3. Restore   (upload .wolow-key + passphrase → replaces local key,
 *                 uploads new public key to server with force_rotate=true)
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getPrivateKey, storePrivateKey } from "@/lib/crypto/key-storage";
import { fingerprintPublicKey, publicJwkFromPrivate } from "@/lib/crypto/fingerprint";
import { exportWrappedKey } from "@/lib/crypto/export-key";
import { importWrappedKey, ImportKeyError } from "@/lib/crypto/import-key";
import { uploadOwnerPublicKey } from "@/lib/crypto/upload-public-key";
import { getLastBackup, markBackedUp } from "@/lib/crypto/last-backup";
import KeyStatusCard from "@/components/KeyStatusCard";

type Props = {
  slug: string;
  displayName: string;
  serverFingerprint: string | null;
  rotatedAt: string | null;
};

const MIN_PASSPHRASE = 12;

export default function SettingsClient({
  slug,
  displayName,
  serverFingerprint: initialServerFingerprint,
  rotatedAt,
}: Props) {
  const [localFingerprint, setLocalFingerprint] = useState<string | null>(null);
  const [serverFingerprint, setServerFingerprint] = useState<string | null>(initialServerFingerprint);
  const [keyMissing, setKeyMissing] = useState(false);
  const [lastBackup, setLastBackup] = useState<Date | null>(null);

  // Backup form
  const [backupPass, setBackupPass] = useState("");
  const [backupPass2, setBackupPass2] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Restore form
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePass, setRestorePass] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Compute local fingerprint on mount
  useEffect(() => {
    (async () => {
      const priv = await getPrivateKey(`room:${slug}`);
      if (!priv) {
        setKeyMissing(true);
        return;
      }
      const fp = await fingerprintPublicKey(publicJwkFromPrivate(priv));
      setLocalFingerprint(fp);
    })().catch(() => setKeyMissing(true));
    setLastBackup(getLastBackup(slug));
  }, [slug]);

  const handleBackup = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBackupMsg(null);
    if (backupPass.length < MIN_PASSPHRASE) {
      setBackupMsg({ type: "err", text: `Passphrase must be at least ${MIN_PASSPHRASE} characters.` });
      return;
    }
    if (backupPass !== backupPass2) {
      setBackupMsg({ type: "err", text: "Passphrases don't match." });
      return;
    }

    setBackupBusy(true);
    try {
      const priv = await getPrivateKey(`room:${slug}`);
      if (!priv) {
        setBackupMsg({ type: "err", text: "No private key found locally — nothing to back up." });
        return;
      }
      const { blob, filename } = await exportWrappedKey(priv, backupPass, slug);

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      markBackedUp(slug);
      setLastBackup(new Date());
      setBackupPass("");
      setBackupPass2("");
      setBackupMsg({ type: "ok", text: `Backup downloaded as ${filename}. Store it somewhere safe.` });
    } catch (err) {
      setBackupMsg({ type: "err", text: (err as Error).message });
    } finally {
      setBackupBusy(false);
    }
  }, [backupPass, backupPass2, slug]);

  const handleRestore = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setRestoreMsg(null);
    if (!restoreFile) {
      setRestoreMsg({ type: "err", text: "Please choose a .wolow-key file." });
      return;
    }
    if (!restorePass) {
      setRestoreMsg({ type: "err", text: "Enter the passphrase you used when backing up." });
      return;
    }

    setRestoreBusy(true);
    try {
      const text = await restoreFile.text();
      const result = await importWrappedKey(text, restorePass, slug);

      // Persist locally first so the user always has a recoverable state
      await storePrivateKey(`room:${slug}`, result.privateJwk);

      // Then upload as a forced rotation so the server replaces any stale key
      const upload = await uploadOwnerPublicKey(slug, result.publicJwk, { forceRotate: true });

      setLocalFingerprint(result.fingerprint);
      setServerFingerprint(upload.fingerprint);
      setRestorePass("");
      setRestoreFile(null);
      setKeyMissing(false);
      setRestoreMsg({
        type: "ok",
        text: upload.rotated
          ? "Key restored and server updated. Past messages encrypted with the previous key will not be decryptable."
          : "Key restored — your key is now active.",
      });
    } catch (err) {
      if (err instanceof ImportKeyError) {
        const map: Record<typeof err.reason, string> = {
          bad_format: "This doesn't look like a valid Wolow backup file.",
          version: "This backup uses an unsupported version.",
          slug_mismatch: "This backup is for a different room.",
          bad_passphrase: "Wrong passphrase, or the file is corrupted.",
        };
        setRestoreMsg({ type: "err", text: map[err.reason] });
      } else {
        setRestoreMsg({ type: "err", text: (err as Error).message });
      }
    } finally {
      setRestoreBusy(false);
    }
  }, [restoreFile, restorePass, slug]);

  return (
    <div className="min-h-dvh bg-app-gradient text-slate-100">
      <header className="bg-header-gradient border-b border-border px-4 py-4 flex items-center gap-3">
        <Link
          href={`/${slug}/inbox`}
          className="shrink-0 w-9 h-9 rounded-full bg-surface-light/60 flex items-center justify-center text-slate-400 hover:text-white hover:bg-surface-light transition"
          aria-label="Back to inbox"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold text-white truncate">Settings</h1>
          <p className="text-xs text-muted truncate">{displayName} · /{slug}</p>
        </div>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto flex flex-col gap-6">
        <KeyStatusCard
          slug={slug}
          localFingerprint={localFingerprint}
          serverFingerprint={serverFingerprint}
          rotatedAt={rotatedAt}
          lastBackup={lastBackup}
          keyMissing={keyMissing}
        />

        {/* Backup */}
        <section className="rounded-2xl border border-border bg-surface/60 p-5 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-bold text-white">Back up your key</h2>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Download an encrypted backup of your private key. You&apos;ll need this if you switch
              browsers or clear your data — without it, all messages become unreadable.
              <br />
              <span className="text-slate-300">Wolow never sees your passphrase or your key.</span>
            </p>
          </div>
          <form onSubmit={handleBackup} className="flex flex-col gap-3">
            <label className="text-xs text-slate-300">
              Passphrase (min {MIN_PASSPHRASE} characters)
              <input
                type="password"
                value={backupPass}
                onChange={(e) => setBackupPass(e.target.value)}
                disabled={backupBusy || keyMissing}
                autoComplete="new-password"
                className="mt-1 w-full bg-surface-light border border-border rounded-xl px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                placeholder="A passphrase only you know"
              />
            </label>
            <label className="text-xs text-slate-300">
              Confirm passphrase
              <input
                type="password"
                value={backupPass2}
                onChange={(e) => setBackupPass2(e.target.value)}
                disabled={backupBusy || keyMissing}
                autoComplete="new-password"
                className="mt-1 w-full bg-surface-light border border-border rounded-xl px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                placeholder="Type it again"
              />
            </label>
            {backupMsg && (
              <p className={`text-xs ${backupMsg.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                {backupMsg.text}
              </p>
            )}
            <button
              type="submit"
              disabled={backupBusy || keyMissing}
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {backupBusy ? "Encrypting…" : "Download encrypted backup"}
            </button>
            {keyMissing && (
              <p className="text-xs text-amber-400">
                No private key found locally. Restore from a backup below to set one up.
              </p>
            )}
          </form>
        </section>

        {/* Restore */}
        <section className="rounded-2xl border border-border bg-surface/60 p-5 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-bold text-white">Restore from backup</h2>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Upload a <code className="text-slate-300">.wolow-key</code> file to install your key on this device.
              Restoring rotates the key on Wolow&apos;s servers — older messages encrypted with a
              <em> different</em> key cannot be recovered.
            </p>
          </div>
          <form onSubmit={handleRestore} className="flex flex-col gap-3">
            <label className="text-xs text-slate-300">
              Backup file
              <input
                type="file"
                accept=".wolow-key,application/json"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                disabled={restoreBusy}
                className="mt-1 w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-light file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-surface disabled:opacity-50"
              />
            </label>
            <label className="text-xs text-slate-300">
              Passphrase
              <input
                type="password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                disabled={restoreBusy}
                autoComplete="off"
                className="mt-1 w-full bg-surface-light border border-border rounded-xl px-3 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                placeholder="The passphrase from when you backed up"
              />
            </label>
            {restoreMsg && (
              <p className={`text-xs ${restoreMsg.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                {restoreMsg.text}
              </p>
            )}
            <button
              type="submit"
              disabled={restoreBusy}
              className="w-full rounded-xl border border-accent text-accent px-4 py-2.5 text-sm font-semibold transition hover:bg-accent hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {restoreBusy ? "Restoring…" : "Restore key"}
            </button>
          </form>
        </section>

        <div className="text-center pt-2">
          <Link href="/help" className="text-xs text-muted hover:text-slate-300 underline">
            How does end-to-end encryption work in Wolow?
          </Link>
        </div>
      </main>
    </div>
  );
}
