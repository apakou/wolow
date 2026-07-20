import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:wolow/core/api/api_client.dart';
import 'package:wolow/features/chat/chat_controller.dart';
import 'package:wolow/features/chat/chat_repository.dart';
import 'package:wolow/features/chat/models.dart';

/// Fake repository: no network. Overrides everything the controller calls.
class FakeChatRepository extends ChatRepository {
  FakeChatRepository() : super(ApiClient(baseUrl: 'http://test.invalid'));

  List<Message> fetchResult = [];
  Object? fetchError;
  Message? sendResult;
  Object? sendError;
  final sentBodies = <Map<String, dynamic>>[];
  final reactionCalls = <String>[];
  Object? reactionError;

  @override
  Future<List<Message>> fetchMessages(String slug,
      {String? conversationId}) async {
    if (fetchError != null) throw fetchError!;
    return fetchResult;
  }

  @override
  Future<Message?> sendMessage(
    String slug, {
    required String content,
    required String conversationId,
    String? replyToMessageId,
    String? encryptedContent,
  }) async {
    sentBodies.add({
      'content': content,
      'conversation_id': conversationId,
      'reply_to_message_id': replyToMessageId,
      'encrypted_content': encryptedContent,
    });
    if (sendError != null) throw sendError!;
    return sendResult;
  }

  @override
  Future<void> addReaction(String slug, String messageId, String emoji) async {
    reactionCalls.add('add:$messageId:$emoji');
    if (reactionError != null) throw reactionError!;
  }

  @override
  Future<void> removeReaction(
      String slug, String messageId, String emoji) async {
    reactionCalls.add('remove:$messageId:$emoji');
    if (reactionError != null) throw reactionError!;
  }
}

Message msg(
  String id, {
  bool isOwner = false,
  String content = 'hello',
  bool pending = false,
  bool failed = false,
  bool fromBroadcast = false,
  List<Reaction> reactions = const [],
}) =>
    Message(
      id: id,
      content: content,
      isOwner: isOwner,
      createdAt: '2026-07-20T10:00:00.000Z',
      pending: pending,
      failed: failed,
      fromBroadcast: fromBroadcast,
      reactions: reactions,
    );

