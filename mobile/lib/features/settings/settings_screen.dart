import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api/api_client.dart';
import '../../core/theme.dart';
import '../../crypto/fingerprint.dart';
import '../../crypto/key_backup.dart';
import '../../crypto/key_storage.dart' as key_storage;
import '../../crypto/keys_api.dart';
import '../auth/session_providers.dart';

/// E2EE key management: fingerprint status, passphrase-encrypted backup
/// export, and restore with forced key rotation. Ported from SettingsClient.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  String? _fingerprint;
  bool _keyPresent = false;
  bool _statusLoaded = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadStatus());
  }

  Future<void> _loadStatus() async {
    final room = ref.read(ownedRoomProvider).value;
    if (room == null) {
      // Room still loading; retry when it arrives (build listens below).
      return;
    }
    final privateJwk = await key_storage.getPrivateKey('room:${room.slug}');
    String? fingerprint;
    if (privateJwk != null) {
      try {
        fingerprint = await fingerprintPublicKey(publicJwkFromPrivate(privateJwk));
      } catch (_) {
        fingerprint = null;
      }
    }
    if (!mounted) return;
    setState(() {
      _keyPresent = privateJwk != null;
      _fingerprint = fingerprint;
      _statusLoaded = true;
    });
  }

  Future<String?> _askPassphrase({required String title, required String cta}) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: WolowColors.surface,
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'At least 12 characters. Wolow never sees this passphrase '
              'if you lose it, the backup is unreadable.',
              style: TextStyle(fontSize: 13, color: WolowColors.muted),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              obscureText: true,
              autofocus: true,
              style: const TextStyle(fontSize: 16),
              decoration: const InputDecoration(labelText: 'Passphrase'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: Text(cta),
          ),
        ],
      ),
    );
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _exportBackup(OwnedRoom room) async {
    final privateJwk = await key_storage.getPrivateKey('room:${room.slug}');
    if (privateJwk == null) {
      _snack('No key on this device yet open your inbox first.');
      return;
    }

    final passphrase =
        await _askPassphrase(title: 'Protect your backup', cta: 'Create backup');
    if (passphrase == null) return;
    if (passphrase.length < 12) {
      _snack('Passphrase must be at least 12 characters.');
      return;
    }

    setState(() => _busy = true);
    try {
      final exported =
          await exportWrappedKey(privateJwk, passphrase, room.slug);
      await SharePlus.instance.share(ShareParams(
        files: [
          XFile.fromData(
            utf8.encode(exported.json),
            name: exported.filename,
            mimeType: 'application/json',
          ),
        ],
        fileNameOverrides: [exported.filename],
      ));
    } catch (e) {
      _snack("Couldn't create the backup. Try again.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _restoreBackup(OwnedRoom room) async {
    final picked = await FilePicker.platform.pickFiles(withData: true);
    final bytes = picked?.files.single.bytes;
    if (bytes == null) return;

    final passphrase =
        await _askPassphrase(title: 'Unlock your backup', cta: 'Unlock');
    if (passphrase == null || passphrase.isEmpty) return;

    setState(() => _busy = true);
    try {
      final imported =
          await importWrappedKey(utf8.decode(bytes), passphrase, room.slug);

      if (!mounted) return;
      // Destructive-restore confirm: rotation makes messages encrypted to
      // any OTHER key unreadable (two-step confirm, web parity).
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: WolowColors.surface,
          title: const Text('Replace your key?'),
          content: Text(
            'Restoring makes this backup (${imported.fingerprint}) the active '
            'key everywhere. Messages sent to a different key will become '
            'unreadable. Continue?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Restore & rotate'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;

      // Store locally first, then force-rotate the server key (web order).
      await key_storage.storePrivateKey(
          'room:${room.slug}', imported.privateJwk);
      final keysApi = KeysApi(ref.read(apiClientProvider));
      await keysApi.uploadOwnerPublicKey(room.slug, imported.publicJwk,
          forceRotate: true);

      _snack('Key restored: ${imported.fingerprint}');
      await _loadStatus();
    } on ImportKeyException catch (e) {
      _snack(switch (e.reason) {
        ImportErrorReason.badPassphrase => 'Wrong passphrase for this backup.',
        ImportErrorReason.slugMismatch =>
          'That backup belongs to a different Wolow link.',
        ImportErrorReason.version => 'This backup version is not supported.',
        ImportErrorReason.badFormat => "That doesn't look like a .wolow-key file.",
      });
    } on ApiException catch (e) {
      _snack(e.isRateLimited
          ? 'Too many key changes try again later.'
          : "Couldn't update the server key. Try again.");
    } catch (_) {
      _snack('Restore failed. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final roomAsync = ref.watch(ownedRoomProvider);
    final room = roomAsync.value;

    // Load status once the room arrives.
    ref.listen(ownedRoomProvider, (_, next) {
      if (next.value != null && !_statusLoaded) _loadStatus();
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: room == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: WolowColors.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: WolowColors.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            _keyPresent ? Icons.lock : Icons.lock_open,
                            size: 18,
                            color: _keyPresent
                                ? const Color(0xFF4ADE80)
                                : const Color(0xFFFBBF24),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _keyPresent
                                ? 'Encryption key on this device'
                                : 'No encryption key on this device',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                      if (_fingerprint != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _fingerprint!,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 13,
                            color: WolowColors.muted,
                          ),
                        ),
                      ],
                      const SizedBox(height: 6),
                      const Text(
                        'Messages are end-to-end encrypted with this key. '
                        'Back it up so a lost phone never means lost messages.',
                        style:
                            TextStyle(fontSize: 12, color: WolowColors.muted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed:
                      _busy || !_keyPresent ? null : () => _exportBackup(room),
                  icon: const Icon(Icons.download),
                  label: const Text('Back up my key (.wolow-key)'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _restoreBackup(room),
                  icon: const Icon(Icons.upload),
                  label: const Text('Restore from backup'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: WolowColors.foreground,
                    side: const BorderSide(color: WolowColors.border),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Restoring replaces the key on the server (rotation). '
                  'Messages encrypted to other keys become unreadable.',
                  style: TextStyle(fontSize: 12, color: WolowColors.muted),
                ),
              ],
            ),
    );
  }
}
