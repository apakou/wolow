import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// Static FAQ, ported from the web /help page.
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const entries = [
      (
        'Do senders need an account?',
        'No. Anyone with your link can message you without signing in. '
            'Senders stay anonymous to you.',
      ),
      (
        'Is it really anonymous?',
        'You never see who sent a message only a fun nickname like '
            '"Sunny Otter". We use sign-in behind the scenes to prevent spam, '
            'but the recipient never sees the sender\u2019s identity.',
      ),
      (
        'What does end-to-end encrypted mean?',
        'Messages are encrypted on your device and can only be read by you '
            'and the other side of the conversation. Back up your key in '
            'Settings so you never lose access.',
      ),
      (
        'What if I lose my key?',
        'Restore it from your .wolow-key backup file in Settings. Without a '
            'backup, older messages can\u2019t be decrypted.',
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Help & FAQ')),
      body: ListView.separated(
        padding: const EdgeInsets.all(20),
        itemCount: entries.length,
        separatorBuilder: (_, _) => const SizedBox(height: 16),
        itemBuilder: (context, i) {
          final (q, a) = entries[i];
          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: WolowColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: WolowColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(q, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(a, style: const TextStyle(color: WolowColors.muted)),
              ],
            ),
          );
        },
      ),
    );
  }
}
