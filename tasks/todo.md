# PWA install popup · session · profile+logout · bottom navbar

> Carried over from previous task — still pending:
> - [ ] **USER ACTION**: apply migration 028 on hosted DB (dashboard SQL editor)
> - [ ] **USER ACTION**: manual visual pass on visitor page (candy variant)

## Context & findings

1. **Install popup** — an inline install card already exists but only for
   visitors inside `ChatView`; its dismissal isn't persisted (reappears every
   load). Request: app-wide popup on **first opening**.
2. **Session** — investigated: sessions ALREADY persist. `@supabase/ssr` sets
   auth cookies with `maxAge: 400 days` (verified in node_modules), root
   middleware refreshes tokens on every request, and `/` auto-redirects a
   signed-in user to their inbox. No code gap on the web. (On iOS, an installed
   PWA has its own cookie jar → one sign-in inside the PWA is unavoidable,
   after which it persists there too.) Only real gap found: `/sent` redirects
   unauthenticated users to `/` without `?next=/sent`.
3. **Profile/logout** — no profile screen and NO sign-out anywhere in the app
   (settings even tells users to "sign out and back in" — impossible today).
4. **Navbar** — no shared nav; each page has its own header. Inbox header has
   a "Sent" pill (plain `<a>`) + displayName pill; settings/sent reachable
   only via deep links.

## Plan

### Phase 1 — Shared PWA lib + install popup (first opening)
- [ ] `src/lib/pwa.ts` (new): `isStandaloneDisplayMode()`, `isIosDevice()`,
      `BeforeInstallPromptEvent` type, and a module-level
      `installPromptOpen` flag (getter/setter) so the push popup can avoid
      stacking on top of the install popup.
- [ ] `src/components/InstallPromptPopup.tsx` (new, client): modal popup,
      mounted in root layout.
      - Skips: standalone display-mode, or `wolow_install_prompt_seen` set
        (first opening only — flag written when shown).
      - Captures `beforeinstallprompt` → native [Install app] button.
      - iOS fallback: Share → "Add to Home Screen" instructions.
      - No prompt event + not mobile → don't show (no dead-end popups).
      - "Not now" dismiss; hides on `appinstalled`.
- [ ] `src/app/layout.tsx`: mount `<InstallPromptPopup />`.
- [ ] `src/components/ChatView.tsx`: remove the now-duplicate inline install
      card (state, effects, JSX, style keys); guard push popup with
      `isInstallPromptOpen()`.
- [ ] `OwnerInbox.tsx`: same push-popup guard.

### Phase 2 — Profile screen + logout
- [ ] `src/app/profile/page.tsx` (new, server): auth gate
      (`redirect("/?next=/profile")`), fetch user (email, name, avatar from
      Google metadata) + room (slug, display_name).
