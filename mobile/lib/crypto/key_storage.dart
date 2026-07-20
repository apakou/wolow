/// Private key storage in the platform keystore (Keychain / Android
/// Keystore-backed storage), replacing the web's IndexedDB `wolow-e2ee` DB.
///
/// Same key ids as the web: `room:{slug}` (owner), `conv:{conversationId}`
/// (visitor). Values are the private JWK as JSON.
library;

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _storage = FlutterSecureStorage();

String _storageKey(String keyId) => 'wolow-e2ee/$keyId';

Future<void> storePrivateKey(String keyId, Map<String, dynamic> privateJwk) =>
    _storage.write(key: _storageKey(keyId), value: jsonEncode(privateJwk));

Future<Map<String, dynamic>?> getPrivateKey(String keyId) async {
  final raw = await _storage.read(key: _storageKey(keyId));
  if (raw == null) return null;
  try {
    return jsonDecode(raw) as Map<String, dynamic>;
  } catch (_) {
    return null;
  }
}

Future<void> deletePrivateKey(String keyId) =>
    _storage.delete(key: _storageKey(keyId));
