import crypto from "node:crypto";

const WORDS = [
  "amber",
  "anchor",
  "atlas",
  "beacon",
  "bolt",
  "cinder",
  "comet",
  "delta",
  "echo",
  "ember",
  "fable",
  "flare",
  "forge",
  "harbor",
  "ion",
  "keystone",
  "lantern",
  "lumen",
  "mesa",
  "nova",
  "orbit",
  "pulse",
  "quartz",
  "relay",
  "rift",
  "river",
  "signal",
  "sparks",
  "summit",
  "tunnel",
  "vector",
  "vault",
];

export function generateId() {
  const a = WORDS[crypto.randomInt(WORDS.length)];
  const b = WORDS[crypto.randomInt(WORDS.length)];
  const n = crypto.randomInt(10, 100);
  return `${a}-${b}-${n}`;
}

export function generateSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

export function makeCode(id, secret) {
  return `${id}.${secret}`;
}

export function parseCode(codeOrId) {
  const value = String(codeOrId || "").trim();
  if (!value) throw new Error("Missing wormhole code.");

  const dot = value.indexOf(".");
  if (dot === -1) return { id: value, secret: null };

  const id = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!id || !secret) throw new Error("Invalid wormhole code.");
  return { id, secret };
}

export function hashPayload(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function deriveKey(secret, salt) {
  return crypto.hkdfSync("sha256", Buffer.from(secret), salt, "agent-wormhole:v1", 32);
}

export function encryptPayload(buffer, secret) {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = deriveKey(secret, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: "AES-256-GCM",
    kdf: "HKDF-SHA256",
    salt: salt.toString("base64url"),
    nonce: nonce.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptPayload(envelope, secret) {
  if (!secret) throw new Error("Full wormhole code is required to claim payload.");

  const salt = Buffer.from(envelope.salt, "base64url");
  const nonce = Buffer.from(envelope.nonce, "base64url");
  const tag = Buffer.from(envelope.tag, "base64url");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
  const key = deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
