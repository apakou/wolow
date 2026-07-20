import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wolow/crypto/envelope.dart';
import 'package:wolow/crypto/fingerprint.dart';
import 'package:wolow/crypto/key_backup.dart';
import 'package:wolow/crypto/key_generation.dart';
import 'package:wolow/features/chat/models.dart';

/// THE cross-platform E2EE gate.
///
/// crypto_vectors.json is produced by generate_crypto_vectors.mjs running the
/// web client's exact Web Crypto parameters. If any test here fails, web and
/// mobile cannot read each other's messages or backups do not ship E2EE.
void main() {
  final vectors = jsonDecode(
    File('test/crypto_vectors.json').readAsStringSync(),
  ) as Map<String, dynamic>;

  final plaintext = vectors['plaintext'] as String;
  final ownerPrivate = vectors['ownerPrivateJwk'] as Map<String, dynamic>;
  final ownerPublic = vectors['ownerPublicJwk'] as Map<String, dynamic>;
  final visitorPrivate = vectors['visitorPrivateJwk'] as Map<String, dynamic>;
  final visitorPublic = vectors['visitorPublicJwk'] as Map<String, dynamic>;
  final envelope = vectors['envelope'] as String;

  group('web envelope decrypts in Dart (golden)', () {
    test('as owner', () async {
      expect(await decryptMessage(envelope, ownerPrivate, 'owner'), plaintext);
    });

    test('as visitor', () async {
      expect(
          await decryptMessage(envelope, visitorPrivate, 'visitor'), plaintext);
    });

    test('wrong key -> key_rotated (rotation detection contract)', () async {
      await expectLater(
        decryptMessage(envelope, visitorPrivate, 'owner'),
        throwsA(isA<DecryptException>().having(
            (e) => e.reason, 'reason', DecryptErrorReason.keyRotated)),
      );
    });

    test('tampered ciphertext -> bad_envelope', () async {
      final parsed = jsonDecode(envelope) as Map<String, dynamic>;
      final ct = base64Decode(parsed['ct'] as String);
      ct[0] ^= 0xFF;
      parsed['ct'] = base64Encode(ct);
      await expectLater(
        decryptMessage(jsonEncode(parsed), ownerPrivate, 'owner'),
        throwsA(isA<DecryptException>().having(
            (e) => e.reason, 'reason', DecryptErrorReason.badEnvelope)),
      );
    });

    test('missing role key -> wrong_role', () async {
      final parsed = jsonDecode(envelope) as Map<String, dynamic>;
      (parsed['keys'] as Map<String, dynamic>).remove('owner');
      await expectLater(
        decryptMessage(jsonEncode(parsed), ownerPrivate, 'owner'),
        throwsA(isA<DecryptException>().having(
            (e) => e.reason, 'reason', DecryptErrorReason.wrongRole)),
      );
    });
  });

  group('Dart envelope round-trip (would decrypt on web)', () {
    test('encrypt in Dart, decrypt both roles, envelope shape matches v1',
        () async {
      const message = 'dart-side secret \u2728';
      final encrypted =
          await encryptMessage(message, ownerPublic, visitorPublic);

      final parsed = jsonDecode(encrypted) as Map<String, dynamic>;
      expect(parsed['v'], 1);
      expect(parsed.keys.toSet(), {'v', 'ct', 'iv', 'keys'});
      expect((parsed['keys'] as Map).keys.toSet(), {'owner', 'visitor'});
      expect(base64Decode(parsed['iv'] as String), hasLength(12));
      // RSA-4096 wrap output is exactly 512 bytes.
      expect(base64Decode((parsed['keys'] as Map)['owner'] as String),
          hasLength(512));

      expect(await decryptMessage(encrypted, ownerPrivate, 'owner'), message);
      expect(
          await decryptMessage(encrypted, visitorPrivate, 'visitor'), message);
    });
  });

  group('fingerprints (golden)', () {
    test('matches the web-computed fingerprint', () async {
      expect(await fingerprintPublicKey(ownerPublic),
          vectors['ownerFingerprint']);
    });

    test('publicJwkFromPrivate matches the uploaded shape', () {
      final derived = publicJwkFromPrivate(ownerPrivate);
      expect(derived, ownerPublic);
    });
  });

  group('.wolow-key backups (golden)', () {
    final keyFile = vectors['keyFile'] as Map<String, dynamic>;

    test('web-exported file imports in Dart', () async {
      final imported = await importWrappedKey(
        keyFile['json'] as String,
        keyFile['passphrase'] as String,
        keyFile['slug'] as String,
      );
      expect(imported.privateJwk['n'], ownerPrivate['n']);
      expect(imported.privateJwk['d'], ownerPrivate['d']);
      expect(imported.fingerprint, vectors['ownerFingerprint']);
    });

    test('wrong passphrase -> bad_passphrase', () async {
      await expectLater(
        importWrappedKey(
            keyFile['json'] as String, 'not the passphrase', 'goldslug'),
        throwsA(isA<ImportKeyException>().having(
            (e) => e.reason, 'reason', ImportErrorReason.badPassphrase)),
      );
    });

    test('wrong slug -> slug_mismatch', () async {
      await expectLater(
        importWrappedKey(keyFile['json'] as String,
            keyFile['passphrase'] as String, 'otherslug'),
        throwsA(isA<ImportKeyException>().having(
            (e) => e.reason, 'reason', ImportErrorReason.slugMismatch)),
      );
    });

    test('garbage file -> bad_format', () async {
      await expectLater(
        importWrappedKey('not json at all', 'x' * 12, 'goldslug'),
        throwsA(isA<ImportKeyException>()
            .having((e) => e.reason, 'reason', ImportErrorReason.badFormat)),
      );
    });

    test('Dart export/import round-trip (readable by web import rules)',
        () async {
      final exported = await exportWrappedKey(
          ownerPrivate, 'a long enough passphrase', 'goldslug');
      expect(exported.filename, matches(r'^wolow-goldslug-\d{4}-\d{2}-\d{2}\.wolow-key$'));
      expect(exported.fingerprint, vectors['ownerFingerprint']);

      final file = jsonDecode(exported.json) as Map<String, dynamic>;
      expect(file['v'], 1);
      expect(file['kdf'], 'PBKDF2-SHA256');
      expect(file['iter'], 600000);

      final imported = await importWrappedKey(
          exported.json, 'a long enough passphrase', 'goldslug');
      expect(imported.privateJwk['d'], ownerPrivate['d']);
    });

    test('short passphrase rejected on export', () async {
      await expectLater(
        exportWrappedKey(ownerPrivate, 'tooshort', 'goldslug'),
        throwsA(isA<ArgumentError>()),
      );
    });
  });

  group('key generation', () {
    test(
      'generates web-shaped 4096-bit RSA-OAEP JWKs that interoperate',
      () async {
        final pair = await generateKeyPair();
        expect(pair.publicJwk['kty'], 'RSA');
        expect(pair.publicJwk['alg'], 'RSA-OAEP-256');
        expect(pair.publicJwk['e'], 'AQAB');
        // 4096-bit modulus -> 512 bytes -> 683 base64url chars (no padding).
        expect((pair.publicJwk['n'] as String).length, 683);
        expect(pair.privateJwk['d'], isNotNull);

        // Fresh Dart keys must interoperate with the golden web keys.
        const message = 'new device says hi';
        final encrypted = await encryptMessage(
            message, pair.publicJwk, visitorPublic);
        expect(
            await decryptMessage(encrypted, pair.privateJwk, 'owner'), message);
        expect(await decryptMessage(encrypted, visitorPrivate, 'visitor'),
            message);
      },
      timeout: const Timeout(Duration(minutes: 3)), // 4096-bit keygen
    );
  });
}
