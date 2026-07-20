# Wolow Mobile (Flutter)

Flutter client for Wolow, sharing the same Supabase project and Next.js
business-logic API as the web app in the repo root.

## Architecture

- **supabase_flutter**: auth (native Google + anonymous sessions) and
  realtime chat channels, talking directly to Supabase.
- **Next.js API** (`/api/...` on the deployed web app): messages,
  conversations, keys, reactions, push subscriptions called with
  `Authorization: Bearer <supabase access token>` (see
  `src/lib/supabase/server.ts` in the repo root for the server side).
- **E2EE**: `package:webcrypto` (BoringSSL) byte-compatible with the web
  client's Web Crypto envelope (RSA-OAEP-4096 + AES-256-GCM).

## Toolchain

Use the tarball Flutter SDK (`~/flutter/bin/flutter`, >= 3.44).

The **snap** Flutter cannot run `flutter test` here: `package:webcrypto`
builds a native asset on the host, and the snap's bundled linker/glibc
clashes with the system gcc (GLIBC_2.33 errors). Android/iOS builds are
unaffected, but host tests need the tarball SDK.

## Running

```sh
~/flutter/bin/flutter run \
  --dart-define=SUPABASE_URL=https://<project>.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=<anon key> \
  --dart-define=API_BASE_URL=https://wolow.app \
  --dart-define=APP_URL=https://wolow.app \
  --dart-define=GOOGLE_WEB_CLIENT_ID=<web oauth client id> \
  --dart-define=GOOGLE_IOS_CLIENT_ID=<ios oauth client id>
```

For local backend development point `API_BASE_URL` at your machine
(e.g. `http://192.168.x.x:3000` with `next dev`); Android emulators use
`http://10.0.2.2:3000`.

## One-time platform setup (not yet done)

- **Google sign-in**: create iOS + Android OAuth clients in the Google
  Cloud project already used by Supabase Auth; add the Android client's
  SHA-1; keep the Web client ID as `GOOGLE_WEB_CLIENT_ID` (Supabase
  verifies the ID token audience against it). iOS: add the reversed
  client ID URL scheme to `ios/Runner/Info.plist`.
- **App/Universal Links**: fill the real signing SHA-256 into
  `public/.well-known/assetlinks.json` and the Apple Team ID into
  `public/.well-known/apple-app-site-association` (repo root), then add
  the `applinks:wolow.app` associated domain in Xcode.
- **Push (Phase 6)**: create a Firebase project, add
  `google-services.json` / `GoogleService-Info.plist`, set
  `FIREBASE_SERVICE_ACCOUNT_JSON` on the web deployment.

## Tests

```sh
~/flutter/bin/flutter test
```

`test/parity_vectors.json` is generated from the real web implementation
(see test files for the node one-liners); regenerate it whenever the web
utilities change.
