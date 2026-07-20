import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_client.dart';
import '../../core/theme.dart';
import '../../core/utils/anonymous_name.dart';
import '../../crypto/e2ee_manager.dart';
import '../../crypto/keys_api.dart';
import '../auth/session_providers.dart';
import 'chat_controller.dart';
import 'chat_repository.dart';
import 'chat_view.dart';

/// Owner conversation thread: ChatView + block/unblock/report menu.
/// Ported from web OwnerThread.
class ThreadScreen extends ConsumerStatefulWidget {
  const ThreadScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> {
  ChatController? _controller;
  E2eeManager? _e2ee;
  bool _blocked = false;
  bool _blockBusy = false;

  @override
  void dispose() {
    _controller?.dispose();
    _e2ee?.dispose();
    super.dispose();
  }

  void _ensureController(OwnedRoom room) {
    if (_controller != null) return;
    _e2ee = E2eeManager(
      keysApi: KeysApi(ref.read(apiClientProvider)),
      slug: room.slug,
      conversationId: widget.conversationId,
      isOwnerView: true,
    )..init();
    _controller = ChatController(
      repository: ref.read(chatRepositoryProvider),
      supabase: Supabase.instance.client,
      slug: room.slug,
      roomId: room.id,
      conversationId: widget.conversationId,
      isOwnerView: true,
      cipher: _e2ee!,
    )..init();
    _controller!.addListener(() => setState(() {}));
    // Key may finish setup after messages were fetched.
    _e2ee!.addListener(() {
      _controller?.retryFailedDecrypts();
      if (mounted) setState(() {});
    });
    // Opening the thread marks it read (web parity).
    ref
        .read(chatRepositoryProvider)
        .markRead(room.slug, widget.conversationId)
        .catchError((_) {});
    _loadBlockedState(room.slug);
  }

  Future<void> _loadBlockedState(String slug) async {
    try {
      final conversations =
          await ref.read(chatRepositoryProvider).fetchConversations(slug);
      final conv =
          conversations.where((c) => c.id == widget.conversationId).firstOrNull;
      if (conv != null && mounted) setState(() => _blocked = conv.blocked);
    } catch (_) {
      // Non-fatal; block state stays unknown until a send fails with 403.
    }
  }

  Future<void> _setBlocked(OwnedRoom room, bool blocked) async {
    if (_blockBusy) return;
    if (blocked) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: WolowColors.surface,
          title: const Text('Block this sender?'),
          content: const Text(
              "They won't be able to send you new messages. You can unblock "
              'them at any time.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Block'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }

    setState(() => _blockBusy = true);
    try {
      await ref
          .read(chatRepositoryProvider)
          .setBlocked(room.slug, widget.conversationId, blocked);
      if (mounted) setState(() => _blocked = blocked);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Couldn't update block status. Try again.")));
      }
    } finally {
      if (mounted) setState(() => _blockBusy = false);
    }
  }

  Future<void> _report(OwnedRoom room) async {
    final subject = Uri.encodeComponent('Report conversation');
    final body = Uri.encodeComponent(
        'Room: ${room.slug}\nConversation: ${widget.conversationId}\n\n'
        'Describe the issue:');
    final uri = Uri.parse('mailto:report@wolow.app?subject=$subject&body=$body');
    if (!await launchUrl(uri)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Email report@wolow.app to report this chat.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final roomAsync = ref.watch(ownedRoomProvider);
    final room = roomAsync.value;
    if (room != null) _ensureController(room);

    final label = funAnonymousName(widget.conversationId);
    final emoji = funAnonymousEmoji(widget.conversationId);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Text(emoji, style: const TextStyle(fontSize: 20)),
            const SizedBox(width: 8),
            Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
          ],
        ),
        actions: [
          if (room != null)
            PopupMenuButton<String>(
              color: WolowColors.surfaceLight,
              onSelected: (choice) {
                switch (choice) {
                  case 'block':
                    _setBlocked(room, true);
                  case 'unblock':
                    _setBlocked(room, false);
                  case 'report':
                    _report(room);
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(
                  value: _blocked ? 'unblock' : 'block',
                  child: Text(_blocked ? 'Unblock sender' : 'Block sender'),
                ),
                const PopupMenuItem(value: 'report', child: Text('Report')),
              ],
            ),
        ],
      ),
      body: room == null || _controller == null
          ? const Center(child: CircularProgressIndicator())
          : ChatView(
              controller: _controller!,
              isOwnerView: true,
              placeholder: 'Reply\u2026',
              composerDisabled: _blocked,
              disabledBanner: _blocked
                  ? Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      color: WolowColors.surface,
                      child: SafeArea(
                        top: false,
                        child: Row(
                          children: [
                            const Expanded(
                              child: Text(
                                'You blocked this sender. Unblock to reply.',
                                style: TextStyle(
                                    color: WolowColors.muted, fontSize: 13),
                              ),
                            ),
                            TextButton(
                              onPressed: _blockBusy
                                  ? null
                                  : () => _setBlocked(room, false),
                              child: const Text('Unblock'),
                            ),
                          ],
                        ),
                      ),
                    )
                  : null,
            ),
    );
  }
}

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
