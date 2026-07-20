import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import 'models.dart';

/// API access for messages, reactions, and conversations.
/// Wire contract documented in the web route handlers
/// (src/app/api/rooms/[slug]/...).
class ChatRepository {
  ChatRepository(this._api);

  final ApiClient _api;

  Future<List<Message>> fetchMessages(String slug,
      {String? conversationId}) async {
    final data = await _api.get(
      '/api/rooms/${Uri.encodeComponent(slug)}/messages',
      query: conversationId != null ? {'conversation_id': conversationId} : null,
    );
    if (data is! List) throw ApiException(500, 'Unexpected response');
    return data.cast<Map<String, dynamic>>().map(Message.fromJson).toList();
  }

  /// Returns the inserted server row. E2EE messages carry the lock
  /// placeholder as content plus the envelope in encrypted_content.
  Future<Message?> sendMessage(
    String slug, {
    required String content,
    required String conversationId,
    String? replyToMessageId,
    String? encryptedContent,
  }) async {
    final data = await _api.post(
      '/api/rooms/${Uri.encodeComponent(slug)}/messages',
      body: {
        'content': encryptedContent != null ? lockPlaceholder : content,
        'conversation_id': conversationId,
        'reply_to_message_id': replyToMessageId,
        'encrypted_content': ?encryptedContent,
      },
    );
    final message = (data as Map<String, dynamic>?)?['message'];
    return message is Map<String, dynamic> ? Message.fromJson(message) : null;
  }

  Future<void> addReaction(String slug, String messageId, String emoji) =>
      _api.post('/api/rooms/${Uri.encodeComponent(slug)}/reactions',
          body: {'message_id': messageId, 'emoji': emoji});

  Future<void> removeReaction(String slug, String messageId, String emoji) =>
      _api.delete('/api/rooms/${Uri.encodeComponent(slug)}/reactions',
          body: {'message_id': messageId, 'emoji': emoji});

  Future<List<ConversationSummary>> fetchConversations(String slug) async {
    final data =
        await _api.get('/api/rooms/${Uri.encodeComponent(slug)}/conversations');
    if (data is! List) throw ApiException(500, 'Unexpected response');
    return data
        .cast<Map<String, dynamic>>()
        .map(ConversationSummary.fromJson)
        .toList();
  }

  Future<void> markRead(String slug, String conversationId) =>
      _api.patch('/api/rooms/${Uri.encodeComponent(slug)}/conversations',
          body: {'conversation_id': conversationId});

  Future<void> setBlocked(String slug, String conversationId, bool blocked) =>
      _api.patch('/api/rooms/${Uri.encodeComponent(slug)}/conversations',
          body: {'conversation_id': conversationId, 'blocked': blocked});

  /// Visitor entry: upsert the conversation for (room, sender).
  /// Returns the conversation id.
  Future<String> openConversation(String slug) async {
    final data = await _api.post(
      '/api/rooms/${Uri.encodeComponent(slug)}/conversations',
    ) as Map<String, dynamic>;
    return data['conversation_id'] as String;
  }
}

final chatRepositoryProvider = Provider<ChatRepository>(
  (ref) => ChatRepository(ref.watch(apiClientProvider)),
);
