/// Build-time configuration via --dart-define.
///
/// Example:
///   flutter run \
///     --dart-define=SUPABASE_URL=https://xyz.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=eyJ... \
///     --dart-define=API_BASE_URL=https://wolow.app
library;

class Env {
  Env._();

  /// Supabase project URL (auth + realtime connect directly).
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');

  /// Supabase anon (publishable) key.
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  /// Deployed Next.js app: the business-logic API the mobile app calls with
  /// `Authorization: Bearer <access_token>`.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://wolow.app',
  );

  /// Public web origin used when building share links (wolow.app/{slug}).
  static const appUrl = String.fromEnvironment(
    'APP_URL',
    defaultValue: 'https://wolow.app',
  );

  /// Server client ID (Web OAuth client) required by native Google sign-in
  /// so Supabase can verify the ID token audience.
  static const googleWebClientId = String.fromEnvironment(
    'GOOGLE_WEB_CLIENT_ID',
  );

  /// iOS OAuth client ID for native Google sign-in.
  static const googleIosClientId = String.fromEnvironment(
    'GOOGLE_IOS_CLIENT_ID',
  );

  // Firebase (FCM push). All four must be set for push to activate;
  // otherwise the app runs fine without notifications.
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
  static const firebaseSenderId =
      String.fromEnvironment('FIREBASE_SENDER_ID');
  static const firebaseProjectId =
      String.fromEnvironment('FIREBASE_PROJECT_ID');

  static bool get firebaseConfigured =>
      firebaseApiKey.isNotEmpty &&
      firebaseAppId.isNotEmpty &&
      firebaseSenderId.isNotEmpty &&
      firebaseProjectId.isNotEmpty;

  /// Fails fast at startup with an actionable message instead of opaque
  /// network errors later.
  static void validate() {
    final missing = <String>[
      if (supabaseUrl.isEmpty) 'SUPABASE_URL',
      if (supabaseAnonKey.isEmpty) 'SUPABASE_ANON_KEY',
    ];
    if (missing.isNotEmpty) {
      throw StateError(
        'Missing required --dart-define values: ${missing.join(', ')}. '
        'See mobile/README.md for run instructions.',
      );
    }
  }
}
