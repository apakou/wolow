import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';
import '../../core/theme.dart';
import '../../core/utils/anonymous_name.dart';
import '../../core/utils/prompts.dart';
import '../../crypto/e2ee_manager.dart';
import '../../crypto/keys_api.dart';
import '../chat/chat_controller.dart';
import '../chat/chat_repository.dart';
import '../chat/chat_view.dart';
import '../push/push_service.dart';

enum _Phase { initializing, ready, authFailed, error }

/// Anonymous visitor chat (deep-link target for wolow.app/{slug}).
/// Ported from web ChatRoom: silent anonymous session, conversation upsert,
/// candy variant with dice + anonymity explainer + save-chat prompt.
class VisitorRoomScreen extends ConsumerStatefulWidget {
  const VisitorRoomScreen({super.key, required this.slug});

  final String slug;

  @override
  ConsumerState<VisitorRoomScreen> createState() => _VisitorRoomScreenState();
}

class _VisitorRoomScreenState extends ConsumerState<VisitorRoomScreen> {
  var _phase = _Phase.initializing;
  String _displayName = '';
  String? _conversationId;
  ChatController? _controller;
  E2eeManager? _e2ee;
  bool _explainerDismissed = false;
  bool _saveChatDismissed = false;
  int _visitorMessageCount = 0;
  int _promptIndex = 0;
  int _diceIndex = -1;

  bool get _isAnonymous =>
      Supabase.instance.client.auth.currentUser?.isAnonymous ?? false;

  @override
  void initState() {
    super.initState();
    _promptIndex = nextRandomIndex(-1, invitationPrompts.length);
    _init();
  }

  @override
  void dispose() {
    _controller?.dispose();
    _e2ee?.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    setState(() => _phase = _Phase.initializing);
    final supabase = Supabase.instance.client;

    try {
      // 1. Room lookup (public SELECT) + owner redirect.
      final room = await supabase
          .from('rooms')
          .select('id, slug, display_name, user_id')
          .eq('slug', widget.slug)
          .maybeSingle();
      if (room == null) {
        if (mounted) setState(() => _phase = _Phase.error);
        return;
      }
      _displayName = (room['display_name'] as String?) ?? 'Anonymous';

      final user = supabase.auth.currentUser;
      if (user != null && !user.isAnonymous && user.id == room['user_id']) {
        // Owner landed on their own link -> inbox (web parity).
        if (mounted) context.go('/inbox');
        return;
      }

      // 2. Silent anonymous session. On failure degrade to sign-in, never a
      //    dead-end (tasks/lessons.md).
      if (supabase.auth.currentSession == null) {
        try {
          await supabase.auth.signInAnonymously();
        } catch (_) {
          if (mounted) setState(() => _phase = _Phase.authFailed);
          return;
        }
      }

      // 3. Conversation upsert -> id.
      final conversationId =
          await ref.read(chatRepositoryProvider).openConversation(widget.slug);
      _conversationId = conversationId;

      // 4. E2EE (visitor keypair per conversation) + chat controller.
      _e2ee = E2eeManager(
        keysApi: KeysApi(ref.read(apiClientProvider)),
        slug: widget.slug,
        conversationId: conversationId,
        isOwnerView: false,
      )..init();
      _controller = ChatController(
        repository: ref.read(chatRepositoryProvider),
        supabase: supabase,
        slug: widget.slug,
        roomId: room['id'] as String,
        conversationId: conversationId,
        isOwnerView: false,
        cipher: _e2ee!,
      )..init();
      _controller!.addListener(_onChatState);
      _e2ee!.addListener(() {
        _controller?.retryFailedDecrypts();
        if (mounted) setState(() {});
      });

      final prefs = await SharedPreferences.getInstance();
      _explainerDismissed = prefs
              .getBool('wolow:anonymity-explainer-dismissed:$conversationId') ??
          false;
      _saveChatDismissed =
          prefs.getBool('wolow:save-chat-dismissed:$conversationId') ?? false;

      if (mounted) setState(() => _phase = _Phase.ready);
    } catch (_) {
      if (mounted) setState(() => _phase = _Phase.error);
    }
  }

  void _onChatState() {
    final messages = _controller?.value.messages ?? const [];
    final mine = messages.where((m) => !m.isOwner).length;
    if (mine != _visitorMessageCount) {
      _visitorMessageCount = mine;
    }
    if (mounted) setState(() {});
  }

  Future<void> _dismissExplainer() async {
    setState(() => _explainerDismissed = true);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(
        'wolow:anonymity-explainer-dismissed:$_conversationId', true);
  }

  Future<void> _dismissSaveChat() async {
    setState(() => _saveChatDismissed = true);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('wolow:save-chat-dismissed:$_conversationId', true);
  }

