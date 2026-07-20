/// Port of src/lib/fun-anonymous-name.ts behavior must stay identical so
/// the same conversation shows the same label on web and mobile.
library;

const _adjectives = [
  'Sunny', 'Cosmic', 'Neon', 'Lucky', 'Mellow', 'Brave', 'Sassy', 'Dapper',
  'Witty', 'Curious', 'Snappy', 'Chill', 'Zesty', 'Nimble', 'Jolly', 'Funky',
  'Velvet', 'Electric', 'Swift', 'Comet', 'Glowy', 'Clever', 'Peppy', 'Dreamy',
];

class _Creature {
  const _Creature(this.animal, this.emoji);
  final String animal;
  final String emoji;
}

const _creatures = [
  _Creature('Otter', '\u{1F9A6}'),
  _Creature('Fox', '\u{1F98A}'),
  _Creature('Panda', '\u{1F43C}'),
  _Creature('Koala', '\u{1F428}'),
  _Creature('Falcon', '\u{1F985}'),
  _Creature('Lynx', '\u{1F431}'),
  _Creature('Rabbit', '\u{1F430}'),
  _Creature('Dolphin', '\u{1F42C}'),
  _Creature('Raven', '\u{1F426}'),
  _Creature('Tiger', '\u{1F42F}'),
  _Creature('Gecko', '\u{1F98E}'),
  _Creature('Hedgehog', '\u{1F994}'),
  _Creature('Jaguar', '\u{1F406}'),
  _Creature('Walrus', '\u{1F9AD}'),
  _Creature('Cobra', '\u{1F40D}'),
  _Creature('Moose', '\u{1FACE}'),
  _Creature('Parrot', '\u{1F99C}'),
  _Creature('Shark', '\u{1F988}'),
  _Creature('Bison', '\u{1F9AC}'),
  _Creature('Wolf', '\u{1F43A}'),
  _Creature('Toucan', '\u{1F99C}'),
  _Creature('Penguin', '\u{1F427}'),
  _Creature('Yak', '\u{1F403}'),
  _Creature('Wombat', '\u{1F43B}'),
];

/// JS: `hash = (hash * 31 + input.charCodeAt(i)) >>> 0`
/// Dart `codeUnitAt` matches `charCodeAt` (UTF-16 code units); the & mask
/// reproduces the unsigned 32-bit wrap of `>>> 0`.
int _hashString(String input) {
  var hash = 0;
  for (var i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.codeUnitAt(i)) & 0xFFFFFFFF;
  }
  return hash;
}

String funAnonymousName(String conversationId) {
  final hash = _hashString(conversationId);
  final adjective = _adjectives[hash % _adjectives.length];
  final creature = _creatures[(hash ~/ _adjectives.length) % _creatures.length];
  return '$adjective ${creature.animal}';
}

String funAnonymousEmoji(String conversationId) {
  final hash = _hashString(conversationId);
  final creature = _creatures[(hash ~/ _adjectives.length) % _creatures.length];
  return creature.emoji;
}

String nameInitials(String name) {
  final words =
      name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return '?';
  if (words.length == 1) {
    final w = words[0];
    return w.substring(0, w.length < 2 ? w.length : 2).toUpperCase();
  }
  return '${words[0][0]}${words[1][0]}'.toUpperCase();
}
