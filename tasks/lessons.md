# Lessons

## 2026-04-18 — Verify migrations before claiming "applied"

**Mistake**: Assumed migration 026 was applied to the running database. When the fingerprint-returning GET `/api/rooms/[slug]/keys` route silently returned 404 because the `owner_key_fingerprint` column didn't exist, the original `getRoom()` helper swallowed the Postgres error (`.single()` + ignoring `error`), masking the real cause as "Room not found".

**Rule**:
- Never mark a migration as "applied" without a `SELECT column_name FROM information_schema.columns WHERE ...` verification against the live DB.
- When a Supabase query can legitimately return zero rows AND can fail with an error, use `.maybeSingle()` and always inspect `error` before returning `null`. Propagate the error message (behind a 500 status) so routes fail loudly instead of silently 404-ing.
- Anonymous-token apps with `RLS USING(true)` cannot produce "row missing" from auth issues — a 404 always points at either a typo in the slug or a schema/migration mismatch.

## 2026-04-18 — Don't swallow DB errors on auth/redirect routes

**Mistake**: The `/auth/callback` route's first-sign-in INSERT into `rooms` was missing the required `owner_token` column. The INSERT silently failed with a NOT-NULL violation, the route caught the error and redirected to `/?auth_error=1` with no logging. The bug went unnoticed for a long time because every existing user already had a row, so the INSERT branch never ran. It only surfaced after wiping the database.

**Rule**:
- Any auth/onboarding route that inserts into a table must `console.error` (or `logError`) the underlying DB error before redirecting. Silent `auth_error=1` redirects hide root causes for weeks.
- When a table has NOT NULL columns with no default (like `owner_token`), grep all INSERT call sites at migration time to confirm every code path supplies the value. Tests for the "first user" path don't exist because seeded test users always have a room.
- Wiping a database is a great way to discover dead-code-path bugs in onboarding flows. Worth doing on a staging DB periodically.

## 2026-04-18 — Don't remove resilience when adding safety checks

**Mistake**: When adding a "fetch server keys first, refuse to silently generate" check to `useE2EE`, I made the new upfront `fetchConversationKeys` call non-resilient. Any transient 5xx/network failure now crashed init entirely, where previously the flow was tolerant (generated locally first).

