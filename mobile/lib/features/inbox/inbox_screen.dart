import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';
import '../../core/env.dart';
import '../../core/theme.dart';
import '../../core/utils/anonymous_name.dart';
import '../../core/utils/relative_time.dart';
import '../../crypto/e2ee_manager.dart';
import '../../crypto/keys_api.dart';
import '../auth/session_providers.dart';
import '../chat/chat_repository.dart';
import '../chat/models.dart';
import '../push/push_service.dart';
import 'inbox_controller.dart';

enum _Filter { all, unread }

/// Owner inbox, ported from web OwnerInbox: conversation list with anonymous
/// labels, unread badges, All/Unread filter, share menu, realtime updates.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen>
    with WidgetsBindingObserver {
  InboxController? _controller;
  var _filter = _Filter.all;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _controller?.onAppResumed();
  }

  void _ensureController(OwnedRoom room) {
    if (_controller != null) return;
    _controller = InboxController(
      repository: ref.read(chatRepositoryProvider),
      supabase: Supabase.instance.client,
      slug: room.slug,
      roomId: room.id,
    )..init();
    _controller!.addListener(() => setState(() {}));
    // Pre-generate the owner keypair so visitors can start encrypted
    // conversations immediately (OwnerInbox parity; never rotates).
    ensureOwnerKey(KeysApi(ref.read(apiClientProvider)), room.slug);
    // Permission already granted -> silent re-registration, no prompt.
    ref.read(pushServiceProvider).resubscribeIfAuthorized(slug: room.slug);
  }

  Future<void> _enablePush(OwnedRoom room) async {
    final result =
        await ref.read(pushServiceProvider).subscribe(slug: room.slug);
    if (!mounted) return;
    final message = switch (result) {
      PushResult.subscribed => "You'll be notified of new messages.",
      PushResult.denied =>
        'Notifications are off for Wolow in system settings.',
      PushResult.failed => "Couldn't enable notifications. Try again.",
      PushResult.unconfigured => 'Notifications are not available yet.',
    };
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _shareLink(OwnedRoom room) async {
    await SharePlus.instance.share(ShareParams(
      title: '${room.displayName} wants your anonymous messages',
      text: 'Send me an anonymous message on Wolow ${Env.appUrl}/${room.slug}',
    ));
  }

  @override
  Widget build(BuildContext context) {
    final roomAsync = ref.watch(ownedRoomProvider);

    ref.listen(ownedRoomProvider, (_, next) {
      final room = next.value;
      if (room != null && room.needsOnboarding) context.go('/welcome');
    });

    final room = roomAsync.value;
    if (room != null && !room.needsOnboarding) _ensureController(room);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inbox'),
        actions: [
          if (room != null && PushService.isConfigured)
            IconButton(
              icon: const Icon(Icons.notifications_none),
              tooltip: 'Enable notifications',
              onPressed: () => _enablePush(room),
            ),
          if (room != null)
            PopupMenuButton<String>(
              icon: const Icon(Icons.ios_share),
              color: WolowColors.surfaceLight,
              onSelected: (choice) async {
                switch (choice) {
                  case 'copy':
                    await Clipboard.setData(
                        ClipboardData(text: '${Env.appUrl}/${room.slug}'));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Link copied')));
                    }
                  case 'share':
                    await _shareLink(room);
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'copy', child: Text('Copy my link')),
                PopupMenuItem(value: 'share', child: Text('Share my link')),
              ],
            ),
        ],
      ),
      body: _buildBody(roomAsync),
    );
  }

  Widget _buildBody(AsyncValue<OwnedRoom?> roomAsync) {
    if (roomAsync.hasError) {
      return _ErrorRetry(
        message: "Couldn't load your inbox.",
        onRetry: () => ref.read(ownedRoomProvider.notifier).refresh(),
      );
    }
    final room = roomAsync.value;
    final state = _controller?.value;
    if (room == null || state == null || !state.loaded) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.loadError && state.conversations.isEmpty) {
      return _ErrorRetry(
        message: "Couldn't load conversations.",
        onRetry: () => _controller!.refetch(),
      );
    }

    final visible = _filter == _Filter.unread
        ? state.conversations.where((c) => c.unreadCount > 0).toList()
        : state.conversations;

    return Column(
      children: [
        if (state.reconnecting)
          Container(
            width: double.infinity,
            color: WolowColors.surfaceLight,
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: const Text('Reconnecting\u2026',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: WolowColors.muted)),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Row(
            children: [
              _FilterChip(
                label: 'All',
                selected: _filter == _Filter.all,
                onTap: () => setState(() => _filter = _Filter.all),
              ),
              const SizedBox(width: 8),
              _FilterChip(
                label: 'Unread',
                count: state.totalUnread,
                selected: _filter == _Filter.unread,
                onTap: () => setState(() => _filter = _Filter.unread),
              ),
            ],
          ),
        ),
        Expanded(
          child: visible.isEmpty
              ? _EmptyInbox(
                  filtered: _filter == _Filter.unread,
                  onShare: () => _shareLink(room),
                )
              : RefreshIndicator(
                  onRefresh: () => _controller!.refetch(),
                  child: ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: visible.length,
                    itemBuilder: (context, i) => _ConversationTile(
                      conversation: visible[i],
                      onTap: () {
                        _controller!.markRead(visible[i].id);
                        context.push('/inbox/${visible[i].id}');
                      },
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

class _ConversationTile extends StatelessWidget {
  const _ConversationTile({required this.conversation, required this.onTap});

  final ConversationSummary conversation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = conversation;
    final last = c.lastMessage;
    final preview = last == null
        ? 'New conversation'
        : '${last.isOwner ? 'You: ' : ''}${last.content}';

    return ListTile(
      onTap: onTap,
      leading: CircleAvatar(
        backgroundColor: WolowColors.surfaceLight,
        child: Text(funAnonymousEmoji(c.id),
            style: const TextStyle(fontSize: 20)),
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              c.label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontWeight:
                    c.unreadCount > 0 ? FontWeight.w700 : FontWeight.w500,
                color: c.blocked ? WolowColors.muted : null,
              ),
            ),
          ),
          if (c.blocked)
            Container(
              margin: const EdgeInsets.only(left: 6),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: WolowColors.surfaceLight,
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text('Blocked',
                  style: TextStyle(fontSize: 10, color: WolowColors.muted)),
            ),
        ],
      ),
      subtitle: Text(
        preview,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: WolowColors.muted, fontSize: 13),
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            relativeTime(
              DateTime.tryParse(last?.createdAt ?? c.createdAt)?.toLocal() ??
                  DateTime.now(),
            ),
            style: const TextStyle(fontSize: 11, color: WolowColors.muted),
          ),
          const SizedBox(height: 4),
          if (c.unreadCount > 0 && !c.blocked)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: WolowColors.secondary,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text('${c.unreadCount}',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w700)),
            )
          else
            const SizedBox(height: 18),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.count,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int? count;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? WolowColors.accent : WolowColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
              color: selected ? WolowColors.accent : WolowColors.border),
        ),
        child: Text(
          count != null && count! > 0 ? '$label ($count)' : label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}

class _EmptyInbox extends StatelessWidget {
  const _EmptyInbox({required this.filtered, required this.onShare});

  final bool filtered;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    if (filtered) {
      return const Center(
        child: Text('No unread messages',
            style: TextStyle(color: WolowColors.muted)),
      );
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('No messages yet',
                style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            const Text(
              'Share your link so friends can send you anonymous messages.',
              textAlign: TextAlign.center,
              style: TextStyle(color: WolowColors.muted, fontSize: 13),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onShare,
              icon: const Icon(Icons.ios_share, size: 18),
              label: const Text('Share my link'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorRetry extends StatelessWidget {
  const _ErrorRetry({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(message),
          const SizedBox(height: 12),
          FilledButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    );
  }
}
