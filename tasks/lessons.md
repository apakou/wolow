# Lessons

## 2026-04-18 Verify migrations before claiming "applied"

**Mistake**: Assumed migration 026 was applied to the running database. When the fingerprint-returning GET `/api/rooms/[slug]/keys` route silently returned 404 because the `owner_key_fingerprint` column didn't exist, the original `getRoom()` helper swallowed the Postgres error (`.single()` + ignoring `error`), masking the real cause as "Room not found".

**Rule**:
- Never mark a migration as "applied" without a `SELECT column_name FROM information_schema.columns WHERE ...` verification against the live DB.
- When a Supabase query can legitimately return zero rows AND can fail with an error, use `.maybeSingle()` and always inspect `error` before returning `null`. Propagate the error message (behind a 500 status) so routes fail loudly instead of silently 404-ing.
- Anonymous-token apps with `RLS USING(true)` cannot produce "row missing" from auth issues a 404 always points at either a typo in the slug or a schema/migration mismatch.

## 2026-04-18 Don't swallow DB errors on auth/redirect routes

**Mistake**: The `/auth/callback` route's first-sign-in INSERT into `rooms` was missing the required `owner_token` column. The INSERT silently failed with a NOT-NULL violation, the route caught the error and redirected to `/?auth_error=1` with no logging. The bug went unnoticed for a long time because every existing user already had a row, so the INSERT branch never ran. It only surfaced after wiping the database.

**Rule**:
- Any auth/onboarding route that inserts into a table must `console.error` (or `logError`) the underlying DB error before redirecting. Silent `auth_error=1` redirects hide root causes for weeks.
- When a table has NOT NULL columns with no default (like `owner_token`), grep all INSERT call sites at migration time to confirm every code path supplies the value. Tests for the "first user" path don't exist because seeded test users always have a room.
- Wiping a database is a great way to discover dead-code-path bugs in onboarding flows. Worth doing on a staging DB periodically.

## 2026-04-18 Don't remove resilience when adding safety checks

**Mistake**: When adding a "fetch server keys first, refuse to silently generate" check to `useE2EE`, I made the new upfront `fetchConversationKeys` call non-resilient. Any transient 5xx/network failure now crashed init entirely, where previously the flow was tolerant (generated locally first).

