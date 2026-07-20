import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/utils/relative_time.dart';
import 'chat_controller.dart';
import 'models.dart';

/// Shared chat surface for both roles (owner thread + visitor room),
/// ported from src/components/ChatView.tsx.
class ChatView extends StatefulWidget {
  const ChatView({
    super.key,
    required this.controller,
    required this.isOwnerView,
    this.placeholder = 'Send an anonymous message\u2026',
    this.composerDisabled = false,
    this.disabledBanner,
    this.emptyState,
    this.showDice = false,
    this.onDice,
  });

  final ChatController controller;
  final bool isOwnerView;
  final String placeholder;
  final bool composerDisabled;

  /// Rendered instead of the composer (e.g. blocked-conversation banner).
  final Widget? disabledBanner;
  final Widget? emptyState;
  final bool showDice;
  final String Function()? onDice;

  @override
  State<ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends State<ChatView> with WidgetsBindingObserver {
  final _scrollController = ScrollController();
  final _inputController = TextEditingController();
  Timer? _timeRefresh;
  String? _pickerForMessageId;

  ChatController get controller => widget.controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    controller.onOwnSend = _scrollToBottomSoon;
    controller.addListener(_onState);
    // Relative timestamps refresh every 30s (web parity).
    _timeRefresh = Timer.periodic(
      const Duration(seconds: 30),
      (_) => setState(() {}),
    );
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    controller.removeListener(_onState);
    _timeRefresh?.cancel();
    _scrollController.dispose();
    _inputController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Mobile OS freezes sockets in background; refetch on resume.
    if (state == AppLifecycleState.resumed) controller.onAppResumed();
  }

  bool _isAtBottom() {
    if (!_scrollController.hasClients) return true;
    final position = _scrollController.position;
    return position.maxScrollExtent - position.pixels < 40;
  }

  void _onScroll() {
    if (_isAtBottom() && controller.value.newMessageToast) {
      controller.clearToast();
    }
  }

  int _lastCount = 0;
  bool _didInitialScroll = false;

  void _onState() {
    final state = controller.value;
    // Auto-scroll when at bottom and messages changed; initial scroll on load.
    if (state.messages.length != _lastCount) {
      _lastCount = state.messages.length;
      if (_isAtBottom() || !_didInitialScroll) _scrollToBottomSoon();
    }
    if (state.loaded && !_didInitialScroll) {
      _didInitialScroll = true;
      _scrollToBottomSoon();
    }
    setState(() {});
  }

  void _scrollToBottomSoon() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _submit() async {
    final text = _inputController.text;
    if (text.trim().isEmpty) return;
    _inputController.clear();
    await controller.send(text, composerDisabled: widget.composerDisabled);
  }

  void _insertDice() {
    final template = widget.onDice?.call();
    if (template == null) return;
    if (_inputController.text.trim().isNotEmpty) return; // never clobber
    _inputController.text = template;
    _inputController.selection =
        TextSelection.collapsed(offset: template.length);
  }

  @override
  Widget build(BuildContext context) {
    final state = controller.value;

    return Column(
      children: [
        if (state.reconnecting)
          Container(
            width: double.infinity,
            color: WolowColors.surfaceLight,
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: const Text(
              'Reconnecting\u2026',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: WolowColors.muted),
            ),
          ),
        Expanded(
          child: Stack(
            children: [
              _buildList(state),
              if (state.newMessageToast)
                Positioned(
                  bottom: 12,
                  left: 0,
                  right: 0,
                  child: Center(
                    child: FilledButton.tonal(
                      onPressed: () {
                        controller.clearToast();
                        _scrollToBottomSoon();
                      },
                      child: const Text('New message \u2193'),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (state.error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    state.error!,
                    style:
                        const TextStyle(color: Color(0xFFF87171), fontSize: 12),
                  ),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.close, size: 14),
                  onPressed: controller.clearError,
                ),
              ],
            ),
          ),
        widget.disabledBanner ?? _buildComposer(state),
      ],
    );
  }

