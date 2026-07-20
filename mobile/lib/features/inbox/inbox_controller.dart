import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../chat/chat_repository.dart';
import '../chat/models.dart';

@immutable
class InboxState {
  const InboxState({
    this.conversations = const [],
    this.loaded = false,
    this.loadError = false,
    this.reconnecting = false,
  });

  final List<ConversationSummary> conversations;
  final bool loaded;
  final bool loadError;
  final bool reconnecting;

  int get totalUnread =>
      conversations.where((c) => !c.blocked).fold(0, (s, c) => s + c.unreadCount);

  InboxState copyWith({
    List<ConversationSummary>? conversations,
    bool? loaded,
    bool? loadError,
    bool? reconnecting,
  }) =>
      InboxState(
        conversations: conversations ?? this.conversations,
        loaded: loaded ?? this.loaded,
        loadError: loadError ?? this.loadError,
        reconnecting: reconnecting ?? this.reconnecting,
      );
}

/// Owner inbox: conversation list + `inbox:{roomId}` realtime channel.
/// Message INSERTs bump counts/preview/sort in place; an unknown
/// conversation triggers a full refetch (web OwnerInbox parity).
class InboxController extends ValueNotifier<InboxState> {
  InboxController({
    required ChatRepository repository,
    required SupabaseClient supabase,
    required this.slug,
    required this.roomId,
  })  : _repo = repository,
        _supabase = supabase,
        super(const InboxState());

  final ChatRepository _repo;
  final SupabaseClient _supabase;
  final String slug;
  final String roomId;

  RealtimeChannel? _channel;
  bool _hadDrop = false;
  bool _disposed = false;

  void init() {
    refetch();
    _subscribe();
  }

  @override
  void dispose() {
    _disposed = true;
    final channel = _channel;
    _channel = null;
    if (channel != null) _supabase.removeChannel(channel);
    super.dispose();
  }

  void _set(InboxState next) {
    if (!_disposed) value = next;
  }

  Future<void> refetch() async {
    try {
      final conversations = await _repo.fetchConversations(slug);
      _set(value.copyWith(
        conversations: conversations,
        loaded: true,
        loadError: false,
      ));
    } catch (_) {
      _set(value.copyWith(
        loaded: true,
        loadError: value.conversations.isEmpty,
      ));
    }
  }

  void onAppResumed() {
    if (value.loaded) refetch();
  }

  void _subscribe() {
    final channel = _supabase.channel('inbox:$roomId');

    channel.onPostgresChanges(
      event: PostgresChangeEvent.insert,
      schema: 'public',
      table: 'messages',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'room_id',
        value: roomId,
      ),
      callback: (payload) => _handleMessageInsert(payload.newRecord),
    );

    channel.subscribe((status, [error]) {
      if (_disposed) return;
      switch (status) {
        case RealtimeSubscribeStatus.subscribed:
          if (_hadDrop) {
            _hadDrop = false;
            refetch();
          }
          _set(value.copyWith(reconnecting: false));
        case RealtimeSubscribeStatus.channelError:
        case RealtimeSubscribeStatus.timedOut:
        case RealtimeSubscribeStatus.closed:
          _hadDrop = true;
          _set(value.copyWith(reconnecting: true));
      }
    });

    _channel = channel;
  }

  void _handleMessageInsert(Map<String, dynamic> record) {
    final conversationId = record['conversation_id'] as String?;
    if (conversationId == null) return;

    final index =
        value.conversations.indexWhere((c) => c.id == conversationId);
    if (index < 0) {
      // New conversation: the list endpoint owns labels/ordering.
      refetch();
      return;
    }

    final isOwner = (record['is_owner'] as bool?) ?? false;
    final createdAt =
        (record['created_at'] as String?) ?? DateTime.now().toIso8601String();
    final content = (record['content'] as String?) ?? '';

    final conv = value.conversations[index];
    final updated = conv.copyWith(
      messageCount: conv.messageCount + 1,
      unreadCount: isOwner ? conv.unreadCount : conv.unreadCount + 1,
      lastMessage: LastMessage(
        content: content.length > 80 ? content.substring(0, 80) : content,
        isOwner: isOwner,
        createdAt: createdAt,
      ),
    );

    final next = [...value.conversations]..removeAt(index);
    next.insert(0, updated); // newest activity first
    _set(value.copyWith(conversations: next));
  }

  /// Optimistically zero the unread badge, then PATCH (fire-and-forget).
  void markRead(String conversationId) {
    final next = value.conversations
        .map((c) => c.id == conversationId ? c.copyWith(unreadCount: 0) : c)
        .toList();
    _set(value.copyWith(conversations: next));
    _repo.markRead(slug, conversationId).catchError((_) {});
  }

  Future<void> setBlocked(String conversationId, bool blocked) async {
    await _repo.setBlocked(slug, conversationId, blocked);
    final next = value.conversations
        .map((c) => c.id == conversationId ? c.copyWith(blocked: blocked) : c)
        .toList();
    _set(value.copyWith(conversations: next));
  }
}