**Rule**:
- When adding a new network call to an init path that previously worked offline-ish, add retry + typed error handling in the same commit.
- For fail-safe paths (e.g. "don't generate a new key without knowing the server state"), if you can't reach the server, prefer degrading to read-only (use local key for decrypt) rather than either (a) silently generating or (b) hard-erroring.
- Always type network errors with HTTP status so callers can distinguish 404 (don't retry) from 5xx/network (retry).

## 2026-04-18 Supabase SSR cookies in Route Handler redirects

**Mistake**: `/auth/callback` called `supabase.auth.exchangeCodeForSession(code)` (which writes session cookies via the `cookies()` adapter) and then returned a freshly-constructed `NextResponse.redirect(...)`. The new response object did not carry the cookies the adapter had set, so the browser never received the `sb-*-auth-token` cookies. The user landed back at `/`, `getUser()` returned null, and `SignInWithGoogle` rendered again creating a silent OAuth login loop. The `/auth/callback` server-side `getUser()` call worked because it read straight from `cookieStore`, masking the bug from local logging.

**Rule**:
- In Route Handlers that exchange auth codes, **construct the redirect `NextResponse` first** and pass a Supabase client whose `cookies.setAll` writes onto **that exact response**. Don't rely on the `next/headers` `cookies()` adapter its writes don't propagate to a new response object you build later.
- If you need to change the redirect destination after the auth exchange, copy cookies from the provisional response onto the new one with `previous.cookies.getAll().forEach(c => next.cookies.set(c))`.
- Symptom signature for this bug: server-side `getUser()` works inside the callback route, but the very next page load is unauthenticated. If you see that, suspect the response-cookie binding before anything else.

## 2026-04-18 Push-notification re-prompt gating

**Mistake**: The "Enable notifications" modal gated on `permission !== "denied"`, which still pops the modal when permission is already `"granted"` but the browser isn't currently subscribed (DB row wiped, new device, PWA reinstall, browser cleared site data). The user already said yes re-asking is annoying and confusing.

**Rule**:
- Only show an "enable notifications" prompt when `Notification.permission === "default"`. That's the *only* state where the user hasn't yet answered the OS-level prompt.
- For `permission === "granted"` but `!isSubscribed`, silently re-subscribe in the background (the OS prompt won't re-appear; `pushManager.subscribe` just works).
- For `permission === "denied"`, don't pop a modal at most show a passive hint in settings explaining how to re-enable in browser preferences.
- Whenever you write a "show this prompt" effect, list the three `NotificationPermission` states explicitly and decide what each does.

## 2026-04-18 Remove stale UX after backend automation

**Mistake**: After moving room creation from a manual user action to automatic provisioning in `/auth/callback`, a "Create your link" link in the empty-state of `/settings` remained pointing back at `/`, which has no creation UI either. Users would click it and end up in a confusing loop.

**Rule**:
- When automating a previously-manual flow, grep the codebase for the old call-to-action copy and either delete it or rewrite it to describe the new automatic behaviour. The empty-state of an auto-created resource should explain *why* the resource is missing, not offer a phantom action.
- Empty-states for auto-provisioned resources usually indicate an error in the provisioning step (here: the callback INSERT failed). Surface that as an error message + recovery hint (sign out / retry), not as a "create" CTA.

## 2026-07-18 CREATE OR REPLACE FUNCTION with new params = overload, not replace

**Mistake**: Migration 026 "extended" `set_owner_public_key` by adding `p_fingerprint` and `p_mark_rotated` params via `CREATE OR REPLACE FUNCTION`. In Postgres a function's identity is its name + argument types, so this *added a second overload* instead of replacing the 019/025 version. PostgREST then rejected every 3-named-arg RPC call with PGRST203 ("Could not choose the best candidate function") → `PUT /api/rooms/[slug]/keys` returned 500 "Failed to store key" in production.

**Rule**:
- When changing a function's parameter list in a migration, `DROP FUNCTION IF EXISTS fn(old, arg, types);` first, in the same migration. `CREATE OR REPLACE` only replaces an *identical* signature.
- When calling Supabase RPCs that have optional/defaulted params, pass **all** params explicitly from app code a fully-named call uniquely selects one candidate and is immune to leftover overloads.
- Symptom signature: RPC worked before a "signature extension" migration, now fails with PGRST203, and `information_schema.routines`/`\df` shows the function name twice.
- Diagnose hosted-DB state cheaply with anon-key REST probes: select the new column filtered by a nil UUID (`?select=col&id=eq.00000000-...`) to check columns, and call the RPC with a nil room id to check function resolution without touching data.

## 8. Never `git stash` a dirty tree to check whether an issue is pre-existing

**Mistake (near-miss)**: To verify a lint error predated my edits, I ran `git stash` + `git stash pop` the tree also held the user's unrelated uncommitted work (icons, other routes). A pop conflict would have entangled or lost their changes.

**Rule**:
- To compare against the last commit, read it directly: `git show HEAD:path/to/file` (pipe to grep/diff). Zero mutation, zero risk.
- Reserve `stash` for my own short-lived work, never a shared/dirty tree.

## 9. A theme direction approved in the abstract can die on first render ship one screen first

**Mistake**: User approved "vivid candy gradient on the visitor page, dark everywhere else" from a written proposal. Built it across the whole viral loop; on first real screenshot the split felt like a different app and was reverted to dark-base + accents.

**Rule**:
- For any *visual direction fork* (theme split, new palette, new type scale), implement the smallest visible slice and get eyes on a real render before propagating.
- Be suspicious of two-theme splits when the same user crosses both sides in one session (owner ↔ visitor): bias to one base theme + accent-level differentiation.
- Structure styling as a variant/lookup map from the start this correction was a repaint of ~40 class strings, not a rebuild, because dark/candy never forked structurally.

## 10. Never run `next build` while the user's dev server is running on the same .next

**Mistake**: Ran `npx next build` for verification while `next dev` was live. The shared `.next` dir corrupted the dev server's Tailwind scan it kept emitting stale CSS with new JS, making the feature look broken (unstyled textarea, missing gradient) and costing a debugging round-trip.

**Rule**:
- Before any `next build`, check for a running dev server (`ps aux | grep "next dev"`). If one is running: skip the build `tsc --noEmit` + eslint are safe verification; or ask the user to stop the server first.
- Symptom signature: new markup/copy visible but new classes unstyled; compiled CSS chunk timestamps newer than source edits yet missing the new rules → clobbered dev cache, fix with stop + `rm -rf .next` + restart.

## 2026-07-18 Feature gated on remote config must degrade, not dead-end

**Mistake**: Shipped anonymous-session sign-in knowing (from a probe) that `enable_anonymous_sign_ins` was still OFF on the hosted project. Until the dashboard toggle was flipped, every visitor hit a generic "oops, something broke" card the exact broken-trust experience the feature was meant to fix. The failure path also conflated "service config unavailable" with "network error" ("Check your connection").

**Rule**:
- When code depends on an external config flag (dashboard toggle, env, remote feature flag) that I cannot flip myself, the flag-off path MUST degrade to the previous working behavior (here: fall back to the Google sign-in screen), never to a dead-end error card. Ship the fallback in the same commit as the feature.
- This also covers the flag-on failure modes automatically (e.g. Supabase's 30/hr/IP anonymous signup limit behaves identically to "disabled").
- Don't reuse a "check your connection" error card for non-network failures; route each failure class to its own recovery action.
- When handing the user a required manual step (dashboard toggle), state it as a blocking prerequisite with the exact click path, and verify with a probe after they confirm.

## 2026-07-20 Snap Flutter cannot build native-asset packages on the host

**Mistake (cost a debugging loop)**: Ran `flutter test` (snap Flutter) with `package:webcrypto` in the tree. The hooks runner compiled BoringSSL with the SYSTEM gcc but the SNAP's bundled `ld`/glibc — gcc-15's LTO plugin failed with `GLIBC_2.33 not found`. Env workarounds (CFLAGS -B, COMPILER_PATH) do not propagate through the snap wrapper.

**Rule**:
- Any Flutter project using native-asset hooks (webcrypto, ffi builders) must use a tarball SDK for host `flutter test`; snap Flutter is only safe for device builds. This repo: `~/flutter/bin/flutter` (documented in mobile/README.md).
- Symptom signature: `CMakeTestCCompiler` fails, error mixes `/usr/libexec/gcc/...` with `/snap/flutter/.../ld`. Don't debug compiler flags — switch SDKs.
- Check `which flutter` + `flutter --version` FIRST when host-side native builds fail; also `flutter config --jdk-dir=/snap/android-studio/current/jbr` when doctor reports no JDK.

## 2026-07-20 `pub add` can resolve years-old package majors — verify what you got

**Mistake**: `flutter pub add file_picker` silently resolved to 3.0.4 (2021-era, pre-AGP-namespace) because of a win32 solver conflict with share_plus 13. Analyze/tests stayed green; it only exploded at `flutter build apk` ("Namespace not specified").

**Rule**:
- After batch `pub add`, read the resolved versions in pubspec.yaml and treat any major that looks old (single digit when pub.dev shows double) as a solver fallback to investigate.
- Desktop-only transitive deps (win32) can force mobile-relevant downgrades; fix by aligning majors (share_plus ^12 + file_picker ^10), not dependency_overrides, unless impossible.
- A Flutter feature isn't "verified" until `flutter build apk` passes — analyze+test don't exercise Gradle/AGP compatibility.

## 2026-07-20 Cross-platform crypto: test with executed golden vectors, not re-read specs

**Pattern that worked (keep doing this)**: For the Dart port of the Web Crypto E2EE, fixtures were generated by RUNNING the web's exact primitives in node (same params verified line-by-line) and asserted in Dart tests — envelope decrypt both roles, backup import, fingerprint equality, fresh-key interop, plus tamper/wrong-key/wrong-role error-reason contracts. This caught zero-drift by construction and proves rotation detection (key_rotated) behavior.

**Rule**: any "must be byte-compatible" port gets an executable golden-vector gate before UI work consumes it; regenerate vectors when the source implementation changes (script lives at mobile/test/generate_crypto_vectors.mjs).

## 2026-07-20 Don't touch a running local Supabase without checking whose schema it is

**Near-miss**: A local Supabase stack was up on 54321 and `supabase db push` was one confirmation away — but the DB belonged to a DIFFERENT project (CRM tables; migration history didn't match). Pushing would have polluted another project's database.

**Rule**: before any migration apply/reset against a local stack, list `pg_tables` + `supabase_migrations.schema_migrations` and confirm they match THIS repo's migrations. A running stack on default ports is shared machine state, not project state.
