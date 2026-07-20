import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';
import 'chat_repository.dart';
import 'models.dart';

/// Encryption boundary. Phase 3 ships [NoCipher] (plaintext, mirroring the
/// web's insecure-context fallback); Phase 4 provides the real E2EE cipher.
abstract class MessageCipher {
  /// Mirrors the web's `typeof crypto !== "undefined" && !!crypto.subtle`.
  bool get cryptoAvailable;
  bool get ready;
  bool get keyLoaded;
  bool get ownerKeyOnServer;
  bool get visitorKeyOnServer;

  /// Structured setup error id (e.g. "owner_key_missing_restore_required").
  String? get setupError;

  Future<String?> encrypt(String plaintext);
  Future<({String? decrypted, DecryptError? error})> decrypt(String envelope);
}

class NoCipher implements MessageCipher {
  const NoCipher();
  @override
  bool get cryptoAvailable => false;
  @override
  bool get ready => false;
  @override
  bool get keyLoaded => false;
  @override
  bool get ownerKeyOnServer => false;
  @override
  bool get visitorKeyOnServer => false;
  @override
  String? get setupError => null;
  @override
  Future<String?> encrypt(String plaintext) async => null;
  @override
  Future<({String? decrypted, DecryptError? error})> decrypt(String envelope) async =>
      (
        decrypted: null,
        error: const DecryptError(
            DecryptErrorReason.noKey, 'No encryption key on this device'),
      );
}

@immutable
class ChatState {
  const ChatState({
    this.messages = const [],
    this.loaded = false,
    this.loadError = false,
    this.reconnecting = false,
    this.newMessageToast = false,
    this.error,
    this.replyTo,
    this.reactionBusy = const {},
  });

  final List<Message> messages;
  final bool loaded;
  final bool loadError;
  final bool reconnecting;
  final bool newMessageToast;

  /// Composer error banner (send failures, reaction failures, E2EE gating).
  final String? error;
  final ReplyTarget? replyTo;
  final Set<String> reactionBusy; // "messageId:emoji"

  bool get hasPendingMessages => messages.any((m) => m.pending);

  ChatState copyWith({
    List<Message>? messages,
    bool? loaded,
    bool? loadError,
    bool? reconnecting,
    bool? newMessageToast,
    Object? error = _sentinel,
    Object? replyTo = _sentinel,
    Set<String>? reactionBusy,
  }) =>
      ChatState(
        messages: messages ?? this.messages,
        loaded: loaded ?? this.loaded,
        loadError: loadError ?? this.loadError,
        reconnecting: reconnecting ?? this.reconnecting,
        newMessageToast: newMessageToast ?? this.newMessageToast,
        error: error == _sentinel ? this.error : error as String?,
        replyTo: replyTo == _sentinel ? this.replyTo : replyTo as ReplyTarget?,
        reactionBusy: reactionBusy ?? this.reactionBusy,
      );

  static const _sentinel = Object();
}

/// Port of the ChatView state machine (src/components/ChatView.tsx).
///
/// Three message arrival paths with strict precedence:
///  1. own optimistic bubble -> replaced by the POST response row
///  2. other party's `new_message` broadcast -> placeholder (fromBroadcast)
///  3. postgres_changes INSERT -> authoritative; dedupes by id, then replaces
///     a matching placeholder in place (content match), else appends.
class ChatController extends ValueNotifier<ChatState> {
  ChatController({
    required ChatRepository repository,
    required SupabaseClient supabase,
    required this.slug,
    required this.roomId,
    required this.isOwnerView,
    this.conversationId,
    MessageCipher cipher = const NoCipher(),
    bool Function()? isAtBottom,
  })  : _repo = repository,
        _supabase = supabase,
        _cipher = cipher,
        _isAtBottom = isAtBottom ?? (() => true),
        super(const ChatState());

  final ChatRepository _repo;
  final SupabaseClient _supabase;
  final String slug;
  final String roomId;
  final String? conversationId;
  final bool isOwnerView;
  MessageCipher _cipher;

  /// UI hook: whether the list is scrolled to the bottom (toast decision).
  final bool Function() _isAtBottom;