- [ ] `src/app/profile/ProfileClient.tsx` (new, client): avatar + name +
      email card, "your link" card, menu (Settings, Help & FAQ), and
      **Log out** button → client-side `supabase.auth.signOut()` +
      `window.location.assign("/")` (client-side signOut writes cookies
      directly — avoids the route-handler redirect cookie pitfall from
      lessons.md #4).
- [ ] `next.config.ts`: `images.remotePatterns` for
      `lh3.googleusercontent.com` (Google avatar via next/image → optimizer
      proxies it, so CSP `img-src 'self'` still holds).

### Phase 3 — Bottom navbar (icons)
- [ ] `src/components/BottomNav.tsx` (new, client): 3 icon tabs —
      Inbox (`/{slug}/inbox`), Sent (`/sent`), Profile (`/profile`) —
      active state via `usePathname()`, aria-labels, safe-area padding,
      in-flow (`shrink-0`) at the bottom of each screen's flex column.
- [ ] `OwnerInbox.tsx`: remove "Sent" pill + displayName pill from header
      (moved to navbar/profile); add `<BottomNav />`.
- [ ] `src/app/sent/page.tsx`: drop back-arrow (navbar covers it), add
      `<BottomNav />`, fix redirect → `/?next=/sent`.
- [ ] `src/app/settings/SettingsClient.tsx`: back arrow → `/profile`,
      restructure to `h-dvh` flex + scrollable main, add `<BottomNav />`.

### Phase 4 — Verification
- [x] `npx tsc --noEmit` clean
- [x] eslint on touched files: no new issues
- [x] Check for running dev server before any `next build` (lessons.md #10)
      — dev server WAS running → build skipped, tsc + eslint used instead
- [ ] **USER ACTION**: manual flow check — first-open install popup, nav tabs,
      profile → logout → sign back in

## Review

### What shipped

**1. Install invite popup (first opening)**
- `src/lib/pwa.ts` (new) — shared `isStandaloneDisplayMode()`, `isIosDevice()`,
  `isMobileDevice()`, `BeforeInstallPromptEvent` type, and a module-level
  `installPromptOpen` flag so other popups can avoid stacking.
- `src/components/InstallPromptPopup.tsx` (new) — mounted in root layout.
  Shows ONCE on first opening (`wolow_install_prompt_seen` in localStorage,
  set when shown). Chromium: captures `beforeinstallprompt` → native install
  button (late-firing events after the 900 ms delay still surface it).
  iOS: Share → "Add to Home Screen" instructions. Desktop w/o install
  support: never shows. Standalone: never shows. Hides on `appinstalled`.
- `ChatView.tsx` — removed the old inline visitor install card (state,
  effects, JSX, 4 style keys × 2 variants, local type + helper) — replaced
  by the global popup. Push popup now skips if the install popup is open.

**2. Session persistence — verified, not broken**
- Investigated: `@supabase/ssr` sets auth cookies with 400-day maxAge
  (checked in node_modules), root middleware refreshes tokens on every
  request, `/` redirects signed-in users straight to their inbox. Sessions
  already persist across restarts; no fix needed. (iOS installed PWAs have
  a separate cookie jar — one sign-in inside the PWA is a platform
  constraint, after which it persists there too.)
- Real gap fixed: `/sent` now redirects unauthenticated users with
  `?next=/sent` so they return where they were after login.

**3. Profile screen + logout**
- `src/app/profile/page.tsx` + `ProfileClient.tsx` (new) — Google avatar
  (next/image via optimizer → CSP img-src 'self' still holds; wildcard
  `*.googleusercontent.com` remotePattern added to next.config.ts), name,
  email, inbox-link card, menu (Settings, Help), and **Log out** button:
  client-side `supabase.auth.signOut({ scope: "local" })` (this device only)
  + `window.location.assign("/")` full reload — avoids the route-handler
  cookie pitfall (lessons.md #4). E2EE keys in IndexedDB intentionally
  untouched on logout (messages stay decryptable after re-login).

**4. Bottom navbar (icons)**
- `src/components/BottomNav.tsx` (new) — 3 icon tabs (Inbox / Sent /
  Profile), active state via `usePathname` (profile tab also lit on
  /settings), aria-labels + aria-current, safe-area bottom padding,
  rendered in-flow inside each screen's `h-dvh` flex column (no fixed
  positioning → nothing hidden behind it).
- `OwnerInbox` — "Sent" pill and displayName pill removed from header
  (→ navbar icon / profile screen); nav added. Also applied lessons.md #5:
  push popup now gates on `permission === "default"` (was `!== "denied"`).
- `sent/page.tsx` — back arrow removed (navbar), nav added.
- `SettingsClient` — restructured to `h-dvh` flex + scrollable main, back
  arrow → `/profile`, nav added.

### Verification performed
- `npx tsc --noEmit` — clean.
- eslint on all 11 touched/created files — no new issues. Remaining:
  1 pre-existing `OwnerInbox:52` setState-in-effect error (verified
  identical in HEAD via `git show`, documented out-of-scope) + 3
  pre-existing `e2ee` exhaustive-deps warnings in ChatView. My changes
  FIXED one pre-existing lint error (the `/sent` `<a>` anchor).
- `next build` skipped: user's dev server running (lessons.md #10).

### Follow-up — back button in sender chat (user request)
- ChatView default header (sender view): added a back-arrow button
  (top-left, same style/anatomy as OwnerThread's) → `Link href="/"`,
  which server-redirects the signed-in sender to their own inbox.
- Removed the "my inbox ✨ / Create your own link" pill it replaces
  (JSX + `createLinkPill` style keys in both variants + type); it also
  used `target="_blank"` — the back button navigates in the same tab.
  The first-send celebration card's "share my link ✨" CTA is untouched.
- Title row gets `px-12` (sender view only) so the absolute-positioned
  arrow never overlaps the truncated name.
- Verified: tsc clean; eslint — 0 errors, only the 3 pre-existing warnings.

### Follow-up — optimized sender top navbar (user request)
Redesigned the ChatView default header (sender view) from a 4-row centered
stack (~120px: big avatar chip / "anonymous messages for" eyebrow / name +
bell) to a compact single-row messenger header (~56px) containing only the
essentials:
- `[←ᴮᵃᶜᵏ] [avatar 36px] Name ⏎ 🔒 you're anonymous · encrypted [🔔]`
- Back button: in-flow (no more absolute positioning / px-12 hack).
- Trust line: persistent one-liner under the name (emerald lock, same icon
  as OwnerThread's E2EE line) — stays visible after the dismissible
  AnonymityExplainer is gone; detailed claims (nickname preview, IP/device,
  Learn more) remain in the explainer. Copy factual per ethics guardrails.
- Removed: eyebrow line + `headerEyebrow` style key (type + both variants);
  `headerTitle` restyled left-aligned (candy: text-xl→text-base).
- Screen budget freed: ~64px more vertical space for messages/composer.
- Verified: tsc clean; eslint — 0 errors, only the 3 pre-existing warnings.

### Follow-up — native-app navigation feel (user request)
Three layers, no experimental flags:
1. **Direction-aware screen transitions** — `src/lib/nav-transition.ts`
   infers direction from a screen-depth hierarchy (0 entry: `/`,`/welcome`;
   1 tabs: inbox/sent/profile; 2 detail: thread/settings/help/sender chat).
   `src/app/template.tsx` (new, remounts per navigation) applies:
   deeper→`anim-screen-push` (slide from right), shallower→`anim-screen-pop`
   (slide from left), same depth→`anim-screen-tab` (150 ms cross-fade).
   No per-link wiring; idempotent against StrictMode double-effects; class
   set pre-paint via isomorphic layout effect; first load unanimated;
   reduced-motion guarded. Body gets `overflow-x: clip` so the 28 px
   translate never flashes a horizontal scrollbar.
2. **Instant skeleton screens** — `loading.tsx` for inbox, sent, profile,
   settings, thread (each mirrors its real screen's anatomy) +
   `BottomNavSkeleton` export in BottomNav.tsx so the tab bar area doesn't
   jump. Taps now respond instantly instead of waiting on server fetches.
3. **Mobile-feel CSS** — `-webkit-tap-highlight-color: transparent`,
   `overscroll-behavior-y: none`, `touch-action: manipulation` on a/button.
Known trade-off: the tab bar lives inside each page, so it participates in
the 150 ms tab cross-fade (a truly persistent bar would need a shared
layout across `[slug]` + static segments — not worth the restructure).
Verified: tsc clean; eslint clean on all new files.

### Follow-up — optimized owner inbox header (user request)
Same treatment as the sender header. Before: 3 stacked rows (~150 px) —
title / web-style readonly URL input + Share button / filter pills.
After: 2 rows (~100 px):
- Row 1: "Messages" title + **"Share my link"** accent pill (top-right,
  native share sheet or WhatsApp/Telegram/X/Copy-link dropdown — logic
  unchanged, `shareableLink` still feeds the menu URLs).
- Row 2: Inbox / Unread filter pills (unchanged).
- Removed: the readonly URL input — a raw URL is web furniture; copying
  lives in the share menu + native sheet, and the path is visible on the
  profile screen. "copied! 🎉" toast re-anchored under the share button
  (`whitespace-nowrap`).
- Inbox `loading.tsx` skeleton updated to mirror the new anatomy.
- Verified: tsc clean; eslint — only the pre-existing OwnerInbox:52
  setState-in-effect error (in HEAD, documented out-of-scope).

### Follow-up — optimized owner thread header (user request)
`OwnerThread.tsx` custom header converted from the 4-row centered stack
(back arrow / 44 px avatar / "anonymous messages from" eyebrow / name /
E2EE line, ~130 px) to the exact same compact single-row anatomy as the
sender header (~56 px):
`[←] [emoji avatar 36px] Curious Gecko ⏎ 🔒 end-to-end encrypted · only you can read this · How?`
- E2EE trust line kept (lowercase, truncates; "How?" link shrink-0 so it
  never clips), redundant border-b div dropped (header already has one).
- Thread `loading.tsx` skeleton synced to the new single-row anatomy.
- Verified: tsc clean; eslint clean on both files.
