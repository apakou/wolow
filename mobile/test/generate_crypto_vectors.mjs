// Generates cross-platform E2EE golden vectors using the SAME Web Crypto
// primitives and parameters as the web client (verified line-by-line against
// src/lib/crypto/*.ts). Output: mobile/test/crypto_vectors.json
//
// Regenerate with: node mobile/test/generate_crypto_vectors.mjs

import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const subtle = crypto.subtle;

// --- generate-key-pair.ts ---------------------------------------------
async function generateKeyPair() {
  const keyPair = await subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  return {
    publicKey: await subtle.exportKey("jwk", keyPair.publicKey),
    privateKey: await subtle.exportKey("jwk", keyPair.privateKey),
  };
}

// --- encrypt-message.ts ------------------------------------------------
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function importRsaPublicKey(jwk) {
  return subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}

async function encryptMessage(plaintext, ownerPublicKey, visitorPublicKey) {
  const aesKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(plaintext));
  const rawAesKey = await subtle.exportKey("raw", aesKey);
  const [ownerCryptoKey, visitorCryptoKey] = await Promise.all([
    importRsaPublicKey(ownerPublicKey),
    importRsaPublicKey(visitorPublicKey),
  ]);
  const [wrappedForOwner, wrappedForVisitor] = await Promise.all([
    subtle.encrypt({ name: "RSA-OAEP" }, ownerCryptoKey, rawAesKey),
    subtle.encrypt({ name: "RSA-OAEP" }, visitorCryptoKey, rawAesKey),
  ]);
  return JSON.stringify({
    v: 1,
    ct: bufferToBase64(cipherBuffer),
    iv: bufferToBase64(iv.buffer),
    keys: { owner: bufferToBase64(wrappedForOwner), visitor: bufferToBase64(wrappedForVisitor) },
  });
}

// --- fingerprint.ts + wordlist -----------------------------------------
const ADJECTIVES = ["sunny","cosmic","neon","lucky","mellow","brave","sassy","dapper","witty","curious","snappy","chill","zesty","nimble","jolly","funky","velvet","electric","swift","comet","glowy","clever","peppy","dreamy"];
const CREATURES = ["otter","fox","panda","koala","falcon","lynx","rabbit","dolphin","raven","tiger","gecko","hedgehog","jaguar","walrus","cobra","moose","parrot","shark","bison","wolf","toucan","penguin","yak","wombat"];
const NOUNS = ["river","stone","comet","ember","crystal","lantern","harbor","meadow","cipher","tempest","willow","summit","garnet","echo","spire","thicket","feather","marble","cinder","ribbon","atlas","cobble","horizon","drizzle"];
const VERBS = ["soars","drifts","leaps","dances","glides","spins","sails","blooms","wanders","shines","hums","darts","pounces","flickers","races","sparkles","tumbles","weaves","purrs","twirls","echoes","ripples","saunters","zips"];

function pickWord(list, bytes, offset) {
  const idx = ((bytes[offset] << 8) | bytes[offset + 1]) % list.length;
  return list[idx];
}

async function fingerprintPublicKey(jwk) {
  const canonical = `${jwk.n}|${jwk.e}`;
  const digest = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return [pickWord(ADJECTIVES, digest, 0), pickWord(CREATURES, digest, 2), pickWord(NOUNS, digest, 4), pickWord(VERBS, digest, 6)].join("-").toLowerCase();
}

function publicJwkFromPrivate(privateJwk) {
  return { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e, alg: privateJwk.alg, ext: true, key_ops: ["encrypt"] };
}

// --- export-key.ts -------------------------------------------------------
const PBKDF2_ITERATIONS = 600000;

async function deriveKey(passphrase, salt) {
  const baseKey = await subtle.importKey("raw", new TextEncoder().encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function exportWrappedKey(privateJwk, passphrase, slug) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(privateJwk));
  const ctBuffer = await subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);
  const fingerprint = await fingerprintPublicKey(publicJwkFromPrivate(privateJwk));
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: PBKDF2_ITERATIONS,
    salt: bufferToBase64(salt.buffer),
    iv: bufferToBase64(iv.buffer),
    ct: bufferToBase64(ctBuffer),
    fingerprint,
    slug,
    created_at: new Date().toISOString(),
  };
}

// --- main ---------------------------------------------------------------
const owner = await generateKeyPair();
const visitor = await generateKeyPair();

const plaintext = "cross-platform secret \u{1F512} — ünïcödé ok";
const envelope = await encryptMessage(plaintext, publicJwkFromPrivate(owner.privateKey), publicJwkFromPrivate(visitor.privateKey));

const passphrase = "correct horse battery staple 42";
const keyFile = await exportWrappedKey(owner.privateKey, passphrase, "goldslug");

const vectors = {
  note: "Generated by generate_crypto_vectors.mjs with Web Crypto (web-parity parameters). Test keys only.",
  plaintext,
  ownerPrivateJwk: owner.privateKey,
  ownerPublicJwk: publicJwkFromPrivate(owner.privateKey),
  visitorPrivateJwk: visitor.privateKey,
  visitorPublicJwk: publicJwkFromPrivate(visitor.privateKey),
  envelope,
  ownerFingerprint: await fingerprintPublicKey(publicJwkFromPrivate(owner.privateKey)),
  keyFile: { passphrase, slug: "goldslug", json: JSON.stringify(keyFile, null, 2) },
};

const out = join(dirname(fileURLToPath(import.meta.url)), "crypto_vectors.json");
writeFileSync(out, JSON.stringify(vectors, null, 2));
console.log("Wrote", out);
console.log("owner fingerprint:", vectors.ownerFingerprint);