  /// Fired when the local user's send is appended (UI scrolls to bottom).
  VoidCallback? onOwnSend;

  RealtimeChannel? _channel;
  bool _hadDrop = false;
  bool _disposed = false;
  int _optimisticCounter = 0;

  MessageCipher get cipher => _cipher;
  set cipher(MessageCipher next) {
    _cipher = next;
    // Key may have arrived after fetch: retry no_key decrypt failures.
    retryFailedDecrypts();
  }

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

  void _set(ChatState next) {
    if (!_disposed) value = next;
  }

  // Fetching

  Future<void> refetch() async {
    try {
      final fetched =
          await _repo.fetchMessages(slug, conversationId: conversationId);
      final decrypted = <Message>[];
      for (final m in fetched) {
        decrypted.add(await _decryptMessage(m));
      }
      // Merge rule: locally pending/failed bubbles survive; broadcast
      // placeholders deliberately don't (web parity).
      final extras = value.messages
          .where((m) =>
              (m.pending || m.failed) && !decrypted.any((d) => d.id == m.id))
          .toList();
      _set(value.copyWith(
        messages: [...decrypted, ...extras],
        loaded: true,
        loadError: false,
      ));
    } catch (_) {
      // Never render a network failure as an empty conversation.
      _set(value.copyWith(loaded: true, loadError: value.messages.isEmpty));
    }
  }

  /// App resumed from background (sockets may have been frozen).
  void onAppResumed() {
    if (value.loaded) refetch();
  }

  Future<Message> _decryptMessage(Message m) async {
    if (m.encryptedContent == null || m.decryptedContent != null) return m;
    final result = await _cipher.decrypt(m.encryptedContent!);
    return m.copyWith(
      decryptedContent: result.decrypted,
      decryptError: result.error,
    );
  }

  /// One bulk retry for messages that failed with no_key (key arrived late).
  Future<void> retryFailedDecrypts() async {
    if (!value.loaded) return;
    var changed = false;
    final next = <Message>[];
    for (final m in value.messages) {
      if (m.encryptedContent != null &&
          m.decryptError?.reason == DecryptErrorReason.noKey) {
        final retried = await _decryptMessage(
            m.copyWith(decryptedContent: null, decryptError: null));
        changed = changed ||
            retried.decryptedContent != null ||
            retried.decryptError?.reason != DecryptErrorReason.noKey;
        next.add(retried);
      } else {
        next.add(m);
      }
    }
    if (changed) _set(value.copyWith(messages: next));
  }

  // Realtime

