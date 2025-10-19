/**
 * Keypair Management Utilities
 *
 * Handles loading, generating, and managing Nostr keypairs from various sources.
 */

import fs from "node:fs";
import path from "node:path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { FILES } from "./constants.mjs";
import { logger } from "../utils/logger.mjs";

/**
 * Get private key from multiple sources (in priority order)
 *
 * Priority:
 * 1. Environment variable (NOSTR_SK_HEX)
 * 2. Site-specific keypair file (.nweb-keypair.json)
 * 3. Error if not found
 *
 * @param {string} siteDir - Site directory path (optional)
 * @returns {string} Private key in hex format
 * @throws {Error} If no private key found
 */
export function getPrivateKey(siteDir = null) {
  // Try environment variable first
  if (process.env.NOSTR_SK_HEX) {
    return process.env.NOSTR_SK_HEX;
  }

  // Try site-specific keypair file
  if (siteDir) {
    const keypairPath = path.join(siteDir, FILES.KEYPAIR);
    if (fs.existsSync(keypairPath)) {
      try {
        const keypair = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        return keypair.privateKey;
      } catch (error) {
        logger.warn(`Failed to read keypair file: ${error.message}`);
      }
    }
  }

  throw new Error(
    "No private key found. Set NOSTR_SK_HEX in .env or create .nweb-keypair.json"
  );
}

/**
 * Get public key from private key
 *
 * @param {string} skHex - Private key in hex format
 * @returns {string} Public key in hex format
 */
export function getPublicKeyFromPrivate(skHex) {
  const SK = hexToUint8Array(skHex);
  return getPublicKey(SK);
}

/**
 * Generate a new Nostr keypair
 *
 * @returns {Object} Keypair with private and public keys
 */
export function generateKeypair() {
  const SK = generateSecretKey();
  const skHex = uint8ArrayToHex(SK);
  const pubkey = getPublicKey(SK);
  const nsec = nip19.nsecEncode(SK);
  const npub = nip19.npubEncode(pubkey);

  return {
    privateKey: skHex,
    publicKey: pubkey,
    nsec,
    npub,
  };
}

/**
 * Save keypair to file
 *
 * @param {Object} keypair - Keypair object
 * @param {string} filePath - Path to save file
 */
export function saveKeypair(keypair, filePath) {
  const data = {
    privateKey: keypair.privateKey,
    publicKey: keypair.publicKey,
    created: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Convert hex string to Uint8Array
 *
 * @param {string} hex - Hex string
 * @returns {Uint8Array}
 */
export function hexToUint8Array(hex) {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/**
 * Convert Uint8Array to hex string
 *
 * @param {Uint8Array} bytes - Byte array
 * @returns {string} Hex string
 */
export function uint8ArrayToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

/**
 * Decode nsec to hex private key
 *
 * @param {string} nsec - nsec-encoded private key
 * @returns {string} Hex private key
 */
export function decodeNsec(nsec) {
  const decoded = nip19.decode(nsec);
  return Buffer.from(decoded.data).toString("hex");
}

/**
 * Decode npub to hex public key
 *
 * @param {string} npub - npub-encoded public key
 * @returns {string} Hex public key
 */
export function decodeNpub(npub) {
  const decoded = nip19.decode(npub);
  return decoded.data;
}

/**
 * Validate private key format
 *
 * @param {string} sk - Private key to validate
 * @returns {boolean} True if valid
 */
export function isValidPrivateKey(sk) {
  if (!sk || typeof sk !== "string") {
    return false;
  }

  // Check if it's nsec format
  if (sk.startsWith("nsec1")) {
    try {
      decodeNsec(sk);
      return true;
    } catch {
      return false;
    }
  }

  // Check if it's hex format (64 characters)
  return /^[0-9a-f]{64}$/i.test(sk);
}

/**
 * Validate public key format
 *
 * @param {string} pk - Public key to validate
 * @returns {boolean} True if valid
 */
export function isValidPublicKey(pk) {
  if (!pk || typeof pk !== "string") {
    return false;
  }

  // Check if it's npub format
  if (pk.startsWith("npub1")) {
    try {
      decodeNpub(pk);
      return true;
    } catch {
      return false;
    }
  }

  // Check if it's hex format (64 characters)
  return /^[0-9a-f]{64}$/i.test(pk);
}

/**
 * Normalize private key to hex format
 *
 * @param {string} sk - Private key (hex or nsec)
 * @returns {string} Hex private key
 */
export function normalizePrivateKey(sk) {
  if (sk.startsWith("nsec1")) {
    return decodeNsec(sk);
  }
  return sk;
}

/**
 * Normalize public key to hex format
 *
 * @param {string} pk - Public key (hex or npub)
 * @returns {string} Hex public key
 */
export function normalizePublicKey(pk) {
  if (pk.startsWith("npub1")) {
    return decodeNpub(pk);
  }
  return pk;
}
