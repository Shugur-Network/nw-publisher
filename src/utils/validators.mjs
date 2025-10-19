/**
 * Validation Utilities
 *
 * Input validation, file validation, and data sanitization.
 */

import fs from "node:fs";
import path from "node:path";
import { LIMITS, FILES } from "../lib/constants.mjs";
import { isValidRelayUrl } from "../lib/relay.mjs";
import { isValidPrivateKey, isValidPublicKey } from "../lib/keypair.mjs";

/**
 * Validate site directory exists and has required files
 *
 * @param {string} siteDir - Site directory path
 * @returns {Object} Validation result
 */
export function validateSiteDirectory(siteDir) {
  const errors = [];
  const warnings = [];

  // Check directory exists
  if (!fs.existsSync(siteDir)) {
    errors.push(`Directory does not exist: ${siteDir}`);
    return { valid: false, errors, warnings };
  }

  // Check it's a directory
  const stats = fs.statSync(siteDir);
  if (!stats.isDirectory()) {
    errors.push(`Not a directory: ${siteDir}`);
    return { valid: false, errors, warnings };
  }

  // Check for index.html
  const indexPath = path.join(siteDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    errors.push("Missing index.html");
  }

  // Check for assets
  const files = fs.readdirSync(siteDir);
  const hasAssets = files.some(
    (f) => f.endsWith(".html") || f.endsWith(".css") || f.endsWith(".js")
  );

  if (!hasAssets) {
    warnings.push("No HTML, CSS, or JS files found");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate file size
 *
 * @param {string} filePath - Path to file
 * @param {number} maxSize - Maximum size in bytes
 * @returns {boolean} True if valid
 */
export function validateFileSize(filePath, maxSize = LIMITS.MAX_FILE_SIZE) {
  const stats = fs.statSync(filePath);
  return stats.size <= maxSize;
}

/**
 * Validate relay configuration
 *
 * @param {Array<string>} relays - Array of relay URLs
 * @returns {Object} Validation result
 */
export function validateRelays(relays) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(relays) || relays.length === 0) {
    errors.push("No relays configured");
    return { valid: false, errors, warnings };
  }

  if (relays.length < LIMITS.MIN_RELAY_COUNT) {
    warnings.push(
      `Only ${relays.length} relay configured. Recommend at least 2 for redundancy.`
    );
  }

  if (relays.length > LIMITS.MAX_RELAY_COUNT) {
    warnings.push(
      `${relays.length} relays configured. Large numbers may slow down publishing.`
    );
  }

  for (const url of relays) {
    if (!isValidRelayUrl(url)) {
      errors.push(`Invalid relay URL: ${url}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate environment configuration
 *
 * @returns {Object} Validation result
 */
export function validateEnvironment() {
  const errors = [];
  const warnings = [];

  // Check for private key
  if (!process.env.NOSTR_SK_HEX) {
    errors.push("NOSTR_SK_HEX not set in environment");
  } else if (!isValidPrivateKey(process.env.NOSTR_SK_HEX)) {
    errors.push("NOSTR_SK_HEX is not a valid private key");
  }

  // Check for relays
  if (!process.env.RELAYS) {
    warnings.push("RELAYS not set in environment");
  } else {
    const relays = process.env.RELAYS.split(",").map((r) => r.trim());
    const relayValidation = validateRelays(relays);
    errors.push(...relayValidation.errors);
    warnings.push(...relayValidation.warnings);
  }

  // Check for host
  if (!process.env.NWEB_HOST) {
    warnings.push(
      "NWEB_HOST not set. DNS record generation will be incomplete."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Sanitize filename (remove dangerous characters)
 *
 * @param {string} filename - Filename to sanitize
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
}

/**
 * Validate version string (semver)
 *
 * @param {string} version - Version string
 * @returns {boolean} True if valid semver
 */
export function isValidVersion(version) {
  const semverRegex =
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/;
  return semverRegex.test(version);
}

/**
 * Validate JSON string
 *
 * @param {string} jsonString - JSON string to validate
 * @returns {boolean} True if valid JSON
 */
export function isValidJSON(jsonString) {
  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate HTML basic structure
 *
 * @param {string} html - HTML content
 * @returns {Object} Validation result
 */
export function validateHTML(html) {
  const errors = [];
  const warnings = [];

  if (!html || html.trim().length === 0) {
    errors.push("HTML is empty");
    return { valid: false, errors, warnings };
  }

  // Check for basic structure
  if (!/<html/i.test(html)) {
    warnings.push("Missing <html> tag");
  }

  if (!/<head/i.test(html)) {
    warnings.push("Missing <head> tag");
  }

  if (!/<body/i.test(html)) {
    warnings.push("Missing <body> tag");
  }

  // Check for unclosed tags (basic check)
  const openTags = html.match(/<[^/][^>]*>/g) || [];
  const closeTags = html.match(/<\/[^>]*>/g) || [];

  if (Math.abs(openTags.length - closeTags.length) > 5) {
    warnings.push("Possible unclosed tags detected");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate command arguments
 *
 * @param {Array} args - Command arguments
 * @param {number} min - Minimum number of arguments
 * @param {number} max - Maximum number of arguments
 * @returns {boolean} True if valid
 */
export function validateArgs(args, min = 0, max = Infinity) {
  return args.length >= min && args.length <= max;
}