void main() {
  late FakeChatRepository repo;
  late ChatController controller;

  ChatController makeController({bool isOwnerView = true}) => ChatController(
        repository: repo,
        supabase: SupabaseClient('http://test.invalid', 'test-key'),
        slug: 'testslug',
        roomId: 'room-1',
        conversationId: 'conv-1',
        isOwnerView: isOwnerView,
      );

  setUp(() {
    repo = FakeChatRepository();
    controller = makeController();
  });

  tearDown(() => controller.dispose());

  group('refetch merge rule', () {
    test('pending and failed bubbles survive, broadcast placeholders drop',
        () async {
      repo.fetchResult = [msg('server-1')];
      await controller.refetch();

      controller.value = controller.value.copyWith(messages: [
        ...controller.value.messages,
        msg('optimistic-1', pending: true),
        msg('optimistic-2', failed: true),
        msg('ghost-1', fromBroadcast: true),
      ]);

      repo.fetchResult = [msg('server-1'), msg('server-2')];
      await controller.refetch();

      final ids = controller.value.messages.map((m) => m.id).toList();
      expect(ids, ['server-1', 'server-2', 'optimistic-1', 'optimistic-2']);
    });

    test('fetch failure with existing list keeps messages, no error screen',
        () async {
      repo.fetchResult = [msg('server-1')];
      await controller.refetch();
      repo.fetchError = ApiNetworkException('offline');
      await controller.refetch();
      expect(controller.value.loadError, isFalse);
      expect(controller.value.messages, hasLength(1));
    });

    test('fetch failure with empty list sets loadError', () async {
      repo.fetchError = ApiNetworkException('offline');
      await controller.refetch();
      expect(controller.value.loadError, isTrue);
      expect(controller.value.loaded, isTrue);
    });
  });

  group('broadcast handler', () {
    test('own-side broadcasts are ignored', () async {
      await controller.debugHandleBroadcast({
        'id': 'b-1',
        'optimistic_id': 'b-1',
        'content': 'mine',
        'is_owner': true, // controller isOwnerView: true -> same actor
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(controller.value.messages, isEmpty);
    });

    test('other-side broadcast appends a fromBroadcast placeholder', () async {
      await controller.debugHandleBroadcast({
        'id': 'optimistic-visitor-1',
        'optimistic_id': 'optimistic-visitor-1',
        'content': 'hi there',
        'decryptedContent': 'hi there',
        'is_owner': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(controller.value.messages, hasLength(1));
      expect(controller.value.messages.single.fromBroadcast, isTrue);
      expect(controller.value.messages.single.displayContent, 'hi there');
    });

    test('dedupes by id and optimistic_id', () async {
      final payload = {
        'id': 'optimistic-visitor-1',
        'optimistic_id': 'optimistic-visitor-1',
        'content': 'hi',
        'is_owner': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      };
      await controller.debugHandleBroadcast(payload);
      await controller.debugHandleBroadcast(payload);
      expect(controller.value.messages, hasLength(1));
    });
  });

  group('postgres_changes INSERT handler', () {
    test('dedupes by server id', () async {
      controller.value = controller.value.copyWith(messages: [msg('server-1')]);
      await controller.debugHandleMessageInsert({
        'id': 'server-1',
        'content': 'hello',
        'is_owner': false,
        'created_at': '2026-07-20T10:00:01.000Z',
      });
      expect(controller.value.messages, hasLength(1));
    });

    test('replaces a broadcast placeholder in place by content match',
        () async {
      controller.value = controller.value.copyWith(messages: [
        msg('a'),
        msg('optimistic-x', content: 'ghost content', fromBroadcast: true),
        msg('b'),
      ]);
      await controller.debugHandleMessageInsert({
        'id': 'server-9',
        'content': 'ghost content',
        'is_owner': false,
        'created_at': '2026-07-20T10:00:02.000Z',
      });
      final ids = controller.value.messages.map((m) => m.id).toList();
      expect(ids, ['a', 'server-9', 'b']); // in place, not appended
      expect(controller.value.messages[1].fromBroadcast, isFalse);
    });

    test('placeholder match requires same is_owner side', () async {
      controller.value = controller.value.copyWith(messages: [
        msg('optimistic-x',
            content: 'same text', fromBroadcast: true, isOwner: false),
      ]);
      await controller.debugHandleMessageInsert({
        'id': 'server-9',
        'content': 'same text',
        'is_owner': true, // other side -> no match, append
        'created_at': '2026-07-20T10:00:02.000Z',
      });
      expect(controller.value.messages, hasLength(2));
    });
  });

  group('send pipeline', () {
    test('optimistic append then replace with server row', () async {
      repo.sendResult = msg('server-42', isOwner: true, content: '\u{1F512}');
      await controller.send('hello world');

      expect(controller.value.messages, hasLength(1));
      final m = controller.value.messages.single;
      expect(m.id, 'server-42');
      expect(m.decryptedContent, 'hello world'); // plaintext re-attached
      expect(m.pending, isFalse);
      expect(repo.sentBodies.single['conversation_id'], 'conv-1');
    });

    test('API error marks the bubble failed and surfaces the message',
        () async {
      repo.sendError = ApiException(429, 'Too many messages. Please slow down.');
      await controller.send('spam');

      final m = controller.value.messages.single;
      expect(m.failed, isTrue);
      expect(m.pending, isFalse);
      expect(controller.value.error, 'Too many messages. Please slow down.');
    });

    test('network error marks failed with generic message', () async {
      repo.sendError = ApiNetworkException('offline');
      await controller.send('hello');
      expect(controller.value.messages.single.failed, isTrue);
      expect(controller.value.error, 'Network error please try again');
    });

    test('reply target flows into the POST body and clears after send',
        () async {
      controller.value = controller.value.copyWith(messages: [msg('target-1')]);
      controller.setReplyTo(controller.value.messages.single);
      expect(controller.value.replyTo?.id, 'target-1');

      repo.sendResult = msg('server-43', isOwner: true);
      await controller.send('a reply');

      expect(repo.sentBodies.single['reply_to_message_id'], 'target-1');
      expect(controller.value.replyTo, isNull);
    });

    test('empty input is a no-op', () async {
      await controller.send('   ');
      expect(controller.value.messages, isEmpty);
      expect(repo.sentBodies, isEmpty);
    });
  });

  group('reactions', () {
    test('optimistic add + server echo does not double-count', () async {
      controller.value = controller.value.copyWith(messages: [msg('m-1')]);

      await controller.toggleReaction('m-1', '\u{1F525}', false);
      var r = controller.value.messages.single.reactions.single;
      expect((r.emoji, r.count, r.reactedByMe), ('\u{1F525}', 1, true));

      // Realtime echo of my own insert (same actor side: owner).
      controller.debugHandleReactionEvent(
        {'message_id': 'm-1', 'emoji': '\u{1F525}', 'is_owner': true},
        insert: true,
      );
      r = controller.value.messages.single.reactions.single;
      expect(r.count, 1); // echo swallowed
    });

    test('adding a second emoji clears my reaction from the first', () async {
      controller.value = controller.value.copyWith(messages: [msg('m-1')]);
      await controller.toggleReaction('m-1', '\u{1F525}', false);
      await controller.toggleReaction('m-1', '\u{1F44D}', false);

      final reactions = controller.value.messages.single.reactions;
      expect(reactions, hasLength(1)); // fire dropped (count hit 0)
      expect(reactions.single.emoji, '\u{1F44D}');
    });

    test('failed reaction call reverts the optimistic update', () async {
      controller.value = controller.value.copyWith(messages: [msg('m-1')]);
      repo.reactionError = ApiException(500, 'Failed to add reaction');
      await controller.toggleReaction('m-1', '\u{1F525}', false);

      expect(controller.value.messages.single.reactions, isEmpty);
      expect(controller.value.error, isNotNull);
    });

    test('other actor reaction increments and does not set reactedByMe', () {
      controller.value = controller.value.copyWith(messages: [msg('m-1')]);
      controller.debugHandleReactionEvent(
        {'message_id': 'm-1', 'emoji': '\u2764\uFE0F', 'is_owner': false},
        insert: true,
      );
      final r = controller.value.messages.single.reactions.single;
      expect((r.count, r.reactedByMe), (1, false));
    });

    test('unfiltered realtime events for unknown messages are dropped', () {
      controller.value = controller.value.copyWith(messages: [msg('m-1')]);
      controller.debugHandleReactionEvent(
        {'message_id': 'other-room-msg', 'emoji': '\u{1F525}', 'is_owner': false},
        insert: true,
      );
      expect(controller.value.messages.single.reactions, isEmpty);
    });

    test('delete echo of my optimistic remove is a no-op', () async {
      controller.value = controller.value.copyWith(messages: [
        msg('m-1', reactions: [
          const Reaction(emoji: '\u{1F525}', count: 2, reactedByMe: true),
        ]),
      ]);
      await controller.toggleReaction('m-1', '\u{1F525}', true); // remove
      var r = controller.value.messages.single.reactions.single;
      expect((r.count, r.reactedByMe), (1, false));

      controller.debugHandleReactionEvent(
        {'message_id': 'm-1', 'emoji': '\u{1F525}', 'is_owner': true},
        insert: false,
      );
      r = controller.value.messages.single.reactions.single;
      expect(r.count, 1); // echo swallowed, other actor's reaction intact
    });
  });
}
