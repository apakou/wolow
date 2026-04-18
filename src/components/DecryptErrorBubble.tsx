"use client";

/**
 * Replaces the generic "🔒 Unable to decrypt" string with structured,
 * actionable copy per `DecryptErrorReason`. Renders as an inline message
 * bubble so it lays out the same as a normal message.
 */

import type { DecryptErrorReason } from "@/lib/crypto/decrypt-errors";

type Props = {
  reason: DecryptErrorReason;
  isOwnerView: boolean;
  isMine: boolean;
};

type Copy = {
  title: string;
  body: string;
  cta?: { label: string; href: string };
};

function copyFor(reason: DecryptErrorReason, isOwnerView: boolean): Copy {
  switch (reason) {
    case "no_key":
      return isOwnerView
        ? {
            title: "Encryption key missing on this device",
            body: "We can't find your private key. Restore it from a backup file to read this message.",
            cta: { label: "Restore key", href: "/settings" },
          }
        : {
            title: "Encryption key missing",
            body: "Your browser doesn't have the key needed to read this message. Try refreshing the page.",
          };
    case "key_rotated":
      return isOwnerView
        ? {
            title: "Encrypted with an older key",
            body: "This message was sent before your current key. If you have a backup of the previous key, restore it to read these older messages.",
            cta: { label: "Restore key", href: "/settings" },
          }
        : {
            title: "Encrypted with an older key",
            body: "The recipient rotated their encryption key after this message was sent. They may not be able to read it either.",
          };
    case "wrong_role":
      return {
        title: "Message wasn't addressed to you",
        body: "This message was encrypted for a different participant in the conversation.",
      };
    case "bad_envelope":
      return {
        title: "Corrupted message",
        body: "We couldn't decode this message. It may have been damaged in transit.",
      };
    case "unknown":
    default:
      return {
        title: "Couldn't decrypt this message",
        body: "Something went wrong while decrypting. Try refreshing the page.",
      };
  }
}

export default function DecryptErrorBubble({ reason, isOwnerView, isMine }: Props) {
  const { title, body, cta } = copyFor(reason, isOwnerView);

  return (
    <div
      className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words
        bg-amber-950/40 border border-amber-700/40 text-amber-100
        ${isMine ? "rounded-br-md" : "rounded-bl-md"}`}
    >
      <div className="flex items-start gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mt-0.5 shrink-0 text-amber-400">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
        </svg>
        <div className="min-w-0">
          <p className="font-semibold text-amber-200">{title}</p>
          <p className="text-xs text-amber-100/80 mt-0.5">{body}</p>
          {cta && (
            <a
              href={cta.href}
              className="inline-block mt-2 text-xs font-semibold text-amber-200 underline underline-offset-2 hover:text-white transition"
            >
              {cta.label} →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
