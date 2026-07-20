/// Port of src/lib/relative-time.ts.
library;

String relativeTime(DateTime date, {DateTime? now}) {
  final seconds =
      ((now ?? DateTime.now()).difference(date).inMilliseconds / 1000).floor();

  if (seconds < 30) return 'just now';
  if (seconds < 3600) return '${seconds ~/ 60}m ago';
  if (seconds < 86400) return '${seconds ~/ 3600}h ago';
  return '${seconds ~/ 86400}d ago';
}
