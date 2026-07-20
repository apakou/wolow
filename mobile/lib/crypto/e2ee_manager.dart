/// E2EE orchestration port of use-e2ee.ts implementing the chat's
/// MessageCipher boundary.
///
/// Load-bearing rules (do not weaken, see tasks/lessons.md):
///  - Fetch server keys FIRST; never generate a fresh key when the server
///    already holds one (would orphan all prior messages).
///  - Server unreachable + local key -> decrypt-only degraded state.
///  - Local key missing while server has an owner key -> restore-required.
///  - Re-upload of a different owner key without force_rotate -> 409 ->
///    conflict-restore-required.
///  - Re-fetch the owner key before EVERY send (post-rotation safety).
///  - Poll every 5s until both keys exist.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/api/api_client.dart';
import '../features/chat/chat_controller.dart';
import '../features/chat/models.dart';
import 'envelope.dart' as envelope;
import 'key_generation.dart';
import 'key_storage.dart' as storage;
import 'keys_api.dart';

class E2eeManager extends ChangeNotifier implements MessageCipher {
  E2eeManager({
    required KeysApi keysApi,
    required this.slug,
    required this.conversationId,
    required this.isOwnerView,
  }) : _keysApi = keysApi;

  final KeysApi _keysApi;
  final String slug;
  final String conversationId;
  final bool isOwnerView;

  ConversationKeys? _keys;
  Timer? _pollTimer;
  bool _disposed = false;

  bool _ready = false;
  bool _keyLoaded = false;
  String? _setupError;

  String get _keyId => isOwnerView ? 'room:$slug' : 'conv:$conversationId';
  String get _role => isOwnerView ? 'owner' : 'visitor';

  @override
  bool get cryptoAvailable => true;
  @override
  bool get ready => _ready;
  @override
  bool get keyLoaded => _keyLoaded;
  @override
  bool get ownerKeyOnServer => _keys?.ownerPublicKey != null;
  @override
  bool get visitorKeyOnServer => _keys?.visitorPublicKey != null;
  @override
  String? get setupError => _setupError;

  @override
  void dispose() {
    _disposed = true;
    _pollTimer?.cancel();
    super.dispose();
  }

  void _update(void Function() mutate) {
    if (_disposed) return;
    mutate();
    notifyListeners();
  }

  Future<void> init() async {
    try {
      // 1. Server keys first (retry once on transient failure; 404 = final).
      ConversationKeys? serverKeys;
      Object? fetchError;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          serverKeys =
              await _keysApi.fetchConversationKeys(slug, conversationId);
          fetchError = null;
          break;
        } catch (err) {
          fetchError = err;
          if (err is ApiException && err.statusCode == 404) break;
          await Future<void>.delayed(const Duration(milliseconds: 400));
        }
      }

      // 2. Existing local private key?
      var existingPrivateKey = await storage.getPrivateKey(_keyId);

      if (serverKeys == null) {
        if (existingPrivateKey != null) {
          // Degrade to decrypt-only rather than generating or hard-erroring.
          _update(() {
            _ready = false;
            _keyLoaded = true;
            _setupError = null;
          });
          _startPolling();
          return;
        }
        _update(() {
          _ready = false;
          _keyLoaded = false;
          _setupError = fetchError?.toString() ?? 'Failed to fetch public keys';
        });
        return;
      }

      // 3. No local key: decide whether generating is safe.
      if (existingPrivateKey == null) {
        final serverHasMyKey = isOwnerView
            ? serverKeys.ownerPublicKey != null
            : serverKeys.visitorPublicKey != null;
        if (isOwnerView && serverHasMyKey) {
          // The owner's real key lives on another device refuse to rotate.
          _keys = serverKeys;
          _update(() {
            _ready = false;
            _keyLoaded = false;
            _setupError = 'owner_key_missing_restore_required';
          });
          return;
        }
        // Legit first-time: generate, upload FIRST, then store (web order).
        final pair = await generateKeyPair();
        if (isOwnerView) {
          await _keysApi.uploadOwnerPublicKey(slug, pair.publicJwk);
        } else {
          await _keysApi.uploadVisitorPublicKey(
              slug, conversationId, pair.publicJwk);
        }
        await storage.storePrivateKey(_keyId, pair.privateJwk);
        existingPrivateKey = pair.privateJwk;
      }

      _keys = serverKeys;
      _update(() => _keyLoaded = true);

      // 4. Re-fetch (we may have just uploaded ours).
      var keys = await _keysApi.fetchConversationKeys(slug, conversationId);
      _keys = keys;

