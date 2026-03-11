/**
 * Content encryption for alpha posts.
 *
 * Uses AES-256-GCM with a per-creator key derived from:
 *   CONTENT_ENCRYPTION_KEY (server env) + creatorId
 *
 * This means:
 * - A raw database dump is unreadable without the server key
 * - Each creator's content uses a unique derived key
 * - The IV is random per-post (stored alongside ciphertext)
 *
 * Format: base64(iv:authTag:ciphertext)
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { env } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Derive a per-creator 256-bit key from the server master key + creatorId.
 */
function deriveKey(creatorId: string): Buffer {
  return createHash("sha256")
    .update(`${env.CONTENT_ENCRYPTION_KEY}:${creatorId}`)
    .digest();
}

/**
 * Encrypt plaintext content for a specific creator.
 * Returns a base64-encoded string containing iv + authTag + ciphertext.
 */
export function encryptContent(plaintext: string, creatorId: string): string {
  const key = deriveKey(creatorId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (12 bytes) + authTag (16 bytes) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt content for a specific creator.
 * Input is the base64 string from encryptContent.
 */
export function decryptContent(encryptedBase64: string, creatorId: string): string {
  const key = deriveKey(creatorId);
  const packed = Buffer.from(encryptedBase64, "base64");

  // Unpack: iv (12 bytes) + authTag (16 bytes) + ciphertext (rest)
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check if a string looks like encrypted content (base64 with minimum length).
 * Used to handle migration — old plaintext posts won't be decrypted.
 */
export function isEncrypted(content: string): boolean {
  // Minimum: 12 (iv) + 16 (tag) + 1 (min ciphertext) = 29 bytes → ~40 base64 chars
  if (content.length < 40) return false;
  // Check if it's valid base64
  return /^[A-Za-z0-9+/]+=*$/.test(content);
}
