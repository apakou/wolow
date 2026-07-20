/// RSA-OAEP-4096/SHA-256 key generation, matching the web client's
/// generate-key-pair.ts (extractable JWKs, exponent 65537).
library;

import 'package:webcrypto/webcrypto.dart';

class GeneratedKeyPair {
  const GeneratedKeyPair({required this.publicJwk, required this.privateJwk});
  final Map<String, dynamic> publicJwk;
  final Map<String, dynamic> privateJwk;
}

/// Slow-ish even with BoringSSL (a 4096-bit modulus); callers should show
/// progress UI and never run it on scroll-critical paths.
Future<GeneratedKeyPair> generateKeyPair() async {
  final pair = await RsaOaepPrivateKey.generateKey(
    4096,
    BigInt.from(65537),
    Hash.sha256,
  );
  final privateJwk =
      Map<String, dynamic>.from(await pair.privateKey.exportJsonWebKey());
  final publicJwk =
      Map<String, dynamic>.from(await pair.publicKey.exportJsonWebKey());

  // Normalize to the exact JWK shape the web uploads/stores so envelopes and
  // fingerprints are interchangeable.
  publicJwk['ext'] = true;
  publicJwk['key_ops'] = ['encrypt'];
  privateJwk['ext'] = true;
  privateJwk['key_ops'] = ['decrypt'];

  return GeneratedKeyPair(publicJwk: publicJwk, privateJwk: privateJwk);
}