      // 5. Local key exists but missing on server: re-upload (409 = another
      //    device owns the server key -> conflict restore-required).
      final myKeyMissing = isOwnerView
          ? keys.ownerPublicKey == null
          : keys.visitorPublicKey == null;
      if (myKeyMissing) {
        final publicJwk = {
          'kty': existingPrivateKey['kty'],
          'n': existingPrivateKey['n'],
          'e': existingPrivateKey['e'],
          'alg': existingPrivateKey['alg'],
          'ext': true,
          'key_ops': ['encrypt'],
        };
        try {
          if (isOwnerView) {
            await _keysApi.uploadOwnerPublicKey(slug, publicJwk);
          } else {
            await _keysApi.uploadVisitorPublicKey(
                slug, conversationId, publicJwk);
          }
          keys = await _keysApi.fetchConversationKeys(slug, conversationId);
          _keys = keys;
        } on OwnerKeyConflictException {
          _update(() {
            _ready = false;
            _keyLoaded = true;
            _setupError = 'owner_key_conflict_restore_required';
          });
          return;
        }
      }

      _update(() {
        _ready = keys.bothPresent;
        _setupError = null;
      });
      _startPolling();
    } catch (err) {
      _update(() {
        _ready = false;
        _keyLoaded = false;
        _setupError = err.toString();
      });
    }
  }

  /// Poll every 5s for the other party's key until both exist (web parity).
  void _startPolling() {
    if (_ready || _disposed) return;
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (timer) async {
      if (_disposed || _ready) {
        timer.cancel();
        return;
      }
      try {
        final keys = await _keysApi.fetchConversationKeys(slug, conversationId);
        _keys = keys;
        _update(() {
          if (keys.bothPresent) {
            _ready = true;
            _keyLoaded = true;
            timer.cancel();
          }
        });
      } catch (_) {
        // Poll retries automatically.
      }
    });
  }

  Future<void> refreshKeys() async {
    try {
      final keys = await _keysApi.fetchConversationKeys(slug, conversationId);
      _keys = keys;
      _update(() {
        _ready = keys.bothPresent;
        _keyLoaded = true;
      });
    } catch (_) {
      // Silent retry on next send.
    }
  }

  @override
  Future<String?> encrypt(String plaintext) async {
    // Re-fetch the owner key before every send: a stale cached key after a
    // force-rotate would encrypt messages the owner can never read.
    try {
      _keys = await _keysApi.fetchConversationKeys(slug, conversationId);
    } catch (_) {
      // Fall back to cache.
    }

    if (!(_keys?.bothPresent ?? false)) {
      await refreshKeys();
      if (!(_keys?.bothPresent ?? false)) return null; // plaintext fallback
    }

    return envelope.encryptMessage(
      plaintext,
      _keys!.ownerPublicKey!,
      _keys!.visitorPublicKey!,
    );
  }

  @override
  Future<({String? decrypted, DecryptError? error})> decrypt(
      String encryptedPayload) async {
    final privateKey = await storage.getPrivateKey(_keyId);
    if (privateKey == null) {
      return (
        decrypted: null,
        error: const DecryptError(DecryptErrorReason.noKey,
            'Private key not found on this device'),
      );
    }
    try {
      final plain =
          await envelope.decryptMessage(encryptedPayload, privateKey, _role);
      return (decrypted: plain, error: null);
    } on envelope.DecryptException catch (e) {
      return (decrypted: null, error: e.toError());
    } catch (e) {
      return (
        decrypted: null,
        error: DecryptError(DecryptErrorReason.unknown, e.toString()),
      );
    }
  }
}

/// In-flight dedupe for owner key pre-generation (inbox open), mirroring the
/// module-level map in OwnerInbox.tsx.
final _ownerKeyEnsures = <String, Future<void>>{};

/// Ensure the owner has a keypair as soon as the inbox opens, so visitors
/// can start encrypted conversations immediately. Safe under the same rules
/// as init(): never generates when the server already holds a key.
Future<void> ensureOwnerKey(KeysApi keysApi, String slug) {
  return _ownerKeyEnsures.putIfAbsent(slug, () async {
    try {
      final serverKey = await keysApi.fetchOwnerKey(slug);
      final local = await storage.getPrivateKey('room:$slug');
      if (serverKey != null) return; // server key exists; init() handles rest
      if (local != null) {
        // Local key but no server key: re-publish the public part.
        final publicJwk = {
          'kty': local['kty'],
          'n': local['n'],
          'e': local['e'],
          'alg': local['alg'],
          'ext': true,
          'key_ops': ['encrypt'],
        };
        try {
          await keysApi.uploadOwnerPublicKey(slug, publicJwk);
        } on OwnerKeyConflictException {
          // Another device raced us; init() will surface restore UI.
        }
        return;
      }
      final pair = await generateKeyPair();
      await keysApi.uploadOwnerPublicKey(slug, pair.publicJwk);
      await storage.storePrivateKey('room:$slug', pair.privateJwk);
    } catch (_) {
      // Non-fatal: the conversation-scoped init() retries with full UX.
    } finally {
      _ownerKeyEnsures.remove(slug);
    }
  });
}
