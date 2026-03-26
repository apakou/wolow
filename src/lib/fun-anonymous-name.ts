const ADJECTIVES = [
  "Sunny",
  "Cosmic",
  "Neon",
  "Lucky",
  "Mellow",
  "Brave",
  "Sassy",
  "Dapper",
  "Witty",
  "Curious",
  "Snappy",
  "Chill",
  "Zesty",
  "Nimble",
  "Jolly",
  "Funky",
  "Velvet",
  "Electric",
  "Swift",
  "Comet",
  "Glowy",
  "Clever",
  "Peppy",
  "Dreamy",
];

const CREATURES = [
  { animal: "Otter", emoji: "🦦" },
  { animal: "Fox", emoji: "🦊" },
  { animal: "Panda", emoji: "🐼" },
  { animal: "Koala", emoji: "🐨" },
  { animal: "Falcon", emoji: "🦅" },
  { animal: "Lynx", emoji: "🐱" },
  { animal: "Rabbit", emoji: "🐰" },
  { animal: "Dolphin", emoji: "🐬" },
  { animal: "Raven", emoji: "🐦" },
  { animal: "Tiger", emoji: "🐯" },
  { animal: "Gecko", emoji: "🦎" },
  { animal: "Hedgehog", emoji: "🦔" },
  { animal: "Jaguar", emoji: "🐆" },
  { animal: "Walrus", emoji: "🦭" },
  { animal: "Cobra", emoji: "🐍" },
  { animal: "Moose", emoji: "🫎" },
  { animal: "Parrot", emoji: "🦜" },
  { animal: "Shark", emoji: "🦈" },
  { animal: "Bison", emoji: "🦬" },
  { animal: "Wolf", emoji: "🐺" },
  { animal: "Toucan", emoji: "🦜" },
  { animal: "Penguin", emoji: "🐧" },
  { animal: "Yak", emoji: "🐃" },
  { animal: "Wombat", emoji: "🐻" },
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getFunAnonymousName(conversationId: string): string {
  const hash = hashString(conversationId);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const creature = CREATURES[Math.floor(hash / ADJECTIVES.length) % CREATURES.length];
  return `${adjective} ${creature.animal}`;
}

export function getFunAnonymousEmoji(conversationId: string): string {
  const hash = hashString(conversationId);
  const creature = CREATURES[Math.floor(hash / ADJECTIVES.length) % CREATURES.length];
  return creature.emoji;
}

export function getNameInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}