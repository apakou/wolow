/// Hybrid message encryption, byte-compatible with the web client
/// (src/lib/crypto/encrypt-message.ts / decrypt-message.ts):
///
/// AES-256-GCM over the plaintext (12-byte IV, tag appended to ct),
/// the AES key RSA-OAEP-wrapped once per role. Envelope (JSON string):
/// `{"v":1,"ct":b64,"iv":b64,"keys":{"owner":b64,"visitor":b64}}`
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:webcrypto/webcrypto.dart';

import '../features/chat/models.dart' show DecryptError, DecryptErrorReason;

/// Thrown with the same structured reasons as the web's DecryptError.
class DecryptException implements Exception {
  DecryptException(this.reason, this.message);
  final DecryptErrorReason reason;
  final String message;

  DecryptError toError() => DecryptError(reason, message);

  @override
  String toString() => 'DecryptException(${reason.name}): $message';
}

Future<String> encryptMessage(
  String plaintext,
  Map<String, dynamic> ownerPublicJwk,
  Map<String, dynamic> visitorPublicJwk,
) async {
  // 1. Ephemeral AES-256-GCM key.
  final aesKey = await AesGcmSecretKey.generateKey(256);
  final rawAesKey = await aesKey.exportRawKey();

  // 2. Random 12-byte IV.
  final iv = Uint8List(12);
  fillRandomBytes(iv);

  // 3. Encrypt (WebCrypto semantics: 128-bit tag appended to ciphertext).
  final cipher =
      await aesKey.encryptBytes(utf8.encode(plaintext), iv, tagLength: 128);

  // 4. Wrap the AES key for both parties.
  final ownerKey =
      await RsaOaepPublicKey.importJsonWebKey(ownerPublicJwk, Hash.sha256);
  final visitorKey =
      await RsaOaepPublicKey.importJsonWebKey(visitorPublicJwk, Hash.sha256);
  final wrappedForOwner = await ownerKey.encryptBytes(rawAesKey);
  final wrappedForVisitor = await visitorKey.encryptBytes(rawAesKey);

  return jsonEncode({
    'v': 1,
    'ct': base64Encode(cipher),
    'iv': base64Encode(iv),
    'keys': {
      'owner': base64Encode(wrappedForOwner),
      'visitor': base64Encode(wrappedForVisitor),
    },
  });
}

Future<String> decryptMessage(
  String encryptedPayload,
  Map<String, dynamic> privateJwk,
  String role, // 'owner' | 'visitor'
) async {
  Map<String, dynamic> envelope;
  try {
    envelope = jsonDecode(encryptedPayload) as Map<String, dynamic>;
  } catch (_) {
    throw DecryptException(
        DecryptErrorReason.badEnvelope, 'Encrypted payload is not valid JSON');
  }

  if (envelope['v'] != 1) {
    throw DecryptException(DecryptErrorReason.badEnvelope,
        'Unsupported encryption version: ${envelope['v']}');
  }

  final keys = envelope['keys'];
  final wrapped = keys is Map<String, dynamic> ? keys[role] : null;
  if (wrapped is! String) {
    throw DecryptException(DecryptErrorReason.wrongRole,
        'Envelope has no wrapped key for role "$role"');
  }

  RsaOaepPrivateKey rsaPrivateKey;
  try {
    rsaPrivateKey =
        await RsaOaepPrivateKey.importJsonWebKey(privateJwk, Hash.sha256);
  } catch (e) {
    throw DecryptException(
        DecryptErrorReason.noKey, 'Failed to import private key: $e');
  }

  // Unwrap failure almost always means the message was encrypted with a
  // different (older) key: surface as key_rotated (web parity).
  Uint8List rawAesKey;
  try {
    rawAesKey = await rsaPrivateKey.decryptBytes(base64Decode(wrapped));
  } catch (_) {
    throw DecryptException(DecryptErrorReason.keyRotated,
        'Could not unwrap AES key message was likely encrypted with an older key');
  }

  try {
    final aesKey = await AesGcmSecretKey.importRawKey(rawAesKey);
    final plain = await aesKey.decryptBytes(
      base64Decode(envelope['ct'] as String),
      base64Decode(envelope['iv'] as String),
      tagLength: 128,
    );
    return utf8.decode(plain);
  } catch (_) {
    throw DecryptException(DecryptErrorReason.badEnvelope,
        'AES-GCM decryption failed (corrupted ciphertext)');
  }
}
