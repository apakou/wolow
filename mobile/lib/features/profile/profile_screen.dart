import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../auth/session_providers.dart';

/// Account screen: Google identity, links to settings/help, sign out.
/// Ported from web ProfileClient.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final room = ref.watch(ownedRoomProvider).value;

    final avatarUrl = user?.userMetadata?['avatar_url'] as String?;
    final fullName = user?.userMetadata?['full_name'] as String? ?? 'You';
    final email = user?.email ?? '';

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: WolowColors.surfaceLight,
                backgroundImage:
                    avatarUrl != null ? NetworkImage(avatarUrl) : null,
                child: avatarUrl == null ? const Icon(Icons.person) : null,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(fullName,
                        style: Theme.of(context).textTheme.titleLarge),
                    if (email.isNotEmpty)
                      Text(email,
                          style: const TextStyle(color: WolowColors.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          if (room != null)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: WolowColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: WolowColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Your link',
                      style: TextStyle(color: WolowColors.muted, fontSize: 12)),
                  const SizedBox(height: 4),
                  Text('wolow.app/${room.slug}'),
                ],
              ),
            ),
          const SizedBox(height: 24),
          ListTile(
            leading: const Icon(Icons.lock_outline),
            title: const Text('Encryption & backup'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/settings'),
          ),
          ListTile(
            leading: const Icon(Icons.help_outline),
            title: const Text('Help & FAQ'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/help'),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () async {
              await signOutLocal();
              // Router redirect takes over on auth change.
            },
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFF87171),
              side: const BorderSide(color: WolowColors.border),
            ),
          ),
        ],
      ),
    );
  }
}
