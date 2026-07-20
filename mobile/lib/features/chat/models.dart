/// Chat data models, mirroring the web client's Message/Reaction shapes
/// (src/components/ChatView.tsx types + GET /messages response).
library;

const lockPlaceholder = '\u{1F512}'; // stored content for E2EE messages
const maxMessageLength = 1000;
const reactionOptions = ['\u2764\uFE0F', '\u{1F44D}', '\u{1F602}', '\u{1F525}'];

enum DecryptErrorReason { noKey, keyRotated, badEnvelope, wrongRole, unknown }

class DecryptError {
  const DecryptError(this.reason, this.message);
  final DecryptErrorReason reason;
  final String message;
}

class Reaction {
  const Reaction({
    required this.emoji,
    required this.count,
    required this.reactedByMe,
  });

  final String emoji;
  final int count;
  final bool reactedByMe;

  Reaction copyWith({int? count, bool? reactedByMe}) => Reaction(
        emoji: emoji,
        count: count ?? this.count,
        reactedByMe: reactedByMe ?? this.reactedByMe,
      );

  static Reaction fromJson(Map<String, dynamic> json) => Reaction(
        emoji: json['emoji'] as String,
        count: (json['count'] as num?)?.toInt() ?? 0,
        reactedByMe: (json['reactedByMe'] as bool?) ?? false,
      );
}

/// Web sort: count desc, tie-break emoji localeCompare asc.
List<Reaction> sortReactions(List<Reaction> reactions) {
  final copy = [...reactions];
  copy.sort((a, b) {
    if (a.count != b.count) return b.count.compareTo(a.count);
    return a.emoji.compareTo(b.emoji);
  });
  return copy;
}

class Message {
  const Message({
    required this.id,
    required this.content,
    required this.isOwner,
    required this.createdAt,
    this.replyToMessageId,
    this.encryptedContent,
    this.reactions = const [],
    this.decryptedContent,
    this.decryptError,
    this.pending = false,
    this.failed = false,
    this.fromBroadcast = false,
  });

  final String id;
  final String content;
  final bool isOwner;
  final String createdAt; // ISO string, matches wire format
  final String? replyToMessageId;
  final String? encryptedContent;
  final List<Reaction> reactions;

  // Client-only state (never serialized):
  final String? decryptedContent;
  final DecryptError? decryptError;
  final bool pending;
  final bool failed;
  final bool fromBroadcast; // `_fromBroadcast` placeholder marker

  String get displayContent => decryptedContent ?? content;

  Message copyWith({
    String? id,
    String? content,
    bool? isOwner,
    String? createdAt,
    Object? replyToMessageId = _sentinel,
    Object? encryptedContent = _sentinel,
    List<Reaction>? reactions,
    Object? decryptedContent = _sentinel,
    Object? decryptError = _sentinel,
    bool? pending,
    bool? failed,
    bool? fromBroadcast,
  }) {
    return Message(
      id: id ?? this.id,
      content: content ?? this.content,
      isOwner: isOwner ?? this.isOwner,
      createdAt: createdAt ?? this.createdAt,
      replyToMessageId: replyToMessageId == _sentinel
          ? this.replyToMessageId
          : replyToMessageId as String?,
      encryptedContent: encryptedContent == _sentinel
          ? this.encryptedContent
          : encryptedContent as String?,
      reactions: reactions ?? this.reactions,
      decryptedContent: decryptedContent == _sentinel
          ? this.decryptedContent
          : decryptedContent as String?,
      decryptError: decryptError == _sentinel
          ? this.decryptError
          : decryptError as DecryptError?,
      pending: pending ?? this.pending,
      failed: failed ?? this.failed,
      fromBroadcast: fromBroadcast ?? this.fromBroadcast,
    );
  }

  static const _sentinel = Object();

  static Message fromJson(Map<String, dynamic> json) => Message(
        id: json['id'] as String,
        content: (json['content'] as String?) ?? '',
        isOwner: (json['is_owner'] as bool?) ?? false,
        createdAt: (json['created_at'] as String?) ?? '',
        replyToMessageId: json['reply_to_message_id'] as String?,
        encryptedContent: json['encrypted_content'] as String?,
        reactions: ((json['reactions'] as List?) ?? const [])
            .cast<Map<String, dynamic>>()
            .map(Reaction.fromJson)
            .toList(),
      );
}

class ReplyTarget {
  const ReplyTarget({
    required this.id,
    required this.content,
    required this.isOwner,
  });

  final String id;
  final String content;
  final bool isOwner;
}

/// Inbox conversation row (GET /api/rooms/{slug}/conversations).
class ConversationSummary {
  const ConversationSummary({
    required this.id,
    required this.label,
    required this.createdAt,
    required this.messageCount,
    required this.unreadCount,
    required this.blocked,
    this.lastMessage,
  });

  final String id;
  final String label;
  final String createdAt;
  final int messageCount;
  final int unreadCount;
  final bool blocked;
  final LastMessage? lastMessage;

  ConversationSummary copyWith({
    int? messageCount,
    int? unreadCount,
    bool? blocked,
    Object? lastMessage = _sentinel,
  }) =>
      ConversationSummary(
        id: id,
        label: label,
        createdAt: createdAt,
        messageCount: messageCount ?? this.messageCount,
        unreadCount: unreadCount ?? this.unreadCount,
        blocked: blocked ?? this.blocked,
        lastMessage: lastMessage == _sentinel
            ? this.lastMessage
            : lastMessage as LastMessage?,
      );

  static const _sentinel = Object();

  static ConversationSummary fromJson(Map<String, dynamic> json) =>
      ConversationSummary(
        id: json['id'] as String,
        label: (json['label'] as String?) ?? 'Anonymous',
        createdAt: (json['created_at'] as String?) ?? '',
        messageCount: (json['message_count'] as num?)?.toInt() ?? 0,
        unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
        blocked: (json['blocked'] as bool?) ?? false,
        lastMessage: json['last_message'] is Map<String, dynamic>
            ? LastMessage.fromJson(json['last_message'] as Map<String, dynamic>)
            : null,
      );
}

class LastMessage {
  const LastMessage({
    required this.content,
    required this.isOwner,
    required this.createdAt,
  });

  final String content;
  final bool isOwner;
  final String createdAt;

  static LastMessage fromJson(Map<String, dynamic> json) => LastMessage(
        content: (json['content'] as String?) ?? '',
        isOwner: (json['is_owner'] as bool?) ?? false,
        createdAt: (json['created_at'] as String?) ?? '',
      );
}
