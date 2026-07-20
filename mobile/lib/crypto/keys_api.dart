/// Public-key API access, port of upload-public-key.ts / fetch-public-key.ts.
library;

import '../core/api/api_client.dart';
import 'fingerprint.dart';

class ConversationKeys {
  ConversationKeys({this.ownerPublicKey, this.visitorPublicKey});

  Map<String, dynamic>? ownerPublicKey;
  Map<String, dynamic>? visitorPublicKey;

  bool get bothPresent => ownerPublicKey != null && visitorPublicKey != null;
}

/// Server already holds a DIFFERENT owner key and force_rotate wasn't set.
/// Callers surface the "restore your backup" UI, never overwrite silently.
class OwnerKeyConflictException implements Exception {
  OwnerKeyConflictException(this.localFingerprint, this.serverFingerprint);
  final String localFingerprint;
  final String? serverFingerprint;
}

class KeysApi {
  KeysApi(this._api);

  final ApiClient _api;

  Future<ConversationKeys> fetchConversationKeys(
      String slug, String conversationId) async {
    final data = await _api.get(
      '/api/rooms/${Uri.encodeComponent(slug)}/keys',
      query: {'conversation_id': conversationId},
    ) as Map<String, dynamic>;
    return ConversationKeys(
      ownerPublicKey: data['owner_public_key'] is Map<String, dynamic>
          ? data['owner_public_key'] as Map<String, dynamic>
          : null,
      visitorPublicKey: data['visitor_public_key'] is Map<String, dynamic>
          ? data['visitor_public_key'] as Map<String, dynamic>
          : null,
    );
  }

  /// Owner-key GET without a conversation (inbox pre-generation path).
  Future<Map<String, dynamic>?> fetchOwnerKey(String slug) async {
    final data = await _api.get(
      '/api/rooms/${Uri.encodeComponent(slug)}/keys',
    ) as Map<String, dynamic>;
    return data['owner_public_key'] is Map<String, dynamic>
        ? data['owner_public_key'] as Map<String, dynamic>
        : null;
  }

  Future<void> uploadOwnerPublicKey(
    String slug,
    Map<String, dynamic> publicJwk, {
    bool forceRotate = false,
  }) async {
    final fingerprint = await fingerprintPublicKey(publicJwk);
    try {
      await _api.put(
        '/api/rooms/${Uri.encodeComponent(slug)}/keys',
        body: {
          'public_key': publicJwk,
          'fingerprint': fingerprint,
          'force_rotate': forceRotate,
        },
      );
    } on ApiException catch (e) {
      if (e.statusCode == 409) {
        throw OwnerKeyConflictException(
          fingerprint,
          e.body?['server_fingerprint'] as String?,
        );
      }
      rethrow;
    }
  }

  Future<void> uploadVisitorPublicKey(
    String slug,
    String conversationId,
    Map<String, dynamic> publicJwk,
  ) async {
    await _api.put(
      '/api/rooms/${Uri.encodeComponent(slug)}/conversations/keys',
      body: {'conversation_id': conversationId, 'public_key': publicJwk},
    );
  }
}