  Widget _buildList(ChatState state) {
    if (!state.loaded) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.loadError && state.messages.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text("Couldn't load messages."),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: controller.refetch,
              child: const Text('Try again'),
            ),
          ],
        ),
      );
    }
    if (state.messages.isEmpty) {
      return widget.emptyState ??
          const Center(
            child: Text('No messages yet',
                style: TextStyle(color: WolowColors.muted)),
          );
    }

    final byId = {for (final m in state.messages) m.id: m};

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      itemCount: state.messages.length,
      itemBuilder: (context, index) {
        final message = state.messages[index];
        final replied = message.replyToMessageId != null
            ? byId[message.replyToMessageId]
            : null;
        return _MessageRow(
          key: ValueKey(message.id),
          message: message,
          isMine: widget.isOwnerView ? message.isOwner : !message.isOwner,
          repliedPreview: replied == null
              ? null
              : (replied.decryptError != null
                  ? '[encrypted message]'
                  : replied.displayContent),
          pickerOpen: _pickerForMessageId == message.id,
          reactionBusy: state.reactionBusy,
          onLongPress: message.pending
              ? null
              : () => setState(() => _pickerForMessageId = message.id),
          onDismissPicker: () => setState(() => _pickerForMessageId = null),
          onSwipeReply: () => controller.setReplyTo(message),
          onReplyFromPicker: () {
            controller.setReplyTo(message);
            setState(() => _pickerForMessageId = null);
          },
          onToggleReaction: (emoji, hasReacted) {
            setState(() => _pickerForMessageId = null);
            controller.toggleReaction(message.id, emoji, hasReacted);
          },
        );
      },
    );
  }

  Widget _buildComposer(ChatState state) {
    final replyTo = state.replyTo;
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (replyTo != null)
            Container(
              margin: const EdgeInsets.fromLTRB(12, 4, 12, 0),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: WolowColors.surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: WolowColors.border),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Replying to',
                            style: TextStyle(
                                fontSize: 11, color: WolowColors.muted)),
                        Text(
                          replyTo.content,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.close, size: 16),
                    onPressed: controller.clearReplyTo,
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (widget.showDice)
                  IconButton(
                    onPressed: widget.composerDisabled ? null : _insertDice,
                    icon: const Text('\u{1F3B2}', style: TextStyle(fontSize: 20)),
                    tooltip: 'Message ideas',
                  ),
                Expanded(
                  child: TextField(
                    controller: _inputController,
                    enabled: !widget.composerDisabled,
                    maxLength: maxMessageLength,
                    maxLines: 5,
                    minLines: 1,
                    textInputAction: TextInputAction.newline,
                    style: const TextStyle(fontSize: 16),
                    decoration: InputDecoration(
                      hintText: widget.placeholder,
                      counterText: '',
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 8),
                _SendButton(
                  busy: state.hasPendingMessages,
                  enabled: _inputController.text.trim().isNotEmpty &&
                      !widget.composerDisabled,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  const _SendButton({
    required this.busy,
    required this.enabled,
    required this.onPressed,
  });

  final bool busy;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 44,
      height: 44,
      child: FilledButton(
        onPressed: enabled ? onPressed : null,
        style: FilledButton.styleFrom(
          padding: EdgeInsets.zero,
          shape: const CircleBorder(),
        ),
        child: busy
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: Colors.white),
              )
            : const Icon(Icons.arrow_upward, size: 20),
      ),
    );
  }
}

const _swipeReplyPx = 56.0; // web SWIPE_REPLY_PX

class _MessageRow extends StatefulWidget {
  const _MessageRow({
    super.key,
    required this.message,
    required this.isMine,
    required this.repliedPreview,
    required this.pickerOpen,
    required this.reactionBusy,
    required this.onLongPress,
    required this.onDismissPicker,
    required this.onSwipeReply,
    required this.onReplyFromPicker,
    required this.onToggleReaction,
  });

  final Message message;
  final bool isMine;
  final String? repliedPreview;
  final bool pickerOpen;
  final Set<String> reactionBusy;
  final VoidCallback? onLongPress;
  final VoidCallback onDismissPicker;
  final VoidCallback onSwipeReply;
  final VoidCallback onReplyFromPicker;
  final void Function(String emoji, bool hasReacted) onToggleReaction;

  @override
  State<_MessageRow> createState() => _MessageRowState();
}

class _MessageRowState extends State<_MessageRow> {
  double _dragOffset = 0;

  Message get message => widget.message;

  bool get _swipeAllowed =>
      !message.pending &&
      message.decryptError == null &&
      message.displayContent.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final bubble = _buildBubble(context);

