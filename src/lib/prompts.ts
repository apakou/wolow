/**
 * Sender-side prompt content for the playful visitor experience.
 *
 * STARTER_TEMPLATES are inserted into the composer by the dice button —
 * they lower the effort of writing a first anonymous message.
 * INVITATION_PROMPTS rotate on the empty-state card to set the mood.
 */

export const STARTER_TEMPLATES = [
  "my honest opinion of you: ",
  "3 emojis that describe you: ",
  "confession time 🙊 ",
  "something I've never told you: ",
  "first impression vs now: ",
  "roast incoming 🔥 ",
  "real talk: ",
  "hot take: ",
  "I always wondered… ",
  "secret: 🤫 ",
] as const;

/** Reply starters for the room owner answering an anonymous sender. */
export const REPLY_TEMPLATES = [
  "ok, honest answer: ",
  "wait, tell me more: ",
  "haha fair. my turn: ",
  "I knew it 😏 ",
  "who is this?? 👀 ",
  "that one hit different… ",
  "real talk back: ",
  "hmm, interesting. why? ",
] as const;

export const INVITATION_PROMPTS = [
  "what's something you'd never say to my face? 🤫",
  "drop your honest opinion of me 👀",
  "describe me in 3 emojis ✨",
  "tell me a secret. I'll keep it 🔒",
  "roast me. no mercy 🔥",
  "confess something 🙊",
] as const;

/** Pick a random index different from the current one (when possible). */
export function nextRandomIndex(current: number, length: number): number {
  if (length <= 1) return 0;
  let next = current;
  while (next === current) {
    next = Math.floor(Math.random() * length);
  }
  return next;
}
