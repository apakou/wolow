/**
 * Slug rules for room links (wolow.app/{slug}).
 *
 * Shared between the client (live validation in the onboarding wizard)
 * and the server (PATCH /api/rooms/[slug]) so the rules can never drift.
 *
 * Product rules: lowercase, 3–20 chars, starts with a letter/number,
 * then letters/numbers/hyphen/underscore. The DB additionally enforces
 * a loose charset/length backstop (migration 027).
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 20;
export const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{2,19}$/;

/**
 * Names that collide with app routes / static assets, or that we don't
 * want squatted. Checked against the lowercased candidate.
 */
export const RESERVED_SLUGS = new Set([
  // Existing app routes
  "api",
  "auth",
  "settings",
  "help",
  "sent",
  "welcome",
  "inbox",
  // Static assets / platform paths
  "_next",
  "public",
  "static",
  "assets",
  "icons",
  "images",
  "fonts",
  "sw",
  "manifest",
  "favicon",
  "robots",
  "sitemap",
  // Likely future routes & brand protection
  "about",
  "admin",
  "app",
  "blog",
  "contact",
  "home",
  "login",
  "logout",
  "me",
  "new",
  "official",
  "privacy",
  "root",
  "signin",
  "signout",
  "signup",
  "support",
  "terms",
  "wolow",
]);

export type SlugInvalidReason = "length" | "format" | "reserved";

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: SlugInvalidReason };

export const SLUG_ERROR_MESSAGES: Record<SlugInvalidReason, string> = {
  length: `Must be ${SLUG_MIN}–${SLUG_MAX} characters.`,
  format: "Only lowercase letters, numbers, - and _ (must start with a letter or number).",
  reserved: "That name is reserved — try another one.",
};

/** Normalize + validate a user-supplied slug candidate. */
export function validateSlug(raw: string): SlugValidation {
  const slug = raw.trim().toLowerCase();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return { ok: false, reason: "length" };
  }
  if (!SLUG_REGEX.test(slug)) {
    return { ok: false, reason: "format" };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, slug };
}

/** Random lowercase alphanumeric suffix, e.g. "x7k". */
export function randomSlugSuffix(length = 3): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Suggest a slug from a display name: "Amina Diallo" → "amina".
 * Falls back to padding with random characters when the result is too
 * short, and never returns a reserved name.
 */
export function suggestSlugFromName(name: string): string {
  let base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "") // keep alphanumerics only
    .slice(0, SLUG_MAX);

  if (base.length < SLUG_MIN) {
    base = (base + randomSlugSuffix(SLUG_MIN)).slice(0, SLUG_MAX);
  }
  if (RESERVED_SLUGS.has(base)) {
    base = `${base.slice(0, SLUG_MAX - 3)}${randomSlugSuffix(3)}`;
  }
  return base;
}