  void _subscribe() {
    final channel = _supabase.channel('chat:${conversationId ?? roomId}');

    channel.onBroadcast(
      event: 'new_message',
      callback: (payload) => _handleBroadcast(payload),
    );

    channel.onPostgresChanges(
      event: PostgresChangeEvent.insert,
      schema: 'public',
      table: 'messages',
      filter: conversationId != null
          ? PostgresChangeFilter(
              type: PostgresChangeFilterType.eq,
              column: 'conversation_id',
              value: conversationId!,
            )
          : PostgresChangeFilter(
              type: PostgresChangeFilterType.eq,
              column: 'room_id',
              value: roomId,
            ),
      callback: (payload) => _handleMessageInsert(payload.newRecord),
    );

    // Reactions have no room column, so the stream is unfiltered; the
    // message-exists guard in _applyReactionFromRealtime is the isolation.
    channel.onPostgresChanges(
      event: PostgresChangeEvent.insert,
      schema: 'public',
      table: 'reactions',
      callback: (payload) => _handleReactionEvent(payload.newRecord, insert: true),
    );
    channel.onPostgresChanges(
      event: PostgresChangeEvent.delete,
      schema: 'public',
      table: 'reactions',
      callback: (payload) =>
          _handleReactionEvent(payload.oldRecord, insert: false),
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

  Future<void> _handleBroadcast(Map<String, dynamic> payload) async {
    final incomingIsOwner = payload['is_owner'] as bool? ?? false;
    // Own broadcasts are ignored (sender already has the optimistic bubble).
    if (incomingIsOwner == isOwnerView) return;

    final optimisticId = payload['optimistic_id'] as String?;
    var incoming = Message(
      id: (payload['id'] as String?) ?? '',
      content: (payload['content'] as String?) ?? '',
      isOwner: incomingIsOwner,
      createdAt:
          (payload['created_at'] as String?) ?? DateTime.now().toIso8601String(),
      replyToMessageId: payload['reply_to_message_id'] as String?,
      encryptedContent: payload['encrypted_content'] as String?,
      // Plaintext travels in the broadcast (web parity).
      decryptedContent: payload['decryptedContent'] as String?,
      fromBroadcast: true,
    );
    if (incoming.id.isEmpty) return;
    incoming = await _decryptMessage(incoming);

    final exists = value.messages.any((m) =>
        m.id == incoming.id || (optimisticId != null && m.id == optimisticId));
    if (exists) return;

    _set(value.copyWith(
      messages: [...value.messages, incoming],
      newMessageToast: !_isAtBottom() ? true : value.newMessageToast,
    ));
  }

  Future<void> _handleMessageInsert(Map<String, dynamic> record) async {
    var decrypted = await _decryptMessage(Message.fromJson(record));

    final messages = value.messages;
    if (messages.any((m) => m.id == decrypted.id)) return;

    // Placeholder match: replace an optimistic/broadcast bubble in place.
    final index = messages.indexWhere((m) {
      if (!(m.pending || m.fromBroadcast)) return false;
      if (m.isOwner != decrypted.isOwner) return false;
      if (m.encryptedContent != null && decrypted.encryptedContent != null) {
        return m.encryptedContent == decrypted.encryptedContent;
      }
      return m.displayContent == decrypted.displayContent;
    });

    if (index >= 0) {
      final placeholder = messages[index];
      // Keep the placeholder's successful decryption if this one failed.
      final thisDecryptFailed =
          decrypted.encryptedContent != null && decrypted.decryptError != null;
      if (thisDecryptFailed && placeholder.decryptedContent != null) {
        decrypted = decrypted.copyWith(
          decryptedContent: placeholder.decryptedContent,
          decryptError: null,
        );
      }
      final next = [...messages];
      next[index] = decrypted;
      _set(value.copyWith(messages: next));
    } else {
      _set(value.copyWith(
        messages: [...messages, decrypted],
        newMessageToast: !_isAtBottom() ? true : value.newMessageToast,
      ));
    }
  }

  // Send pipeline (exact web order)

  Future<void> send(String input, {bool composerDisabled = false}) async {
    if (composerDisabled) return;
    final content = input.trim();
    if (content.isEmpty) return;

    // E2EE readiness gate BEFORE any UI change.
    final cryptoAvailable = _cipher.cryptoAvailable;
    final otherPartyHasKey =
        isOwnerView ? _cipher.visitorKeyOnServer : _cipher.ownerKeyOnServer;
    final isLegacyConversation =
        cryptoAvailable && _cipher.keyLoaded && !otherPartyHasKey;
    if (cryptoAvailable && !_cipher.ready && !isLegacyConversation) {
      final setupError = _cipher.setupError;
      final message = (setupError == 'owner_key_missing_restore_required' ||
              setupError == 'owner_key_conflict_restore_required')
          ? "Your encryption key isn't on this device. Restore it from your "
              '.wolow-key backup in Settings to read and send messages.'
          : 'Encryption is still setting up. Please wait a moment and try again.';
      _set(value.copyWith(error: message));
      return;
    }

    final replyTargetId = value.replyTo?.id;
    final convId = conversationId;
    if (convId == null) return;

    final optimisticId =
        'optimistic-${DateTime.now().millisecondsSinceEpoch}-${_optimisticCounter++}';
    final optimistic = Message(
      id: optimisticId,
      content: content,
      decryptedContent: content,
      isOwner: isOwnerView,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      replyToMessageId: replyTargetId,
      pending: true,
    );

    _set(value.copyWith(
      messages: [...value.messages, optimistic],
      replyTo: null,
      error: null,
    ));
    onOwnSend?.call();

    try {
      String? encryptedContent;
      if (cryptoAvailable && _cipher.ready) {
        encryptedContent = await _cipher.encrypt(content);
        if (encryptedContent == null) {
          _markOptimistic(optimisticId, failed: true);
          _set(value.copyWith(error: 'Encryption failed. Please try again.'));
          return;
        }
      }

      // Broadcast BEFORE the POST for instant delivery (fire-and-forget).
      try {
        await _channel?.sendBroadcastMessage(
          event: 'new_message',
          payload: {
            'id': optimisticId,
            'optimistic_id': optimisticId,
            'content': encryptedContent != null ? lockPlaceholder : content,
            'decryptedContent': content,
            'encrypted_content': encryptedContent,
            'is_owner': isOwnerView,
            'created_at': optimistic.createdAt,
            'reply_to_message_id': replyTargetId,
          },
        );
      } catch (_) {
        // Delivery falls back to postgres_changes.
      }

      final serverMsg = await _repo.sendMessage(
        slug,
        content: content,
        conversationId: convId,
        replyToMessageId: replyTargetId,
        encryptedContent: encryptedContent,
      );

      if (serverMsg != null) {
        final withPlaintext = serverMsg.copyWith(decryptedContent: content);
        final next =
            value.messages.where((m) => m.id != optimisticId).toList();
        if (!next.any((m) => m.id == withPlaintext.id)) {
          next.add(withPlaintext);
        }
        _set(value.copyWith(messages: next));
      } else {
        _markOptimistic(optimisticId, pendingOnly: true);
      }
    } on ApiException catch (e) {
      _markOptimistic(optimisticId, failed: true);
      _set(value.copyWith(error: e.message));
    } catch (_) {
      _markOptimistic(optimisticId, failed: true);
      _set(value.copyWith(error: 'Network error please try again'));
    }
  }

  void _markOptimistic(String optimisticId,
      {bool failed = false, bool pendingOnly = false}) {
    final next = value.messages.map((m) {
      if (m.id != optimisticId) return m;
      if (pendingOnly) return m.copyWith(pending: false);
      return m.copyWith(pending: false, failed: failed);
    }).toList();
    _set(value.copyWith(messages: next));
  }

  // Reply

  void setReplyTo(Message message) {
    if (message.pending || message.decryptError != null) return;
    final content = message.displayContent;
    if (content.trim().isEmpty) return;
    _set(value.copyWith(
      replyTo: ReplyTarget(
        id: message.id,
        content: content,
        isOwner: message.isOwner,
      ),
    ));
  }

  void clearReplyTo() => _set(value.copyWith(replyTo: null));

  void clearToast() => _set(value.copyWith(newMessageToast: false));

  void clearError() => _set(value.copyWith(error: null));

  // Test hooks (realtime handlers are private; tests drive them directly)

  @visibleForTesting
  Future<void> debugHandleBroadcast(Map<String, dynamic> payload) =>
      _handleBroadcast(payload);

  @visibleForTesting
  Future<void> debugHandleMessageInsert(Map<String, dynamic> record) =>
      _handleMessageInsert(record);

  @visibleForTesting
  void debugHandleReactionEvent(Map<String, dynamic> record,
          {required bool insert}) =>
      _handleReactionEvent(record, insert: insert);

  // Reactions

  Future<void> toggleReaction(
      String messageId, String emoji, bool hasReacted) async {
    final busyKey = '$messageId:$emoji';
    if (value.reactionBusy.contains(busyKey)) return;
    _set(value.copyWith(reactionBusy: {...value.reactionBusy, busyKey}));

    final remove = hasReacted;
    _applyOptimisticReaction(messageId, emoji, remove: remove);

    try {
      if (remove) {
        await _repo.removeReaction(slug, messageId, emoji);
      } else {
        await _repo.addReaction(slug, messageId, emoji);
      }
    } on ApiException {
      _applyOptimisticReaction(messageId, emoji, remove: !remove); // revert
      _set(value.copyWith(error: 'Could not update reaction. Please try again.'));
    } catch (_) {
      _applyOptimisticReaction(messageId, emoji, remove: !remove);
      _set(value.copyWith(error: 'Network error while updating reaction.'));
    } finally {
      final busy = {...value.reactionBusy}..remove(busyKey);
      _set(value.copyWith(reactionBusy: busy));
    }
  }

  /// One reaction per actor per message: adding clears my reaction from
  /// other emojis first (server upserts on (message_id, is_owner)).
  List<Reaction> _clearMyReactionFromOtherEmojis(
      List<Reaction> reactions, String keepEmoji) {
    final out = <Reaction>[];
    for (final r in reactions) {
      if (r.emoji != keepEmoji && r.reactedByMe) {
        if (r.count - 1 > 0) {
          out.add(r.copyWith(count: r.count - 1, reactedByMe: false));
        }
      } else {
        out.add(r);
      }
    }
    return out;
  }

  void _applyOptimisticReaction(String messageId, String emoji,
      {required bool remove}) {
    final next = value.messages.map((m) {
      if (m.id != messageId) return m;
      if (remove) {
        final existing =
            m.reactions.where((r) => r.emoji == emoji).firstOrNull;
        if (existing == null || !existing.reactedByMe) return m;
        final updated = m.reactions
            .map((r) {
              if (r.emoji != emoji) return r;
              return r.copyWith(count: r.count - 1, reactedByMe: false);
            })
            .where((r) => r.count > 0)
            .toList();
        return m.copyWith(reactions: sortReactions(updated));
      } else {
        var reactions = _clearMyReactionFromOtherEmojis(m.reactions, emoji);
        final existing = reactions.where((r) => r.emoji == emoji).firstOrNull;
        if (existing != null && existing.reactedByMe) {
          return m.copyWith(reactions: sortReactions(reactions));
        }
        if (existing != null) {
          reactions = reactions
              .map((r) => r.emoji == emoji
                  ? r.copyWith(count: r.count + 1, reactedByMe: true)
                  : r)
              .toList();
        } else {
          reactions = [
            ...reactions,
            Reaction(emoji: emoji, count: 1, reactedByMe: true),
          ];
        }
        return m.copyWith(reactions: sortReactions(reactions));
      }
    }).toList();
    _set(value.copyWith(messages: next));
  }

  void _handleReactionEvent(Map<String, dynamic> record,
      {required bool insert}) {
    final messageId = record['message_id'] as String?;
    final emoji = record['emoji'] as String?;
    final fromOwner = record['is_owner'];
    if (messageId == null || emoji == null || fromOwner is! bool) return;

    // Unfiltered stream: drop events for messages outside this chat.
    if (!value.messages.any((m) => m.id == messageId)) return;

    final isSameActor = fromOwner == isOwnerView;
    final next = value.messages.map((m) {
      if (m.id != messageId) return m;

      if (insert) {
        var base = isSameActor
            ? _clearMyReactionFromOtherEmojis(m.reactions, emoji)
            : m.reactions;
        final existing = base.where((r) => r.emoji == emoji).firstOrNull;
        if (isSameActor && (existing?.reactedByMe ?? false)) {
          // Echo of my optimistic add: keep counts, just re-sort.
          return m.copyWith(reactions: sortReactions(base));
        }
        if (existing == null) {
          base = [
            ...base,
            Reaction(emoji: emoji, count: 1, reactedByMe: isSameActor),
          ];
        } else {
          base = base
              .map((r) => r.emoji == emoji
                  ? r.copyWith(
                      count: r.count + 1,
                      reactedByMe: r.reactedByMe || isSameActor)
                  : r)
              .toList();
        }
        return m.copyWith(reactions: sortReactions(base));
      } else {
        final existing =
            m.reactions.where((r) => r.emoji == emoji).firstOrNull;
        if (existing == null) return m;
        if (isSameActor && !existing.reactedByMe) return m; // echo of my remove
        final updated = m.reactions
            .map((r) {
              if (r.emoji != emoji) return r;
              return r.copyWith(
                count: r.count - 1,
                reactedByMe: isSameActor ? false : r.reactedByMe,
              );
            })
            .where((r) => r.count > 0)
            .toList();
        return m.copyWith(reactions: sortReactions(updated));
      }
    }).toList();
    _set(value.copyWith(messages: next));
  }
}

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
