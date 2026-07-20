import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'features/auth/session_providers.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/auth/welcome_screen.dart';
import 'features/chat/thread_screen.dart';
import 'features/help/help_screen.dart';
import 'features/inbox/inbox_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/sent/sent_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/shell/app_shell.dart';
import 'features/visitor/visitor_room_screen.dart';

/// Notifies go_router whenever Supabase auth state changes.
class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh() {
    _sub = Supabase.instance.client.auth.onAuthStateChange.listen((_) {
      notifyListeners();
    });
  }
  late final StreamSubscription<AuthState> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

/// Paths that require a real (non-anonymous) account, mirroring the web's
/// gating: anonymous sessions are treated as signed-out for owner surfaces.
bool _isOwnerPath(String path) =>
    path == '/inbox' ||
    path.startsWith('/inbox/') ||
    path == '/profile' ||
    path == '/settings' ||
    path == '/welcome';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefresh();
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/inbox',
    refreshListenable: refresh,
    redirect: (context, state) {
      final user = Supabase.instance.client.auth.currentUser;
      final signedInOwner = user != null && !user.isAnonymous;
      final path = state.uri.path;

      if (!signedInOwner && _isOwnerPath(path)) {
        final next = Uri.encodeComponent(state.uri.toString());
        return '/signin?next=$next';
      }
      if (signedInOwner && path == '/signin') {
        final next = state.uri.queryParameters['next'];
        // Only same-app relative destinations (defense in depth, same rule
        // as the web callback).
        if (next != null && next.startsWith('/') && !next.startsWith('//')) {
          return next;
        }
        return '/inbox';
      }
      return null;
    },
    routes: [
      GoRoute(path: '/', redirect: (_, _) => '/inbox'),
      GoRoute(
        path: '/signin',
        builder: (context, state) => SignInScreen(
          next: state.uri.queryParameters['next'],
        ),
      ),
      GoRoute(
        path: '/welcome',
        builder: (context, state) => const WelcomeScreen(),
      ),
      GoRoute(
        path: '/help',
        builder: (context, state) => const HelpScreen(),
      ),
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      // Owner thread outside the shell (full-screen chat, no tab bar),
      // matching the web where the thread replaces the app shell.
      GoRoute(
        path: '/inbox/:conversationId',
        builder: (context, state) => ThreadScreen(
          conversationId: state.pathParameters['conversationId']!,
        ),
      ),
      // Visitor chat for someone else's room (deep link target).
      GoRoute(
        path: '/room/:slug',
        builder: (context, state) => VisitorRoomScreen(
          slug: state.pathParameters['slug']!,
        ),
      ),
      // Bottom-tab shell: Inbox / Sent / Profile (mirrors web BottomNav).
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/inbox',
              builder: (context, state) => const InboxScreen(),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/sent',
              builder: (context, state) => const SentScreen(),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const ProfileScreen(),
            ),
          ]),
        ],
      ),
    ],
  );
});

/// Maps a wolow.app web URL (deep link / push tap) to an in-app location.
///
///   https://wolow.app/{slug}                  -> /room/{slug} (visitor chat)
///   https://wolow.app/{slug}/inbox            -> /inbox (owner)
///   https://wolow.app/{slug}/inbox/{convId}   -> /inbox/{convId}
///   /sent, /profile, /settings, /help         -> same path
String? mapWebUrlToLocation(Uri uri) {
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.isEmpty) return '/';

  const passthrough = {'sent', 'profile', 'settings', 'help', 'welcome'};
  if (segments.length == 1 && passthrough.contains(segments[0])) {
    return '/${segments[0]}';
  }

  // Never intercept API/auth/static paths.
  const ignored = {'api', 'auth', '_next', '.well-known'};
  if (ignored.contains(segments[0])) return null;

  if (segments.length == 1) return '/room/${segments[0]}';
  if (segments.length >= 2 && segments[1] == 'inbox') {
    return segments.length >= 3 ? '/inbox/${segments[2]}' : '/inbox';
  }
  return null;
}

/// Riverpod-independent access for auth flows that need the router's
/// current session-derived room state.
extension OwnedRoomX on WidgetRef {
  AsyncValue<OwnedRoom?> get ownedRoom => watch(ownedRoomProvider);
}
