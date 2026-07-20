import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';

/// Re-emits Supabase auth changes so dependent providers rebuild.
final authStateProvider = StreamProvider<AuthState>(
  (ref) => Supabase.instance.client.auth.onAuthStateChange,
);

final sessionProvider = Provider<Session?>((ref) {
  // Rebuild on every auth event; read the current session directly.
  ref.watch(authStateProvider);
  return Supabase.instance.client.auth.currentSession;
});

final currentUserProvider = Provider<User?>((ref) {
  ref.watch(authStateProvider);
  return Supabase.instance.client.auth.currentUser;
});

/// True when there is a session belonging to a REAL (non-anonymous) account.
/// Anonymous visitor sessions are treated as signed-out for owner surfaces,
/// mirroring the web's gating rules.
final isSignedInOwnerProvider = Provider<bool>((ref) {
  final user = ref.watch(currentUserProvider);
  return user != null && !(user.isAnonymous);
});

class OwnedRoom {
  const OwnedRoom({
    required this.id,
    required this.slug,
    required this.displayName,
    required this.needsOnboarding,
  });

  final String id;
  final String slug;
  final String displayName;
  final bool needsOnboarding;

  OwnedRoom copyWith({String? slug, String? displayName, bool? needsOnboarding}) {
    return OwnedRoom(
      id: id,
      slug: slug ?? this.slug,
      displayName: displayName ?? this.displayName,
      needsOnboarding: needsOnboarding ?? this.needsOnboarding,
    );
  }

  static OwnedRoom fromJson(Map<String, dynamic> json) => OwnedRoom(
        id: json['id'] as String,
        slug: json['slug'] as String,
        displayName: (json['display_name'] as String?) ?? 'Anonymous',
        needsOnboarding: (json['needs_onboarding'] as bool?) ?? false,
      );
}

/// The signed-in user's own room, provisioned idempotently via
/// POST /api/rooms/provision (the mobile counterpart of the web's
/// /auth/callback room creation). Null when signed out / anonymous.
class OwnedRoomNotifier extends AsyncNotifier<OwnedRoom?> {
  @override
  Future<OwnedRoom?> build() async {
    final signedIn = ref.watch(isSignedInOwnerProvider);
    if (!signedIn) return null;

    final api = ref.watch(apiClientProvider);
    final json = await api.post('/api/rooms/provision') as Map<String, dynamic>;
    return OwnedRoom.fromJson(json);
  }

  /// Apply a local update after a successful PATCH (rename/slug/onboarding).
  void updateLocal(OwnedRoom room) {
    state = AsyncData(room);
  }

  Future<void> refresh() async {
    ref.invalidateSelf();
    await future;
  }
}

final ownedRoomProvider =
    AsyncNotifierProvider<OwnedRoomNotifier, OwnedRoom?>(OwnedRoomNotifier.new);

/// Signs out locally (same scope the web profile screen uses).
Future<void> signOutLocal() =>
    Supabase.instance.client.auth.signOut(scope: SignOutScope.local);
