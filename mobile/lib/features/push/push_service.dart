import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/env.dart';

final pushServiceProvider = Provider<PushService>((ref) {
  final service = PushService(ref.watch(apiClientProvider));
  ref.onDispose(service.dispose);
  return service;
});

enum PushResult { subscribed, denied, failed, unconfigured }

/// FCM push registration, the mobile counterpart of the web's
/// use-push-notifications hook. Server side: POST /push-subscription with
/// `kind: "fcm"` (token in `endpoint`); delivery via firebase-admin in
/// src/lib/push-notify.ts.
///
/// Entirely env-gated: without FIREBASE_* dart-defines the app runs with
/// push disabled (never a dead-end, tasks/lessons.md).
class PushService {
  PushService(this._api);

  final ApiClient _api;

  static bool _initialized = false;
  StreamSubscription<String>? _tokenRefreshSub;
  String? _lastRegisteredSlug;
  String? _lastConversationId;

  static bool get isConfigured => Env.firebaseConfigured;

  static Future<bool> ensureInitialized() async {
    if (!isConfigured) return false;
    if (_initialized) return true;
    try {
      await Firebase.initializeApp(
        options: FirebaseOptions(
          apiKey: Env.firebaseApiKey,
          appId: Env.firebaseAppId,
          messagingSenderId: Env.firebaseSenderId,
          projectId: Env.firebaseProjectId,
        ),
      );
      _initialized = true;
      return true;
    } catch (e) {
      debugPrint('[push] Firebase init failed: $e');
      return false;
    }
  }

  /// Permission states, handled explicitly (tasks/lessons.md):
  /// - notDetermined -> OS prompt via requestPermission
  /// - authorized/provisional -> silent (re-)registration
  /// - denied -> return denied; UI shows a passive settings hint, no modal
  Future<PushResult> subscribe({
    required String slug,
    String? conversationId,
  }) async {
    if (!await ensureInitialized()) return PushResult.unconfigured;

    try {
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        return PushResult.denied;
      }

      final token = await messaging.getToken();
      if (token == null) return PushResult.failed;

      await _register(slug, token, conversationId);

      _lastRegisteredSlug = slug;
      _lastConversationId = conversationId;
      _tokenRefreshSub ??= messaging.onTokenRefresh.listen((fresh) {
        final s = _lastRegisteredSlug;
        if (s != null) {
          _register(s, fresh, _lastConversationId).catchError((_) {});
        }
      });

      return PushResult.subscribed;
    } catch (e) {
      debugPrint('[push] subscribe failed: $e');
      return PushResult.failed;
    }
  }

  /// Silently re-subscribe when permission was already granted (no prompt).
  Future<void> resubscribeIfAuthorized({
    required String slug,
    String? conversationId,
  }) async {
    if (!await ensureInitialized()) return;
    try {
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.getNotificationSettings();
      if (settings.authorizationStatus != AuthorizationStatus.authorized &&
          settings.authorizationStatus != AuthorizationStatus.provisional) {
        return;
      }
      final token = await messaging.getToken();
      if (token != null) await _register(slug, token, conversationId);
      _lastRegisteredSlug = slug;
      _lastConversationId = conversationId;
    } catch (_) {
      // Silent path by definition.
    }
  }

  Future<void> _register(
      String slug, String token, String? conversationId) async {
    await _api.post(
      '/api/rooms/${Uri.encodeComponent(slug)}/push-subscription',
      body: {
        'kind': 'fcm',
        'endpoint': token,
        'conversation_id': ?conversationId,
      },
    );
  }

  Future<void> unsubscribe(String slug) async {
    if (!await ensureInitialized()) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await _api.delete(
          '/api/rooms/${Uri.encodeComponent(slug)}/push-subscription',
          body: {'endpoint': token},
        );
        await FirebaseMessaging.instance.deleteToken();
      }
    } catch (_) {
      // Best-effort.
    }
  }

  void dispose() {
    _tokenRefreshSub?.cancel();
    _tokenRefreshSub = null;
  }
}

/// Notification-tap routing: FCM `data.url` carries a web-format path
/// (/{slug} or /{slug}/inbox/{conversationId}), reusing the deep-link mapper.
Future<void> wirePushTapNavigation(
    void Function(String webPath) navigate) async {
  if (!await PushService.ensureInitialized()) return;

  // App launched from a terminated state by a notification tap.
  final initial = await FirebaseMessaging.instance.getInitialMessage();
  final initialUrl = initial?.data['url'] as String?;
  if (initialUrl != null) navigate(initialUrl);

  // App brought to foreground by a tap.
  FirebaseMessaging.onMessageOpenedApp.listen((message) {
    final url = message.data['url'] as String?;
    if (url != null) navigate(url);
  });

  // Foreground pushes are intentionally NOT displayed: the open chat/inbox
  // updates in realtime already (web SW parity: skip when page visible).
}
