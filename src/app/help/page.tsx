import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Help & FAQ — Wolow",
  description: "How Wolow's anonymous messaging and end-to-end encryption work.",
};

type Faq = { q: string; a: React.ReactNode };

const FAQS: Faq[] = [
  {
    q: "How is my anonymity protected when I send a message?",
    a: (
      <>
        Wolow doesn&apos;t require you to sign in to send a message. The recipient sees a
        randomly-generated nickname (like <span className="font-mono text-accent">Curious Otter</span>)
        instead of any real identity. We don&apos;t attach your IP address, browser
        fingerprint, or device ID to the messages we store. The same anonymous identity is
        reused for the duration of a conversation so the recipient can reply, but it has no
        link to you outside of that thread.
      </>
    ),
  },
  {
    q: "What does \u201Cend-to-end encrypted\u201D mean here?",
    a: (
      <>
        Every message is encrypted in your browser before it leaves your device, using a
        public key belonging to the other participant. Only someone holding the matching
        private key — stored only on the recipient&apos;s device — can decrypt and read the
        message. Wolow&apos;s servers store and relay the ciphertext but cannot read it.
      </>
    ),
  },
  {
    q: "Where is my private key stored?",
    a: (
      <>
        Your private key is generated in your browser and saved to IndexedDB on your device.
        It is <strong>never sent to our servers</strong>. This is what makes the encryption
        end-to-end — but it also means losing the key (clearing browser data, switching
        devices, browser ITP) means losing access to your messages.
      </>
    ),
  },
  {
    q: "Why should I back up my key?",
    a: (
      <>
        Because your key lives only on this device, anything that wipes browser storage will
        permanently lock you out of older messages. From{" "}
        <Link href="/settings" className="text-accent underline">Settings</Link> you can
        download a small <span className="font-mono">.wolow-key</span> file protected by a
        passphrase you choose. Keep it in a password manager or secure cloud folder. To
        restore on a new device, upload the file and enter your passphrase.
      </>
    ),
  },
  {
    q: "I see \u201CEncrypted with an older key\u201D — what happened?",
    a: (
      <>
        That message was encrypted with a previous version of your key (for example, before
        you cleared browser data and a new key was generated). If you saved a backup of the
        older key, restore it from{" "}
        <Link href="/settings" className="text-accent underline">Settings</Link> to read
        those older messages. Otherwise, those specific messages are unrecoverable — but
        new messages going forward will be readable normally.
      </>
    ),
  },
  {
    q: "Can the recipient figure out who I am?",
    a: (
      <>
        The recipient only sees the anonymous nickname assigned to your conversation. They
        cannot see your IP, your account (you don&apos;t need one), or any device
        information from us. They <em>can</em>, of course, infer who you are from{" "}
        <strong>what you write</strong> — so be mindful of personal details in the text
        itself if anonymity matters to you.
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-dvh bg-app-gradient text-slate-200">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3">
          <Link
            href="/"
            className="shrink-0 w-9 h-9 rounded-full bg-surface-light/60 flex items-center justify-center text-slate-400 hover:text-white hover:bg-surface-light transition-all"
            aria-label="Back to home"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Help &amp; FAQ</h1>
            <p className="text-sm text-muted">How anonymity and end-to-end encryption work on Wolow.</p>
          </div>
        </header>

        <div className="flex flex-col gap-4">
          {FAQS.map(({ q, a }, i) => (
            <details
              key={i}
              className="rounded-2xl border border-border bg-surface/60 backdrop-blur p-4 group"
            >
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold text-white">
                <span>{q}</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4 text-muted transition-transform group-open:rotate-180 shrink-0"
                >
                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </summary>
              <div className="mt-3 text-sm text-slate-300 leading-relaxed">{a}</div>
            </details>
          ))}
        </div>

        <footer className="mt-10 text-center text-xs text-muted">
          Still stuck? Visit{" "}
          <Link href="/settings" className="text-accent hover:underline">Settings</Link>{" "}
          to back up or restore your encryption key.
        </footer>
      </div>
    </div>
  );
}
