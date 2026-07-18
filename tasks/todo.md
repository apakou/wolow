# Anonymous visitor access — Plan (Jul 2026)

User feedback: visitors clicking a shared room link land on the Google login
screen, contradicting the "anonymous messages" promise. Fix: Supabase
anonymous sessions for visitors (Option A), plus an in-chat prompt to convert
to a permanent account (linkIdentity keeps the same auth.uid, so the
conversation survives).

- [x] 1. `supabase/config.toml`: `enable_anonymous_sign_ins = true` + `enable_manual_linking = true` (linkIdentity requires it). Remind: flip both in hosted dashboard.
- [x] 2. `src/app/[slug]/page.tsx`: remove `!user` → login redirect; keep owner→inbox redirect; pass `hasSession`/`isAnonymous` to ChatRoom.
- [x] 3. `ChatRoom.tsx`: if no session, `signInAnonymously()` (browser client) before POST /conversations; reuse error/retry card.
- [x] 4. `SaveChatPrompt.tsx` (new): dismissible "save this chat" banner for anon senders with ≥1 sent message; CTA `linkIdentity({provider:"google"})` → `/auth/callback?next=/{slug}`; re-shown at most once after an owner reply (localStorage dismissal count).
- [x] 5. `ChatView.tsx`: optional `onActivity({visitorMessages, ownerMessages})` callback so ChatRoom knows engagement.
- [x] 6. `/auth/callback`: handle OAuth error params (identity already linked → `/?next=...&auth_error=link_exists`); `SignInWithGoogle` shows tailored message.
- [x] 7. Harden owner surfaces for anon sessions: `/welcome`, `/profile`, `/settings`, `/{slug}/inbox(/{conversationId})` treat `user.is_anonymous` as signed-out; `/` skips room lookup for anon.
- [x] 8. Owner escape hatch on visitor page (anon + no messages yet): "This is your link? Sign in" → `/?next=/{slug}/inbox`.
- [x] 9. Copy pass: help FAQ (senders need no account), SignInWithGoogle invite copy, AnonymityExplainer accuracy (unchanged claims still true).
- [x] 10. Verify: `tsc --noEmit` clean; eslint 0 errors (3 pre-existing ChatView warnings); manual flow review done. E2E against hosted blocked on dashboard toggles.

## Review Anonymous visitor access

### What changed
- **Login wall removed**: `/{slug}` renders for everyone. ChatRoom silently calls
  `signInAnonymously()` when no session exists (client-side only, so JS-less
  crawlers/OG scrapers never create auth users), then opens the conversation as
  before. Retries re-check the local session so they never mint a second
  anonymous user.
- **Zero DB migrations**: anonymous users carry a real `auth.uid()`, so RLS
  (`conversations_insert_auth`), the `(room_id, sender_user_id)` upsert, E2EE
  visitor-key upload, reactions, push, and per-conversation blocking all work
  unchanged.
- **Save-chat prompt**: after the first sent message, anonymous senders see a
  dismissible "Don't lose this chat" banner. CTA uses `linkIdentity()` which
  keeps the same user id, so the conversation and device E2EE keys survive the
  Google upgrade. Dismissal is per-conversation; the prompt returns at most
  once more after the owner replies. If the Google account already has a Wolow
  profile, `/auth/callback` maps the OAuth error to `auth_error=link_exists`
  and the sign-in screen explains the chat won't carry over.
- **Anon-session hardening**: `is_anonymous` sessions are treated as signed-out
  on `/welcome`, `/profile`, `/settings`, and both inbox pages (an owner signed
  out on a device gets the sign-in screen, not a silent bounce to the visitor
  view). `/sent` still works for anonymous senders.
- **Escape hatch**: before their first message, anonymous visitors see
  "This is your link? Sign in to open your inbox".
- **Graceful degradation**: if `signInAnonymously()` fails (provider disabled,
  or the per-IP anonymous signup rate limit), ChatRoom falls back to the
  Google sign-in screen (`/?next=/{slug}`) instead of a dead-end error card,
  and logs the cause via reportError.
- **Honest copy**: help FAQ leads with "Do I need an account? No."; sign-in
  screen invite copy says "Sign in to keep your chats".

### Deployment prerequisites (hosted project)
Dashboard → Authentication → Sign In / Providers:
1. **Allow anonymous sign-ins** → ON (verified currently OFF via probe:
   `anonymous_provider_disabled`)
2. **Allow manual linking** → ON (required by `linkIdentity`)
Optional: review anonymous rate limit (default 30/hr/IP) and consider captcha
if abuse appears; consider periodic cleanup of orphaned anonymous users.

### E2E verification (local stack, 2026-07-18)
Full chain proven against a fresh local Supabase (config.toml flags on, all
migrations applied): anonymous signup (`is_anonymous: true`) → conversation
insert WITHOUT session correctly rejected (401/42501 RLS) → conversation
insert with anon JWT passes `conversations_insert_auth` → `send_message_secure`
RPC stores the message → readback OK (`is_owner: false`). No code changes were
needed the hosted dashboard toggles are the only remaining blocker.

### Accepted trade-offs
- Blocking is per anonymous identity: clearing cookies yields a fresh identity
  (was Google-account-strong). IP limiter (10 msg/min) remains.
- A signed-out returning Google sender now gets a new anonymous thread unless
  they sign back in (escape hatch link available).
- Anonymous user rows accumulate in `auth.users`.

---

# Wolow MVP Remediation — Plan

Source: Product design audit (Jul 2026). Scope = Tier 1 (P0, launch blockers) + Tier 2 (P1, high-impact).

## Tier 1 — P0 (launch blockers)

