import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/api_client.dart';
import '../../core/env.dart';
import '../../core/theme.dart';
import '../../core/utils/slug.dart';
import 'session_providers.dart';

const _nameMax = 40; // must match PATCH /api/rooms/[slug]

enum _Availability { idle, checking, available, taken, invalid, own, unchecked }

/// 3-step onboarding wizard, ported from web WelcomeWizard:
/// 1. pick display name + claim slug (live availability, auto-suffix once)
/// 2. copy the link
/// 3. share it -> mark onboarding complete -> inbox
class WelcomeScreen extends ConsumerStatefulWidget {
  const WelcomeScreen({super.key});

  @override
  ConsumerState<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends ConsumerState<WelcomeScreen> {
  int _step = 1;

  final _nameController = TextEditingController();
  final _slugController = TextEditingController();

  String _savedName = '';
  String _effectiveSlug = '';
  var _availability = _Availability.idle;
  String? _availabilityMessage;
  bool _claiming = false;
  String? _claimError;
  bool _autoSuffixed = false;
  bool _copied = false;
  bool _finishing = false;
  bool _seeded = false;

  Timer? _debounce;

  String get _link => '${Env.appUrl}/$_effectiveSlug';

  @override
  void initState() {
    super.initState();
    _slugController.addListener(_onSlugChanged);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _nameController.dispose();
    _slugController.dispose();
    super.dispose();
  }

  void _seedFromRoom(OwnedRoom room) {
    if (_seeded) return;
    _seeded = true;
    _savedName = room.displayName;
    _effectiveSlug = room.slug;
    _nameController.text = room.displayName;
    _slugController.text = suggestSlugFromName(room.displayName);
  }

  // Live slug availability (debounced 400ms, direct Supabase read the
  // same query the web wizard runs).
  void _onSlugChanged() {
    final candidate = _slugController.text.trim().toLowerCase();
    _debounce?.cancel();

    if (candidate.isEmpty) {
      setState(() => _availability = _Availability.idle);
      return;
    }

    final validation = validateSlug(candidate);
    if (validation is SlugInvalid) {
      setState(() {
        _availability = _Availability.invalid;
        _availabilityMessage = validation.message;
      });
      return;
    }

    final slug = (validation as SlugValid).slug;
    if (slug == _effectiveSlug) {
      setState(() => _availability = _Availability.own);
      return;
    }

    setState(() => _availability = _Availability.checking);
    _debounce = Timer(const Duration(milliseconds: 400), () async {
      try {
        final data = await Supabase.instance.client
            .from('rooms')
            .select('id')
            .eq('slug', slug)
            .maybeSingle();
        if (!mounted) return;

        if (data != null) {
          // First suggestion taken? Auto-retry once with a fun suffix.
          if (!_autoSuffixed) {
            _autoSuffixed = true;
            final head =
                slug.length > slugMax - 3 ? slug.substring(0, slugMax - 3) : slug;
            _slugController.text = '$head${randomSlugSuffix(3)}';
            return;
          }
          setState(() => _availability = _Availability.taken);
        } else {
          setState(() => _availability = _Availability.available);
        }
      } catch (_) {
        if (mounted) setState(() => _availability = _Availability.unchecked);
      }
    });
  }

  Future<void> _claim() async {
    setState(() => _claimError = null);

    final name = _nameController.text.trim();
    if (name.isEmpty || name.length > _nameMax) {
      setState(() => _claimError = 'Name must be 1\u2013$_nameMax characters.');
      return;
    }

    final validation = validateSlug(_slugController.text);
    if (validation is SlugInvalid) {
      setState(() => _claimError = validation.message);
      return;
    }
    final slug = (validation as SlugValid).slug;

    final body = <String, dynamic>{
      if (name != _savedName) 'display_name': name,
      if (slug != _effectiveSlug) 'slug': slug,
    };

    // Nothing changed just move on.
    if (body.isEmpty) {
      setState(() => _step = 2);
      return;
    }

    setState(() => _claiming = true);
    final api = ref.read(apiClientProvider);
    try {
      final data = await api.patch(
        '/api/rooms/${Uri.encodeComponent(_effectiveSlug)}',
        body: body,
      ) as Map<String, dynamic>?;

      setState(() {
        if (data?['slug'] is String) _effectiveSlug = data!['slug'] as String;
        if (data?['display_name'] is String) {
          _savedName = data!['display_name'] as String;
        }
        _step = 2;
      });
      _syncRoomProvider();
    } on ApiException catch (e) {
      setState(() {
        if (e.statusCode == 409) _availability = _Availability.taken;
        _claimError = e.message;
      });
    } catch (_) {
      setState(() => _claimError = 'Network error please try again.');
    } finally {
      if (mounted) setState(() => _claiming = false);
    }
  }

  void _syncRoomProvider({bool onboarded = false}) {
    final current = ref.read(ownedRoomProvider).value;
    if (current == null) return;
    ref.read(ownedRoomProvider.notifier).updateLocal(current.copyWith(
          slug: _effectiveSlug,
          displayName: _savedName,
          needsOnboarding: onboarded ? false : current.needsOnboarding,
        ));
  }

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: _link));
    setState(() => _copied = true);
    Timer(const Duration(milliseconds: 900), () {
      if (mounted) setState(() => _step = 3);
    });
  }

  /// Mark onboarding complete and land in the inbox. Never traps the user:
  /// if the PATCH fails, /welcome simply shows again next sign-in.
  Future<void> _finish() async {
    if (_finishing) return;
    setState(() => _finishing = true);
    final api = ref.read(apiClientProvider);
    try {
      await api.patch(
        '/api/rooms/${Uri.encodeComponent(_effectiveSlug)}',
        body: {'onboarding_completed': true},
      );
    } catch (_) {
      // Proceed regardless (web parity).
    }
    _syncRoomProvider(onboarded: true);
    if (mounted) context.go('/inbox');
  }

  Future<void> _share() async {
    final result = await SharePlus.instance.share(ShareParams(
      title: '$_savedName wants your anonymous messages',
      text: 'Send me an anonymous message on Wolow $_link',
    ));
    if (result.status == ShareResultStatus.success) {
      await _finish();
    }
    // Dismissed -> stay on this step (web parity).
  }

  @override
  Widget build(BuildContext context) {
    final roomAsync = ref.watch(ownedRoomProvider);
    final room = roomAsync.value;
    if (room != null) _seedFromRoom(room);

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: WolowColors.pageGradient),
        child: SafeArea(
          child: room == null
              ? _buildLoadingOrError(roomAsync)
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(28),
                  child: switch (_step) {
                    1 => _buildClaimStep(),
                    2 => _buildCopyStep(),
                    _ => _buildShareStep(),
                  },
                ),
        ),
      ),
    );
  }

  Widget _buildLoadingOrError(AsyncValue<OwnedRoom?> roomAsync) {
    if (roomAsync.hasError) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text("Couldn't load your link."),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => ref.read(ownedRoomProvider.notifier).refresh(),
                child: const Text('Try again'),
              ),
            ],
          ),
        ),
      );
    }
    return const Center(child: CircularProgressIndicator());
  }

  Widget _stepHeader(String title, String subtitle) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Step $_step of 3',
            style: textTheme.bodySmall?.copyWith(color: WolowColors.muted)),
        const SizedBox(height: 8),
        Text(title, style: textTheme.headlineMedium),
        const SizedBox(height: 6),
        Text(subtitle,
            style: textTheme.bodyMedium?.copyWith(color: WolowColors.muted)),
        const SizedBox(height: 28),
      ],
    );
  }

  Widget _buildClaimStep() {
    final availabilityLine = switch (_availability) {
      _Availability.checking => const Text('Checking\u2026',
          style: TextStyle(color: WolowColors.muted, fontSize: 12)),
      _Availability.available => const Text('Available!',
          style: TextStyle(color: Color(0xFF4ADE80), fontSize: 12)),
      _Availability.own => const Text('This is your current link',
          style: TextStyle(color: WolowColors.muted, fontSize: 12)),
      _Availability.taken => const Text('Already taken try another.',
          style: TextStyle(color: Color(0xFFFBBF24), fontSize: 12)),
      _Availability.invalid => Text(_availabilityMessage ?? '',
          style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 12)),
      _Availability.unchecked => const Text(
          "We'll confirm availability when you claim it",
          style: TextStyle(color: WolowColors.muted, fontSize: 12)),
      _Availability.idle => const SizedBox.shrink(),
    };

    final claimDisabled = _claiming ||
        _availability == _Availability.checking ||
        _availability == _Availability.taken ||
        _availability == _Availability.invalid;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _stepHeader('Claim your link', 'This is the link friends will use.'),
        TextField(
          controller: _nameController,
          maxLength: _nameMax,
          decoration: const InputDecoration(
            labelText: 'Display name',
            counterText: '',
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _slugController,
          maxLength: slugMax,
          autocorrect: false,
          decoration: InputDecoration(
            labelText: 'Your link',
            prefixText: '${Uri.parse(Env.appUrl).host}/',
            counterText: '',
          ),
        ),
        const SizedBox(height: 6),
        SizedBox(height: 18, child: availabilityLine),
        if (_claimError != null) ...[
          const SizedBox(height: 8),
          Text(_claimError!,
              style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: claimDisabled ? null : _claim,
          child: Text(_claiming ? 'Claiming\u2026' : 'Claim my link'),
        ),
      ],
    );
  }

  Widget _buildCopyStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _stepHeader('Copy your link', 'Put it in your bio, story, anywhere.'),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: WolowColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: WolowColors.border),
          ),
          child: Text(_link, textAlign: TextAlign.center),
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _copy,
          icon: Icon(_copied ? Icons.check : Icons.copy),
          label: Text(_copied ? 'Copied!' : 'Copy link'),
        ),
        TextButton(
          onPressed: () => setState(() => _step = 3),
          child: const Text('Next'),
        ),
      ],
    );
  }

  Widget _buildShareStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _stepHeader('Share it', 'Messages arrive in your inbox, anonymously.'),
        FilledButton.icon(
          onPressed: _share,
          icon: const Icon(Icons.ios_share),
          label: const Text('Share my link'),
        ),
        const SizedBox(height: 12),
        TextButton(
          onPressed: _finishing ? null : _finish,
          child: Text(_finishing ? 'Opening inbox\u2026' : 'Skip, go to my inbox'),
        ),
      ],
    );
  }
}