  /// Upgrade the anonymous session to Google keeps the same auth.uid, so
  /// the conversation and device E2EE keys survive.
  Future<void> _saveChat() async {
    try {
      await Supabase.instance.client.auth.linkIdentity(
        OAuthProvider.google,
        redirectTo: 'wolow://auth-callback',
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text("Couldn't open Google sign-in. Try again."),
        ));
      }
    }
  }

  String _rollDice() {
    _diceIndex = nextRandomIndex(_diceIndex, starterTemplates.length);
    return starterTemplates[_diceIndex];
  }

  Future<void> _enablePush() async {
    final conversationId = _conversationId;
    if (conversationId == null) return; // visitor subs are conversation-scoped
    final result = await ref
        .read(pushServiceProvider)
        .subscribe(slug: widget.slug, conversationId: conversationId);
    if (!mounted) return;
    final message = switch (result) {
      PushResult.subscribed => "You'll know when $_displayName replies.",
      PushResult.denied =>
        'Notifications are off for Wolow in system settings.',
      PushResult.failed => "Couldn't enable notifications. Try again.",
      PushResult.unconfigured => 'Notifications are not available yet.',
    };
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_displayName.isEmpty ? widget.slug : _displayName),
        actions: [
          if (_phase == _Phase.ready &&
              _conversationId != null &&
              PushService.isConfigured)
            IconButton(
              icon: const Icon(Icons.notifications_none),
              tooltip: 'Enable notifications',
              onPressed: _enablePush,
            ),
          if (_phase == _Phase.ready && _isAnonymous)
            TextButton(
              onPressed: () => context.go(
                  '/signin?next=${Uri.encodeComponent('/room/${widget.slug}')}'),
              child: const Text('This is your link?'),
            ),
        ],
      ),
      body: switch (_phase) {
        _Phase.initializing =>
          const Center(child: CircularProgressIndicator()),
        _Phase.authFailed => _AuthFallback(slug: widget.slug),
        _Phase.error => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text("Couldn't open this chat."),
                const SizedBox(height: 12),
                FilledButton(onPressed: _init, child: const Text('Try again')),
              ],
            ),
          ),
        _Phase.ready => Column(
            children: [
              if (!_explainerDismissed && _conversationId != null)
                _AnonymityExplainer(
                  nickname: funAnonymousName(_conversationId!),
                  emoji: funAnonymousEmoji(_conversationId!),
                  onDismiss: _dismissExplainer,
                ),
              if (_isAnonymous && !_saveChatDismissed && _visitorMessageCount > 0)
                _SaveChatBanner(onSave: _saveChat, onDismiss: _dismissSaveChat),
              Expanded(
                child: ChatView(
                  controller: _controller!,
                  isOwnerView: false,
                  placeholder:
                      'Send $_displayName an anonymous message\u2026',
                  showDice: true,
                  onDice: _rollDice,
                  emptyState: _InvitationCard(
                    prompt: invitationPrompts[_promptIndex],
                    onShuffle: () => setState(() {
                      _promptIndex = nextRandomIndex(
                          _promptIndex, invitationPrompts.length);
                    }),
                  ),
                ),
              ),
            ],
          ),
      },
    );
  }
}

class _AuthFallback extends StatelessWidget {
  const _AuthFallback({required this.slug});

  final String slug;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Sign in to send your message',
                style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
            const SizedBox(height: 8),
            const Text(
              'Anonymous access is briefly unavailable. Signing in keeps you '
              'anonymous to the recipient.',
              textAlign: TextAlign.center,
              style: TextStyle(color: WolowColors.muted, fontSize: 13),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => context
                  .go('/signin?next=${Uri.encodeComponent('/room/$slug')}'),
              child: const Text('Continue with Google'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AnonymityExplainer extends StatelessWidget {
  const _AnonymityExplainer({
    required this.nickname,
    required this.emoji,
    required this.onDismiss,
  });

  final String nickname;
  final String emoji;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: WolowColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: WolowColors.border),
      ),
      child: Row(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 22)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              "You'll appear as \u201C$nickname\u201D. Your name is never shown.",
              style: const TextStyle(fontSize: 12.5, color: WolowColors.muted),
            ),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.close, size: 16),
            onPressed: onDismiss,
          ),
        ],
      ),
    );
  }
}

class _SaveChatBanner extends StatelessWidget {
  const _SaveChatBanner({required this.onSave, required this.onDismiss});

  final VoidCallback onSave;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        gradient: WolowColors.accentGradient,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Expanded(
            child: Text(
              "Don't lose this chat sign in to keep it on all your devices.",
              style: TextStyle(fontSize: 12.5),
            ),
          ),
          TextButton(
            onPressed: onSave,
            style: TextButton.styleFrom(foregroundColor: Colors.white),
            child: const Text('Save chat'),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.close, size: 16, color: Colors.white),
            onPressed: onDismiss,
          ),
        ],
      ),
    );
  }
}

class _InvitationCard extends StatelessWidget {
  const _InvitationCard({required this.prompt, required this.onShuffle});

  final String prompt;
  final VoidCallback onShuffle;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              prompt,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: onShuffle,
              icon: const Icon(Icons.casino_outlined, size: 18),
              label: const Text('Another idea'),
            ),
          ],
        ),
      ),
    );
  }
}
