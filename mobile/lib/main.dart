import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/env.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  Env.validate();

  await Supabase.initialize(
    url: Env.supabaseUrl,
    publishableKey: Env.supabaseAnonKey,
    authOptions: const FlutterAuthClientOptions(
      // Native token sign-in (signInWithIdToken) + anonymous sessions; the
      // browser PKCE flow is only used for linkIdentity (save-chat upgrade).
      authFlowType: AuthFlowType.pkce,
    ),
  );

  runApp(const ProviderScope(child: WolowApp()));
}
