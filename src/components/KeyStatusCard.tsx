"use client";

import { relativeTime } from "@/lib/relative-time";

type Props = {
  slug: string;
  localFingerprint: string | null;
  serverFingerprint: string | null;
  rotatedAt: string | null;
  lastBackup: Date | null;
  keyMissing: boolean;
};

/**
 * Visualises the state of the owner's E2EE key.
 *
 * The most important signal is the fingerprint match: if local ≠ server,
 * the user is on a device that holds a different (likely stale) key, and
 * any messages they receive will fail to decrypt.
 */
export default function KeyStatusCard({
  localFingerprint,
  serverFingerprint,
  rotatedAt,
  lastBackup,
  keyMissing,
}: Props) {
  const match = !!localFingerprint && !!serverFingerprint && localFingerprint === serverFingerprint;
  const mismatch = !!localFingerprint && !!serverFingerprint && !match;

  let statusLabel: string;
  let statusTone: "ok" | "warn" | "err" | "info";
  if (keyMissing) {
    statusLabel = "No key on this device";
    statusTone = "err";
  } else if (mismatch) {
    statusLabel = "Local key doesn't match the server";
    statusTone = "err";
  } else if (match) {
    statusLabel = "Your key is active";
    statusTone = "ok";
  } else {
    statusLabel = "Checking…";
    statusTone = "info";
  }

  const toneClasses: Record<"ok" | "warn" | "err" | "info", string> = {
    ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    err: "bg-red-500/15 text-red-300 border-red-500/30",
    info: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  };

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">Encryption key</h2>
          <p className="text-xs text-muted mt-1">
            Only your device holds the private key that decrypts incoming messages.
          </p>
        </div>
        <span className={`text-[10px] uppercase tracking-wide font-semibold px-2.5 py-1 rounded-full border ${toneClasses[statusTone]}`}>
          {statusLabel}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-xs">
        <FingerprintRow label="On this device" value={localFingerprint} highlight={mismatch} />
        <FingerprintRow label="On Wolow servers" value={serverFingerprint} highlight={mismatch} />
        <Row label="Last rotated">
          {rotatedAt ? <span className="text-slate-200">{relativeTime(rotatedAt)}</span> : <span className="text-muted">Never</span>}
        </Row>
        <Row label="Last backup">
          {lastBackup ? (
            <span className="text-slate-200">{relativeTime(lastBackup.toISOString())}</span>
          ) : (
            <span className="text-amber-400">Never — back up below</span>
          )}
        </Row>
      </dl>

      {mismatch && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 leading-relaxed">
          The key on this device doesn&apos;t match the one stored on the server. New messages will
          fail to decrypt. Restore your backup below to fix this, or — if you&apos;ve lost the backup —
          you can rotate to your local key (older messages will become unreadable).
        </div>
      )}

      {keyMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 leading-relaxed">
          This browser doesn&apos;t have your private key. If you have a <code>.wolow-key</code> backup,
          restore it below. Otherwise, opening your inbox will generate a fresh key — and any past
          messages encrypted to your old key will be lost.
        </div>
      )}
    </section>
  );
}

function FingerprintRow({ label, value, highlight }: { label: string; value: string | null; highlight: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className={`font-mono text-[11px] truncate text-right ${highlight ? "text-red-300" : "text-slate-200"}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
