import 'package:flutter_test/flutter_test.dart';
import 'package:wolow/core/utils/relative_time.dart';
import 'package:wolow/core/utils/slug.dart';

void main() {
  group('relativeTime (web thresholds: 30s / 1h / 1d)', () {
    final now = DateTime(2026, 7, 20, 12, 0, 0);
    String at(Duration ago) => relativeTime(now.subtract(ago), now: now);

    test('just now under 30s', () {
      expect(at(Duration.zero), 'just now');
      expect(at(const Duration(seconds: 29)), 'just now');
    });
    test('minutes from 30s to 1h', () {
      expect(at(const Duration(seconds: 30)), '0m ago');
      expect(at(const Duration(minutes: 59, seconds: 59)), '59m ago');
    });
    test('hours to 1d', () {
      expect(at(const Duration(hours: 1)), '1h ago');
      expect(at(const Duration(hours: 23, minutes: 59)), '23h ago');
    });
    test('days after', () {
      expect(at(const Duration(hours: 24)), '1d ago');
      expect(at(const Duration(days: 12)), '12d ago');
    });
  });

  group('validateSlug (same rules as server PATCH)', () {
    test('valid slugs normalize', () {
      final v = validateSlug('  MyName_9 ');
      expect(v, isA<SlugValid>());
      expect((v as SlugValid).slug, 'myname_9');
    });
    test('length bounds', () {
      expect((validateSlug('ab') as SlugInvalid).reason, SlugInvalidReason.length);
      expect(validateSlug('abc'), isA<SlugValid>());
      expect(validateSlug('a' * 20), isA<SlugValid>());
      expect((validateSlug('a' * 21) as SlugInvalid).reason,
          SlugInvalidReason.length);
    });
    test('format: must start alphanumeric, charset limited', () {
      expect((validateSlug('-abc') as SlugInvalid).reason,
          SlugInvalidReason.format);
      expect((validateSlug('ab c') as SlugInvalid).reason,
          SlugInvalidReason.format);
      expect((validateSlug('abé') as SlugInvalid).reason, SlugInvalidReason.format);
      expect(validateSlug('a-b_c'), isA<SlugValid>());
    });
    test('reserved names (including provision, matching the web list)', () {
      for (final s in ['api', 'inbox', 'welcome', 'provision', 'wolow']) {
        expect((validateSlug(s) as SlugInvalid).reason,
            SlugInvalidReason.reserved,
            reason: s);
      }
    });
  });

  group('suggestSlugFromName (web behavior)', () {
    test('simple name', () {
      expect(suggestSlugFromName('Amina Diallo'), 'aminadiallo');
    });
    test('accents stripped like NFKD', () {
      expect(suggestSlugFromName('José Ötvös'), 'joseotvos');
    });
    test('short names get padded to >= 3 and stay valid', () {
      final out = suggestSlugFromName('Al');
      expect(out.length, greaterThanOrEqualTo(slugMin));
      expect(validateSlug(out), isA<SlugValid>());
    });
    test('reserved suggestion gets suffixed', () {
      final out = suggestSlugFromName('Inbox');
      expect(reservedSlugs.contains(out), isFalse);
      expect(validateSlug(out), isA<SlugValid>());
    });
    test('long names truncated to max', () {
      final out = suggestSlugFromName('Maximiliano Alessandro Fitzgerald');
      expect(out.length, lessThanOrEqualTo(slugMax));
    });
  });
}
