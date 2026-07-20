/// Port of src/lib/slug.ts the rules must never drift from the server,
/// which validates with the same constants in PATCH /api/rooms/[slug].
library;

import 'dart:math';

import 'package:diacritic/diacritic.dart';

const slugMin = 3;
const slugMax = 20;
final slugRegex = RegExp(r'^[a-z0-9][a-z0-9_-]{2,19}$');

/// Names that collide with app routes / static assets, or that we don't
/// want squatted. Checked against the lowercased candidate.
const reservedSlugs = {
  // Existing app routes
  'api', 'auth', 'settings', 'help', 'sent', 'welcome', 'inbox',
  // Static assets / platform paths
  '_next', 'public', 'static', 'assets', 'icons', 'images', 'fonts',
  'sw', 'manifest', 'favicon', 'robots', 'sitemap',
  // API sub-paths under /api/rooms/{slug} (would shadow static routes)
  'provision',
  // Likely future routes & brand protection
  'about', 'admin', 'app', 'blog', 'contact', 'home', 'login', 'logout',
  'me', 'new', 'official', 'privacy', 'root', 'signin', 'signout', 'signup',
  'support', 'terms', 'wolow',
};

enum SlugInvalidReason { length, format, reserved }

const slugErrorMessages = {
  SlugInvalidReason.length: 'Must be $slugMin\u2013$slugMax characters.',
  SlugInvalidReason.format:
      'Only lowercase letters, numbers, - and _ (must start with a letter or number).',
  SlugInvalidReason.reserved: 'That name is reserved try another one.',
};

sealed class SlugValidation {
  const SlugValidation();
}

class SlugValid extends SlugValidation {
  const SlugValid(this.slug);
  final String slug;
}

class SlugInvalid extends SlugValidation {
  const SlugInvalid(this.reason);
  final SlugInvalidReason reason;

  String get message => slugErrorMessages[reason]!;
}

/// Normalize + validate a user-supplied slug candidate.
SlugValidation validateSlug(String raw) {
  final slug = raw.trim().toLowerCase();
  if (slug.length < slugMin || slug.length > slugMax) {
    return const SlugInvalid(SlugInvalidReason.length);
  }
  if (!slugRegex.hasMatch(slug)) {
    return const SlugInvalid(SlugInvalidReason.format);
  }
  if (reservedSlugs.contains(slug)) {
    return const SlugInvalid(SlugInvalidReason.reserved);
  }
  return SlugValid(slug);
}

final _random = Random();

/// Random lowercase alphanumeric suffix, e.g. "x7k".
String randomSlugSuffix([int length = 3]) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  final out = StringBuffer();
  for (var i = 0; i < length; i++) {
    out.write(alphabet[_random.nextInt(alphabet.length)]);
  }
  return out.toString();
}

/// Suggest a slug from a display name: "Amina Diallo" -> "amina".
/// Falls back to padding with random characters when the result is too
/// short, and never returns a reserved name.
///
/// Web uses NFKD + combining-mark strip; [removeDiacritics] matches it for
/// the latin scripts that survive the `[^a-z0-9]` filter anyway.
String suggestSlugFromName(String name) {
  var base = removeDiacritics(name.toLowerCase())
      .replaceAll(RegExp(r'[^a-z0-9]+'), '');
  if (base.length > slugMax) base = base.substring(0, slugMax);

  if (base.length < slugMin) {
    base = base + randomSlugSuffix(slugMin);
    if (base.length > slugMax) base = base.substring(0, slugMax);
  }
  if (reservedSlugs.contains(base)) {
    final head = base.length > slugMax - 3 ? base.substring(0, slugMax - 3) : base;
    base = '$head${randomSlugSuffix(3)}';
  }
  return base;
}