- [x] **P0-1 Honest copy**: Fix `help/page.tsx` false claims ("doesn't require sign-in", "you don't need an account"); remove dead "terms of service" promise from sign-in screen.
- [x] **P0-2 Auth error surfaced**: Render `auth_error` on `/` sign-in screen (`role="alert"`), add loading/disabled state to the Google button.
- [x] **P0-3 Contextual visitor sign-in**: When `next=/{slug}`, look up the room server-side and show "Send {name} an anonymous message" + anonymity reassurance instead of the generic pitch.
- [x] **P0-4 Network errors ≠ empty states**: `ChatView` and `OwnerInbox` fetch failures show an error card + Retry (not "No messages yet"); `ChatRoom` error card gets a Try again button.
- [x] **P0-5 Key-loss protection**: Mount `BackupPromptModal` in the inbox; guard the implicit key-generation path (never generate a fresh key when the server already holds one).
- [x] **P0-6 Block + report**: Migration `conversations.blocked_at`; PATCH block/unblock (owner-only); message POST rejects blocked conversations; thread menu with Block/Unblock + Report (mailto); blocked rows muted in inbox.
- [x] **P0-7 owner_token bug**: DB default `gen_random_uuid()` + explicit value in the auth-callback insert (fresh-DB room creation currently violates NOT NULL).

## Tier 2 — P1 (high-impact)

- [x] **P1-1 Realtime resilience**: subscribe status callback, refetch on reconnect + `visibilitychange`, "Reconnecting…" indicator (chat + inbox).
- [x] **P1-2 Confirm destructive restore**: two-step confirm before key-rotating restore in Settings.
- [x] **P1-3 Zoom re-enabled**: drop `maximumScale: 1`; bump text inputs to 16px so iOS doesn't focus-zoom.
- [x] **P1-4 Push feedback**: check subscribe POST response; success toast / failure message in the opt-in popups.
- [x] **P1-5 Mobile composer**: safe-area padding; Enter = newline on touch devices (send via button); auto-grow textarea.
- [x] **P1-6 Gesture discoverability**: "Reply" action inside the long-press picker (swipe no longer the only path).
- [x] **P1-7 Branded 404**: `not-found.tsx` with "Get your own link" CTA.
- [x] **P1-8 Install prompt timing**: never on `/` or `/welcome` (no more popup over the sign-in screen).

## Deliberately deferred (Tier 3)
Pagination/virtualization, inbox O(n) query rework, filtered reactions channel, full a11y batch (focus traps, aria-live everywhere, touch targets), copy-system pass, dead-code removal (TipTap/DOMPurify/RichTextEditor), legal pages content.

## Verification
- [x] `npm run build` clean (TypeScript passes, all routes compile)
- [x] `npm run lint` — 0 errors (7 pre-existing warnings remain: unused imports in 2 API routes, 3 exhaustive-deps in ChatView)

## Review

### What changed
**New files**
- `supabase/migrations/029_conversation_blocking.sql` — `conversations.blocked_at`
- `supabase/migrations/030_owner_token_default.sql` — `rooms.owner_token` default (fixes fresh-DB room-creation bug)
- `src/app/not-found.tsx` — branded 404 with "Get your own link" growth CTA

**Sign-in (`page.tsx`, `SignInWithGoogle.tsx`)** — auth errors now render (`role="alert"`); button shows "Connecting…" while redirecting; visitors arriving via `?next=/{slug}` see "Send {name} an anonymous message" with anonymity reassurance; dead ToS line replaced with honest "Anonymous to friends & end-to-end encrypted".

**Help page** — no longer claims sign-in isn't required; explains the real model (Google sign-in for spam prevention, recipient never sees identity).

**Blocking** — messages POST returns 403 for blocked conversations (fails open pre-migration); conversations GET returns `blocked`; PATCH accepts `{blocked}`; OwnerThread has a ⋯ menu (Block with confirm / Unblock / Report via mailto:report@wolow.app); blocked threads freeze the composer with an Unblock banner; inbox rows show a "Blocked" pill and are excluded from unread counts.

**Resilience** — `ChatView`/`OwnerInbox` fetches distinguish errors from empty states with Retry buttons; realtime channels report status ("Reconnecting…" pill) and refetch on re-subscribe and on `visibilitychange`; ChatRoom error card gained Try again.

**Key safety** — `BackupPromptModal` now mounts in the inbox (after first conversation, never stacked on the push popup); the inbox key-init path checks the server before generating (no more silent-rotation data loss); Settings restore requires an explicit second confirmation.

**Mobile/a11y** — pinch-zoom re-enabled; chat/settings inputs at 16px (no iOS focus-zoom); composer has safe-area padding and auto-grows; Enter inserts newline on touch devices; reply available from the long-press picker; chat textarea has an aria-label.

**Push** — subscribe verifies the server response (cleans up browser sub on failure) and returns `subscribed|denied|failed`; popups show a success toast or failure message; "Enabling…" ellipsis normalized.

**Misc** — install prompt suppressed on `/` and `/welcome`; inbox header renamed "Messages" → "Inbox" (matches tab); mark-read PATCH has a `.catch`; fixed two pre-existing lint errors (BackupPromptModal `<a>`→`Link`, AnonymityExplainer setState-in-effect).

### Notes / follow-ups
- `report@wolow.app` mailbox must exist for the Report action.
- Run `supabase db push` to apply migrations 029/030; code degrades gracefully if they lag.
- Working tree contained a pre-existing uncommitted em-dash-stripping pass across many files (not part of this work).
- Visitor-side broadcast can show a transient ghost bubble in an owner's open blocked thread (DB rejects it; refetch clears it) — acceptable for MVP.
