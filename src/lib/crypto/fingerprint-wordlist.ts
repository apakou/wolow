/**
 * Wolow-themed wordlist for human-readable key fingerprints.
 * Each list intentionally kept ≤ 256 (8-bit indexable) but we use 16-bit
 * picks in fingerprint.ts for slightly better distribution.
 *
 * Vibes: friendly, gender-neutral, easy to read aloud.
 */

export const ADJECTIVES = [
  "sunny", "cosmic", "neon", "lucky", "mellow", "brave", "sassy", "dapper",
  "witty", "curious", "snappy", "chill", "zesty", "nimble", "jolly", "funky",
  "velvet", "electric", "swift", "comet", "glowy", "clever", "peppy", "dreamy",
] as const;

export const CREATURES = [
  "otter", "fox", "panda", "koala", "falcon", "lynx", "rabbit", "dolphin",
  "raven", "tiger", "gecko", "hedgehog", "jaguar", "walrus", "cobra", "moose",
  "parrot", "shark", "bison", "wolf", "toucan", "penguin", "yak", "wombat",
] as const;

export const NOUNS = [
  "river", "stone", "comet", "ember", "crystal", "lantern", "harbor", "meadow",
  "cipher", "tempest", "willow", "summit", "garnet", "echo", "spire", "thicket",
  "feather", "marble", "cinder", "ribbon", "atlas", "cobble", "horizon", "drizzle",
] as const;

export const VERBS = [
  "soars", "drifts", "leaps", "dances", "glides", "spins", "sails", "blooms",
  "wanders", "shines", "hums", "darts", "pounces", "flickers", "races", "sparkles",
  "tumbles", "weaves", "purrs", "twirls", "echoes", "ripples", "saunters", "zips",
] as const;
