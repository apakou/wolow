import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme.dart';
import '../../core/utils/anonymous_name.dart';
import '../../core/utils/relative_time.dart';

class _SentItem {
  const _SentItem({
    required this.id,
    required this.emoji,
    required this.roomSlug,
    required this.roomName,
    required this.createdAt,
    this.lastContent,
    this.lastIsOwner,
    this.lastCreatedAt,
  });

  final String id;
  final String emoji;
  final String? roomSlug;
  final String roomName;
  final String createdAt;
  final String? lastContent;
  final bool? lastIsOwner;
  final String? lastCreatedAt;
}

/// Conversations this user started as a visitor. Direct Supabase reads,
/// mirroring the server-rendered web /sent page (works for anonymous
/// sessions too).
final _sentItemsProvider = FutureProvider.autoDispose<List<_SentItem>>((ref) async {
  final supabase = Supabase.instance.client;
  final user = supabase.auth.currentUser;
  if (user == null) return [];

  final conversations = await supabase
      .from('conversations')
      .select('id, created_at, rooms(slug, display_name)')
      .eq('sender_user_id', user.id)
      .order('created_at', ascending: false);

  final convIds = [for (final c in conversations) c['id'] as String];
  final latestMap = <String, Map<String, dynamic>>{};
  if (convIds.isNotEmpty) {
    final messages = await supabase
        .from('messages')
        .select('conversation_id, content, is_owner, created_at')
        .inFilter('conversation_id', convIds)
        .order('created_at', ascending: false);
    for (final m in messages) {
      latestMap.putIfAbsent(m['conversation_id'] as String, () => m);
    }
  }

  return [
    for (final c in conversations)
      _SentItem(
        id: c['id'] as String,
        emoji: funAnonymousEmoji(c['id'] as String),
        roomSlug: (c['rooms'] as Map<String, dynamic>?)?['slug'] as String?,
        roomName: ((c['rooms'] as Map<String, dynamic>?)?['display_name']
                as String?) ??
            'Unknown',
        createdAt: c['created_at'] as String,
        lastContent: latestMap[c['id']]?['content'] as String?,
        lastIsOwner: latestMap[c['id']]?['is_owner'] as bool?,
        lastCreatedAt: latestMap[c['id']]?['created_at'] as String?,
      ),
  ];
});

class SentScreen extends ConsumerWidget {
  const SentScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final itemsAsync = ref.watch(_sentItemsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Sent')),
      body: itemsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text("Couldn't load sent messages."),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => ref.invalidate(_sentItemsProvider),
                child: const Text('Try again'),
              ),
            ],
          ),
        ),
        data: (items) => items.isEmpty
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text('No sent messages yet',
                          style: TextStyle(fontWeight: FontWeight.w500)),
                      SizedBox(height: 6),
                      Text(
                        "Visit someone's link to start an anonymous conversation",
                        textAlign: TextAlign.center,
                        style:
                            TextStyle(color: WolowColors.muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              )
            : RefreshIndicator(
                onRefresh: () => ref.refresh(_sentItemsProvider.future),
                child: ListView.builder(
                  physics: const AlwaysScrollableScrollPhysics(),
                  itemCount: items.length,
                  itemBuilder: (context, i) {
                    final item = items[i];
                    return ListTile(
                      onTap: item.roomSlug == null
                          ? null
                          : () => context.push('/room/${item.roomSlug}'),
                      leading: CircleAvatar(
                        backgroundColor: WolowColors.surfaceLight,
                        child: Text(item.emoji,
                            style: const TextStyle(fontSize: 20)),
                      ),
                      title: Text(item.roomName,
                          overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        item.lastContent == null
                            ? 'No messages yet'
                            : '${(item.lastIsOwner ?? false) ? 'Them: ' : 'You: '}${item.lastContent}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: WolowColors.muted, fontSize: 13),
                      ),
                      trailing: Text(
                        relativeTime(
                          DateTime.tryParse(
                                      item.lastCreatedAt ?? item.createdAt)
                                  ?.toLocal() ??
                              DateTime.now(),
                        ),
                        style: const TextStyle(
                            fontSize: 11, color: WolowColors.muted),
                      ),
                    );
                  },
                ),
              ),
      ),
    );
  }
}
