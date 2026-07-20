import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme.dart';
import 'features/push/push_service.dart';
import 'router.dart';

class WolowApp extends ConsumerStatefulWidget {
  const WolowApp({super.key});

  @override
  ConsumerState<WolowApp> createState() => _WolowAppState();
}

class _WolowAppState extends ConsumerState<WolowApp> {
  final _appLinks = AppLinks();
  StreamSubscription<Uri>? _linkSub;

  @override
  void initState() {
    super.initState();
    _initDeepLinks();
    // Push-notification taps navigate like web push (data.url is a web path).
    wirePushTapNavigation((webPath) {
      final location = mapWebUrlToLocation(Uri.parse(webPath));
      if (location != null) ref.read(routerProvider).go(location);
    });
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    super.dispose();
  }

  Future<void> _initDeepLinks() async {
    // Cold-start link (app opened from a wolow.app URL).
    try {
      final initial = await _appLinks.getInitialLink();
      if (initial != null) _handleLink(initial);
    } catch (_) {
      // No initial link.
    }
    // Warm links while running.
    _linkSub = _appLinks.uriLinkStream.listen(_handleLink, onError: (_) {});
  }

  void _handleLink(Uri uri) {
    // OAuth callbacks (wolow:// scheme or ?code=) belong to supabase_flutter's
    // own listener never route them.
    if (uri.scheme == 'wolow') return;
    if (uri.queryParameters.containsKey('code')) return;

    final location = mapWebUrlToLocation(uri);
    if (location == null) return;
    ref.read(routerProvider).go(location);
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Wolow',
      debugShowCheckedModeBanner: false,
      theme: buildWolowTheme(),
      routerConfig: router,
    );
  }
}
