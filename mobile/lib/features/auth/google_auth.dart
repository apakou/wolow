import 'package:google_sign_in/google_sign_in.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';

/// Thrown when the user cancels the Google sheet not an error state.
class SignInCancelled implements Exception {}

bool _initialized = false;

Future<void> _ensureInitialized() async {
  if (_initialized) return;
  await GoogleSignIn.instance.initialize(
    clientId: Env.googleIosClientId.isEmpty ? null : Env.googleIosClientId,
    // The Supabase project's Web OAuth client: required so the resulting
    // ID token's audience is accepted by signInWithIdToken.
    serverClientId:
        Env.googleWebClientId.isEmpty ? null : Env.googleWebClientId,
  );
  _initialized = true;
}

/// Native Google sign-in (no browser round-trip):
/// google_sign_in -> ID token -> supabase.auth.signInWithIdToken.
Future<void> signInWithGoogleNative() async {
  await _ensureInitialized();

  final GoogleSignInAccount account;
  try {
    account = await GoogleSignIn.instance.authenticate();
  } on GoogleSignInException catch (e) {
    if (e.code == GoogleSignInExceptionCode.canceled ||
        e.code == GoogleSignInExceptionCode.interrupted) {
      throw SignInCancelled();
    }
    rethrow;
  }

  final idToken = account.authentication.idToken;
  if (idToken == null) {
    throw const AuthException('Google returned no ID token');
  }

  await Supabase.instance.client.auth.signInWithIdToken(
    provider: OAuthProvider.google,
    idToken: idToken,
  );
}
