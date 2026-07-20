import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import 'google_auth.dart';

/// Sign-in screen. Mirrors the web `/` page: brand pitch + Google button,
/// with contextual invite copy when arriving via a visitor deep link
/// (`next=/room/{slug}`).
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key, this.next});

  final String? next;

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  bool _connecting = false;
  String? _error;

  bool get _isVisitorInvite => widget.next?.startsWith('/room/') ?? false;

  Future<void> _signIn() async {
    setState(() {
      _connecting = true;
      _error = null;
    });
    try {
      await signInWithGoogleNative();
      // Navigation happens via the router redirect on auth state change.
    } on SignInCancelled {
      // Not an error; just re-enable the button.
    } catch (e) {
      setState(() {
        _error = "Couldn't sign in please try again.";
      });
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: WolowColors.pageGradient),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ShaderMask(
                  shaderCallback: (bounds) =>
                      WolowColors.accentGradient.createShader(bounds),
                  child: Text(
                    'Wolow',
                    textAlign: TextAlign.center,
                    style: textTheme.displayMedium?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  _isVisitorInvite
                      ? 'Sign in to keep your chats'
                      : 'Share your link, get honest messages',
                  textAlign: TextAlign.center,
                  style: textTheme.titleMedium
                      ?.copyWith(color: WolowColors.muted),
                ),
                const SizedBox(height: 40),
                FilledButton.icon(
                  onPressed: _connecting ? null : _signIn,
                  icon: const Icon(Icons.login),
                  label: Text(
                      _connecting ? 'Connecting\u2026' : 'Continue with Google'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFFF87171)),
                  ),
                ],
                const SizedBox(height: 24),
                Text(
                  'Anonymous to friends & end-to-end encrypted',
                  textAlign: TextAlign.center,
                  style:
                      textTheme.bodySmall?.copyWith(color: WolowColors.muted),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
