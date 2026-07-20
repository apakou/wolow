/// `.wolow-key` passphrase-encrypted backups, byte-compatible with the web
/// (src/lib/crypto/export-key.ts / import-key.ts):
///
/// PBKDF2-SHA256 (600k iterations, 16-byte salt) -> AES-256-GCM (12-byte IV)
/// over `JSON.stringify(privateJwk)`. File is JSON v1 with fingerprint/slug.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:webcrypto/webcrypto.dart';

import 'fingerprint.dart';

const wolowKeyVersion = 1;
const pbkdf2Iterations = 600000;
const _saltBytes = 16;
const _ivBytes = 12;

enum ImportErrorReason { badFormat, version, slugMismatch, badPassphrase }

class ImportKeyException implements Exception {
  ImportKeyException(this.reason, this.message);
  final ImportErrorReason reason;
  final String message;

  @override
  String toString() => 'ImportKeyException(${reason.name}): $message';
}

class ExportedKeyFile {
  const ExportedKeyFile({
    required this.json,
    required this.filename,
    required this.fingerprint,
  });

  final String json;
  final String filename;
  final String fingerprint;
}

class ImportedKey {
  const ImportedKey({
    required this.privateJwk,
    required this.publicJwk,
    required this.fingerprint,
    required this.slug,
  });

  final Map<String, dynamic> privateJwk;
  final Map<String, dynamic> publicJwk;
  final String fingerprint;
  final String slug;
}

Future<AesGcmSecretKey> _deriveKey(
    String passphrase, Uint8List salt, int iterations) async {
  final baseKey = await Pbkdf2SecretKey.importRawKey(utf8.encode(passphrase));
  final bits = await baseKey.deriveBits(256, Hash.sha256, salt, iterations);
  return AesGcmSecretKey.importRawKey(bits);
}

Future<ExportedKeyFile> exportWrappedKey(
  Map<String, dynamic> privateJwk,
  String passphrase,
  String slug, {
  DateTime? now,
}) async {
  if (passphrase.length < 12) {
    throw ArgumentError('Passphrase must be at least 12 characters');
  }

  final salt = Uint8List(_saltBytes);
  fillRandomBytes(salt);
  final iv = Uint8List(_ivBytes);
  fillRandomBytes(iv);

  final aesKey = await _deriveKey(passphrase, salt, pbkdf2Iterations);
  final ct = await aesKey.encryptBytes(
      utf8.encode(jsonEncode(privateJwk)), iv,
      tagLength: 128);

  final fingerprint =
      await fingerprintPublicKey(publicJwkFromPrivate(privateJwk));

  final createdAt = (now ?? DateTime.now()).toUtc();
  final file = {
    'v': wolowKeyVersion,
    'kdf': 'PBKDF2-SHA256',
    'iter': pbkdf2Iterations,
    'salt': base64Encode(salt),
    'iv': base64Encode(iv),
    'ct': base64Encode(ct),
    'fingerprint': fingerprint,
    'slug': slug,
    'created_at': createdAt.toIso8601String(),
  };

  final stamp = createdAt.toIso8601String().substring(0, 10);
  return ExportedKeyFile(
    json: const JsonEncoder.withIndent('  ').convert(file),
    filename: 'wolow-$slug-$stamp.wolow-key',
    fingerprint: fingerprint,
  );
}

Future<ImportedKey> importWrappedKey(
  String fileText,
  String passphrase,
  String expectedSlug,
) async {
  Object? parsed;
  try {
    parsed = jsonDecode(fileText);
  } catch (_) {
    throw ImportKeyException(ImportErrorReason.badFormat, 'File is not valid JSON');
  }

  if (parsed is! Map<String, dynamic> ||
      parsed['v'] is! num ||
      parsed['kdf'] is! String ||
      parsed['iter'] is! num ||
      parsed['salt'] is! String ||
      parsed['iv'] is! String ||
      parsed['ct'] is! String ||
      parsed['slug'] is! String) {
    throw ImportKeyException(
        ImportErrorReason.badFormat, 'File is not a Wolow key backup');
  }

  if (parsed['v'] != wolowKeyVersion) {
    throw ImportKeyException(
        ImportErrorReason.version, 'Unsupported backup version: ${parsed['v']}');
  }

  final slug = parsed['slug'] as String;
  if (slug != expectedSlug) {
    throw ImportKeyException(ImportErrorReason.slugMismatch,
        'This backup is for "$slug", not "$expectedSlug"');
  }

  final aesKey = await _deriveKey(
    passphrase,
    base64Decode(parsed['salt'] as String),
    (parsed['iter'] as num).toInt(),
  );

  Uint8List plain;
  try {
    plain = await aesKey.decryptBytes(
      base64Decode(parsed['ct'] as String),
      base64Decode(parsed['iv'] as String),
      tagLength: 128,
    );
  } catch (_) {
    throw ImportKeyException(
        ImportErrorReason.badPassphrase, 'Wrong passphrase or corrupted file');
  }

  Map<String, dynamic> privateJwk;
  try {
    privateJwk = jsonDecode(utf8.decode(plain)) as Map<String, dynamic>;
  } catch (_) {
    throw ImportKeyException(
        ImportErrorReason.badFormat, 'Decrypted contents are not a valid key');
  }

  final publicJwk = publicJwkFromPrivate(privateJwk);
  return ImportedKey(
    privateJwk: privateJwk,
    publicJwk: publicJwk,
    fingerprint: await fingerprintPublicKey(publicJwk),
    slug: slug,
  );
}
