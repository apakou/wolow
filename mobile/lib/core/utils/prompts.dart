/// Port of src/lib/prompts.ts sender-side prompt content.
library;

import 'dart:math';

const starterTemplates = [
  'my honest opinion of you: ',
  '3 emojis that describe you: ',
  'confession time \u{1F64A} ',
  "something I've never told you: ",
  'first impression vs now: ',
  'roast incoming \u{1F525} ',
  'real talk: ',
  'hot take: ',
  'I always wondered\u2026 ',
  'secret: \u{1F92B} ',
];

/// Reply starters for the room owner answering an anonymous sender.
const replyTemplates = [
  'ok, honest answer: ',
  'wait, tell me more: ',
  'haha fair. my turn: ',
  'I knew it \u{1F60F} ',
  'who is this?? \u{1F440} ',
  'that one hit different\u2026 ',
  'real talk back: ',
  'hmm, interesting. why? ',
];

const invitationPrompts = [
  "what's something you'd never say to my face? \u{1F92B}",
  'drop your honest opinion of me \u{1F440}',
  'describe me in 3 emojis \u2728',
  "tell me a secret. I'll keep it \u{1F512}",
  'roast me. no mercy \u{1F525}',
  'confess something \u{1F64A}',
];

final _random = Random();

/// Pick a random index different from the current one (when possible).
int nextRandomIndex(int current, int length) {
  if (length <= 1) return 0;
  var next = current;
  while (next == current) {
    next = _random.nextInt(length);
  }
  return next;
}
