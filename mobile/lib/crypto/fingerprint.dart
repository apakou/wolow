/// Human-readable fingerprints for RSA public keys.
/// Port of src/lib/crypto/fingerprint.ts: SHA-256 over `"{n}|{e}"`,
/// 16-bit picks into 4 word lists, joined with hyphens.
library;

import 'dart:convert';

import 'package:webcrypto/webcrypto.dart';

import 'wordlist.dart';

String _pickWord(List<String> list, List<int> bytes, int offset) {
  final idx = ((bytes[offset] << 8) | bytes[offset + 1]) % list.length;
  return list[idx];
}

/// `{adjective}-{creature}-{noun}-{verb}`, e.g. `sunny-otter-velvet-soars`.
Future<String> fingerprintPublicKey(Map<String, dynamic> jwk) async {
  final n = jwk['n'];
  final e = jwk['e'];
  if (n is! String || e is! String) {
    throw ArgumentError('Invalid public JWK: missing n or e');
  }
  final digest = await Hash.sha256.digestBytes(utf8.encode('$n|$e'));
  return [
    _pickWord(fingerprintAdjectives, digest, 0),
    _pickWord(fingerprintCreatures, digest, 2),
    _pickWord(fingerprintNouns, digest, 4),
    _pickWord(fingerprintVerbs, digest, 6),
  ].join('-').toLowerCase();
}

/// Derive a public JWK from a private RSA-OAEP JWK (strips private fields).
/// Field-for-field identical to the web's publicJwkFromPrivate.
Map<String, dynamic> publicJwkFromPrivate(Map<String, dynamic> privateJwk) => {
      'kty': privateJwk['kty'],
      'n': privateJwk['n'],
      'e': privateJwk['e'],
      'alg': privateJwk['alg'],
      'ext': true,
      'key_ops': ['encrypt'],
    };