**Rule**:
- When adding a new network call to an init path that previously worked offline-ish, add retry + typed error handling in the same commit.
- For fail-safe paths (e.g. "don't generate a new key without knowing the server state"), if you can't reach the server, prefer degrading to read-only (use local key for decrypt) rather than either (a) silently generating or (b) hard-erroring.
- Always type network errors with HTTP status so callers can distinguish 404 (don't retry) from 5xx/network (retry).

## 2026-04-18 — Supabase SSR cookies in Route Handler redirects

**Mistake**: `/auth/callback` called `supabase.auth.exchangeCodeForSession(code)` (which writes session cookies via the `cookies()` adapter) and then returned a freshly-constructed `NextResponse.redirect(...)`. The new response object did not carry the cookies the adapter had set, so the browser never received the `sb-*-auth-token` cookies. The user landed back at `/`, `getUser()` returned null, and `SignInWithGoogle` rendered again — creating a silent OAuth login loop. The `/auth/callback` server-side `getUser()` call worked because it read straight from `cookieStore`, masking the bug from local logging.

**Rule**:
- In Route Handlers that exchange auth codes, **construct the redirect `NextResponse` first** and pass a Supabase client whose `cookies.setAll` writes onto **that exact response**. Don't rely on the `next/headers` `cookies()` adapter — its writes don't propagate to a new response object you build later.
- If you need to change the redirect destination after the auth exchange, copy cookies from the provisional response onto the new one with `previous.cookies.getAll().forEach(c => next.cookies.set(c))`.
- Symptom signature for this bug: server-side `getUser()` works inside the callback route, but the very next page load is unauthenticated. If you see that, suspect the response-cookie binding before anything else.

## 2026-04-18 — Push-notification re-prompt gating

**Mistake**: The "Enable notifications" modal gated on `permission !== "denied"`, which still pops the modal when permission is already `"granted"` but the browser isn't currently subscribed (DB row wiped, new device, PWA reinstall, browser cleared site data). The user already said yes — re-asking is annoying and confusing.

**Rule**:
- Only show an "enable notifications" prompt when `Notification.permission === "default"`. That's the *only* state where the user hasn't yet answered the OS-level prompt.
- For `permission === "granted"` but `!isSubscribed`, silently re-subscribe in the background (the OS prompt won't re-appear; `pushManager.subscribe` just works).
- For `permission === "denied"`, don't pop a modal — at most show a passive hint in settings explaining how to re-enable in browser preferences.
- Whenever you write a "show this prompt" effect, list the three `NotificationPermission` states explicitly and decide what each does.

## 2026-04-18 — Remove stale UX after backend automation

**Mistake**: After moving room creation from a manual user action to automatic provisioning in `/auth/callback`, a "Create your link" link in the empty-state of `/settings` remained — pointing back at `/`, which has no creation UI either. Users would click it and end up in a confusing loop.

**Rule**:
- When automating a previously-manual flow, grep the codebase for the old call-to-action copy and either delete it or rewrite it to describe the new automatic behaviour. The empty-state of an auto-created resource should explain *why* the resource is missing, not offer a phantom action.
- Empty-states for auto-provisioned resources usually indicate an error in the provisioning step (here: the callback INSERT failed). Surface that as an error message + recovery hint (sign out / retry), not as a "create" CTA.

## 2026-07-18 — CREATE OR REPLACE FUNCTION with new params = overload, not replace

**Mistake**: Migration 026 "extended" `set_owner_public_key` by adding `p_fingerprint` and `p_mark_rotated` params via `CREATE OR REPLACE FUNCTION`. In Postgres a function's identity is its name + argument types, so this *added a second overload* instead of replacing the 019/025 version. PostgREST then rejected every 3-named-arg RPC call with PGRST203 ("Could not choose the best candidate function") → `PUT /api/rooms/[slug]/keys` returned 500 "Failed to store key" in production.

**Rule**:
- When changing a function's parameter list in a migration, `DROP FUNCTION IF EXISTS fn(old, arg, types);` first, in the same migration. `CREATE OR REPLACE` only replaces an *identical* signature.
- When calling Supabase RPCs that have optional/defaulted params, pass **all** params explicitly from app code — a fully-named call uniquely selects one candidate and is immune to leftover overloads.
- Symptom signature: RPC worked before a "signature extension" migration, now fails with PGRST203, and `information_schema.routines`/`\df` shows the function name twice.
- Diagnose hosted-DB state cheaply with anon-key REST probes: select the new column filtered by a nil UUID (`?select=col&id=eq.00000000-...`) to check columns, and call the RPC with a nil room id to check function resolution without touching data.

## 8. Never `git stash` a dirty tree to check whether an issue is pre-existing

**Mistake (near-miss)**: To verify a lint error predated my edits, I ran `git stash` + `git stash pop` — the tree also held the user's unrelated uncommitted work (icons, other routes). A pop conflict would have entangled or lost their changes.

**Rule**:
- To compare against the last commit, read it directly: `git show HEAD:path/to/file` (pipe to grep/diff). Zero mutation, zero risk.
- Reserve `stash` for my own short-lived work, never a shared/dirty tree.

## 9. A theme direction approved in the abstract can die on first render — ship one screen first

**Mistake**: User approved "vivid candy gradient on the visitor page, dark everywhere else" from a written proposal. Built it across the whole viral loop; on first real screenshot the split felt like a different app and was reverted to dark-base + accents.

**Rule**:
- For any *visual direction fork* (theme split, new palette, new type scale), implement the smallest visible slice and get eyes on a real render before propagating.
- Be suspicious of two-theme splits when the same user crosses both sides in one session (owner ↔ visitor): bias to one base theme + accent-level differentiation.
- Structure styling as a variant/lookup map from the start — this correction was a repaint of ~40 class strings, not a rebuild, because dark/candy never forked structurally.

## 10. Never run `next build` while the user's dev server is running on the same .next

**Mistake**: Ran `npx next build` for verification while `next dev` was live. The shared `.next` dir corrupted the dev server's Tailwind scan — it kept emitting stale CSS with new JS, making the feature look broken (unstyled textarea, missing gradient) and costing a debugging round-trip.

**Rule**:
- Before any `next build`, check for a running dev server (`ps aux | grep "next dev"`). If one is running: skip the build — `tsc --noEmit` + eslint are safe verification; or ask the user to stop the server first.
- Symptom signature: new markup/copy visible but new classes unstyled; compiled CSS chunk timestamps newer than source edits yet missing the new rules → clobbered dev cache, fix with stop + `rm -rf .next` + restart.