    return Column(
      crossAxisAlignment:
          widget.isMine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onLongPress: widget.onLongPress,
          // My bubbles swipe left, theirs swipe right (web parity).
          onHorizontalDragUpdate: !_swipeAllowed
              ? null
              : (details) {
                  setState(() {
                    final next = _dragOffset + details.delta.dx;
                    _dragOffset = widget.isMine
                        ? next.clamp(-_swipeReplyPx * 1.4, 0.0)
                        : next.clamp(0.0, _swipeReplyPx * 1.4);
                  });
                },
          onHorizontalDragEnd: !_swipeAllowed
              ? null
              : (_) {
                  final triggered = widget.isMine
                      ? _dragOffset <= -_swipeReplyPx
                      : _dragOffset >= _swipeReplyPx;
                  if (triggered) widget.onSwipeReply();
                  setState(() => _dragOffset = 0);
                },
          child: AnimatedContainer(
            duration: _dragOffset == 0
                ? const Duration(milliseconds: 150)
                : Duration.zero,
            transform: Matrix4.translationValues(_dragOffset, 0, 0),
            child: bubble,
          ),
        ),
        if (widget.pickerOpen) _buildPicker(),
        if (message.reactions.isNotEmpty && !message.pending)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Wrap(
              spacing: 4,
              children: [
                for (final r in message.reactions)
                  _ReactionPill(
                    reaction: r,
                    busy: widget.reactionBusy
                        .contains('${message.id}:${r.emoji}'),
                    onTap: () =>
                        widget.onToggleReaction(r.emoji, r.reactedByMe),
                  ),
              ],
            ),
          ),
        if (!message.pending)
          Padding(
            padding: const EdgeInsets.only(top: 2, bottom: 8),
            child: Text(
              relativeTime(
                DateTime.tryParse(message.createdAt)?.toLocal() ??
                    DateTime.now(),
              ),
              style: const TextStyle(fontSize: 10, color: WolowColors.muted),
            ),
          )
        else
          const SizedBox(height: 8),
      ],
    );
  }

  Widget _buildBubble(BuildContext context) {
    final failed = message.failed;
    final decoration = BoxDecoration(
      gradient: widget.isMine && !failed ? WolowColors.accentGradient : null,
      color: failed
          ? const Color(0xFF7F1D1D)
          : (widget.isMine ? null : WolowColors.surfaceLight),
      borderRadius: BorderRadius.only(
        topLeft: const Radius.circular(16),
        topRight: const Radius.circular(16),
        bottomLeft: Radius.circular(widget.isMine ? 16 : 4),
        bottomRight: Radius.circular(widget.isMine ? 4 : 16),
      ),
    );

    final decryptFailed = message.decryptError != null;

    return Opacity(
      opacity: message.pending ? 0.5 : 1,
      child: Container(
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: decoration,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (message.replyToMessageId != null &&
                widget.repliedPreview != null)
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Replying to',
                        style: TextStyle(
                            fontSize: 10, color: WolowColors.muted)),
                    Text(
                      widget.repliedPreview!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ],
                ),
              ),
            if (decryptFailed)
              Text(
                message.decryptError!.message,
                style: const TextStyle(
                    fontSize: 13,
                    fontStyle: FontStyle.italic,
                    color: WolowColors.muted),
              )
            else
              Text(message.displayContent,
                  style: const TextStyle(fontSize: 15)),
            if (failed)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('Failed to send',
                    style: TextStyle(fontSize: 11, color: Color(0xFFFCA5A5))),
              ),
            if (message.encryptedContent != null && !failed)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('\u{1F512}', style: TextStyle(fontSize: 9)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildPicker() {
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: WolowColors.surfaceLighter,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final emoji in reactionOptions)
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: widget.reactionBusy.contains('${message.id}:$emoji')
                  ? null
                  : () {
                      final hasReacted = message.reactions
                          .any((r) => r.emoji == emoji && r.reactedByMe);
                      widget.onToggleReaction(emoji, hasReacted);
                    },
              icon: Text(emoji, style: const TextStyle(fontSize: 18)),
            ),
          if (message.decryptError == null)
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: widget.onReplyFromPicker,
              icon: const Icon(Icons.reply, size: 18),
              tooltip: 'Reply',
            ),
          IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: widget.onDismissPicker,
            icon: const Icon(Icons.close, size: 16),
          ),
        ],
      ),
    );
  }
}

class _ReactionPill extends StatelessWidget {
  const _ReactionPill({
    required this.reaction,
    required this.busy,
    required this.onTap,
  });

  final Reaction reaction;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: busy ? null : onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: reaction.reactedByMe
              ? WolowColors.accent.withValues(alpha: 0.4)
              : WolowColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: reaction.reactedByMe
                ? WolowColors.accent
                : WolowColors.border,
          ),
        ),
        child: Text(
          '${reaction.emoji} ${reaction.count}',
          style: const TextStyle(fontSize: 12),
        ),
      ),
    );
  }
}
